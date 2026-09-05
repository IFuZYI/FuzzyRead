/**
 * Node-side integration tests for the admin API: auth, feeds CRUD, job
 * validation, schedule validation, log path safety.
 *
 * Run with: npm run test:server   (node --test, no extra deps)
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import type { Server } from "node:http";

const PASSWORD = "test-secret-password";

let server: Server;
let baseUrl: string;
let tmpRoot: string;
let originalCwd: string;
let cookie = "";

function makeFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fuzyread-test-"));
  fs.mkdirSync(path.join(root, "harvester", "settings"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "articles", "bbc_english_top_articles", "2026", "06"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "logs"), { recursive: true });

  fs.writeFileSync(
    path.join(root, "harvester", "settings", "feeds.json"),
    JSON.stringify({ bbc_english_top: "http://feeds.bbci.co.uk/news/rss.xml" }, null, 2),
  );
  // runner.py must exist for startJob's preflight check
  fs.writeFileSync(path.join(root, "harvester", "runner.py"), "print('stub')\n");
  fs.writeFileSync(
    path.join(root, "data", "articles", "bbc_english_top_articles", "2026", "06", "20260614_Test_Article.md"),
    "# Test Article\n\n**Date:** 20260614\n",
  );
  fs.writeFileSync(path.join(root, "data", "logs", "harvest_2026-06-14.log"), "line one\nline two\n");
  return root;
}

async function call(pathname: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let body: any = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

before(async () => {
  originalCwd = process.cwd();
  tmpRoot = makeFixture();
  process.chdir(tmpRoot);

  process.env.ADMIN_PASSWORD = PASSWORD;
  process.env.DATA_DIR = "data";
  process.env.HARVESTER_DIR = "harvester";
  process.env.ARTICLES_DIR = "data/articles";
  process.env.PYTHON_BIN = "python3";
  process.env.NODE_ENV = "test";

  // Import after cwd/env are set so module-level path helpers resolve correctly.
  const { adminRouter } = await import("../src/server/admin.ts");

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/admin", adminRouter());

  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("admin auth", () => {
  it("reports password configured before login", async () => {
    const res = await call("/api/admin/session");
    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, false);
    assert.equal(res.body.passwordConfigured, true);
  });

  it("rejects protected routes without a session", async () => {
    for (const route of ["/api/admin/stats", "/api/admin/jobs", "/api/admin/feeds", "/api/admin/schedule", "/api/admin/logs"]) {
      const res = await call(route);
      assert.equal(res.status, 401, `${route} should be 401`);
    }
  });

  it("rejects a wrong password", async () => {
    const res = await call("/api/admin/login", { method: "POST", body: JSON.stringify({ password: "nope" }) });
    assert.equal(res.status, 401);
  });

  it("rejects a non-string password", async () => {
    const res = await call("/api/admin/login", { method: "POST", body: JSON.stringify({ password: { $ne: "" } }) });
    assert.equal(res.status, 401);
  });

  it("accepts the correct password and issues an HttpOnly cookie", async () => {
    const res = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    cookie = setCookie.split(";")[0];
  });

  it("allows protected routes once authenticated", async () => {
    const res = await call("/api/admin/stats");
    assert.equal(res.status, 200);
    assert.equal(res.body.articles.total, 1);
    assert.equal(res.body.feeds, 1);
  });
});

describe("stats", () => {
  it("counts articles per channel and finds the latest date", async () => {
    const res = await call("/api/admin/stats");
    assert.equal(res.status, 200);
    assert.equal(res.body.articles.byChannel.bbc_english_top_articles, 1);
    assert.equal(res.body.articles.latestDate, "20260614");
    assert.ok(res.body.storage.articlesBytes > 0);
  });
});

describe("feeds CRUD", () => {
  it("lists configured feeds with article counts", async () => {
    const res = await call("/api/admin/feeds");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].key, "bbc_english_top");
    assert.equal(res.body[0].articleCount, 1);
  });

  it("rejects an invalid feed key", async () => {
    const res = await call("/api/admin/feeds", { method: "POST", body: JSON.stringify({ key: "bad key!", url: "https://x.com/rss" }) });
    assert.equal(res.status, 400);
  });

  it("rejects a non-http url", async () => {
    const res = await call("/api/admin/feeds", { method: "POST", body: JSON.stringify({ key: "ok_key", url: "ftp://x.com/rss" }) });
    assert.equal(res.status, 400);
  });

  it("rejects a non-http url when testing a feed", async () => {
    for (const url of ["", "ftp://x.com/rss", "not a url"]) {
      const res = await call("/api/admin/feeds/test", { method: "POST", body: JSON.stringify({ url }) });
      assert.equal(res.status, 400, `url=${url} should be rejected`);
    }
  });

  it("reports an unreachable feed as 502 rather than throwing", async () => {
    const res = await call("/api/admin/feeds/test", {
      method: "POST",
      // Reserved TEST-NET-1 address: guaranteed not to resolve to a live service.
      body: JSON.stringify({ url: "http://192.0.2.1:9/rss.xml" }),
    });
    assert.equal(res.status, 502);
    assert.equal(res.body.ok, false);
    assert.ok(res.body.error, "should explain why the probe failed");
  });

  it("adds and then removes a feed", async () => {
    const added = await call("/api/admin/feeds", {
      method: "POST",
      body: JSON.stringify({ key: "guardian_world", url: "https://www.theguardian.com/world/rss" }),
    });
    assert.equal(added.status, 201);

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpRoot, "harvester", "settings", "feeds.json"), "utf8"));
    assert.equal(onDisk.guardian_world, "https://www.theguardian.com/world/rss");

    const duplicate = await call("/api/admin/feeds", {
      method: "POST",
      body: JSON.stringify({ key: "guardian_world", url: "https://www.theguardian.com/world/rss" }),
    });
    assert.equal(duplicate.status, 409);

    const removed = await call("/api/admin/feeds/guardian_world", { method: "DELETE" });
    assert.equal(removed.status, 200);

    const missing = await call("/api/admin/feeds/guardian_world", { method: "DELETE" });
    assert.equal(missing.status, 404);
  });
});

describe("job validation", () => {
  it("rejects an unknown mode", async () => {
    const res = await call("/api/admin/jobs", { method: "POST", body: JSON.stringify({ mode: "bogus" }) });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /模式/);
  });

  it("rejects an unconfigured feed", async () => {
    const res = await call("/api/admin/jobs", { method: "POST", body: JSON.stringify({ mode: "latest", feeds: ["nope"] }) });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /未配置/);
  });

  it("rejects a reversed history year range", async () => {
    const res = await call("/api/admin/jobs", { method: "POST", body: JSON.stringify({ mode: "history", start: 2030, end: 2020 }) });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /年份/);
  });

  it("rejects a non-array feeds value", async () => {
    const res = await call("/api/admin/jobs", { method: "POST", body: JSON.stringify({ mode: "latest", feeds: "bbc_english_top" }) });
    assert.equal(res.status, 400);
  });

  it("rejects a pre-2000 history start year", async () => {
    const res = await call("/api/admin/jobs", { method: "POST", body: JSON.stringify({ mode: "history", start: 1990, end: 2020 }) });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /年份/);
  });

  it("404s an unknown job id", async () => {
    const res = await call("/api/admin/jobs/does-not-exist");
    assert.equal(res.status, 404);
  });

  it("refuses to cancel a job that is not running", async () => {
    const res = await call("/api/admin/jobs/does-not-exist/cancel", { method: "POST" });
    assert.equal(res.status, 404);
  });
});

describe("schedule", () => {
  it("starts disabled with sane defaults", async () => {
    const res = await call("/api/admin/schedule");
    assert.equal(res.status, 200);
    assert.equal(res.body.enabled, false);
    assert.equal(res.body.type, "daily");
    assert.equal(res.body.mode, "latest");
  });

  it("rejects an interval below the floor", async () => {
    const res = await call("/api/admin/schedule", { method: "PUT", body: JSON.stringify({ intervalMinutes: 5 }) });
    assert.equal(res.status, 400);
  });

  it("rejects a malformed daily time", async () => {
    const res = await call("/api/admin/schedule", { method: "PUT", body: JSON.stringify({ dailyTime: "25:99" }) });
    assert.equal(res.status, 400);
  });

  it("rejects history mode for automation", async () => {
    const res = await call("/api/admin/schedule", { method: "PUT", body: JSON.stringify({ mode: "history" }) });
    assert.equal(res.status, 400);
  });

  it("rejects an unconfigured feed", async () => {
    const res = await call("/api/admin/schedule", { method: "PUT", body: JSON.stringify({ feeds: ["nope"] }) });
    assert.equal(res.status, 400);
  });

  it("enables a daily schedule and computes nextRunAt", async () => {
    const res = await call("/api/admin/schedule", {
      method: "PUT",
      body: JSON.stringify({ enabled: true, type: "daily", dailyTime: "03:30", mode: "latest" }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.enabled, true);
    assert.equal(res.body.dailyTime, "03:30");
    assert.ok(res.body.nextRunAt, "nextRunAt should be set");
    const next = new Date(res.body.nextRunAt);
    assert.ok(next.getTime() > Date.now(), "nextRunAt must be in the future");
    assert.equal(next.getMinutes(), 30);
  });

  it("persists the schedule to data/state/schedule.json", async () => {
    const file = path.join(tmpRoot, "data", "state", "schedule.json");
    assert.ok(fs.existsSync(file), "schedule.json should exist");
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(stored.enabled, true);
    assert.equal(stored.dailyTime, "03:30");
  });

  it("switches to interval mode and recomputes nextRunAt", async () => {
    const res = await call("/api/admin/schedule", {
      method: "PUT",
      body: JSON.stringify({ type: "interval", intervalMinutes: 45 }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.type, "interval");
    assert.equal(res.body.intervalMinutes, 45);
    assert.ok(new Date(res.body.nextRunAt).getTime() > Date.now());
  });

  it("can be disabled again", async () => {
    const res = await call("/api/admin/schedule", { method: "PUT", body: JSON.stringify({ enabled: false }) });
    assert.equal(res.status, 200);
    assert.equal(res.body.enabled, false);
    assert.equal(res.body.nextRunAt, null);
  });
});

describe("logs", () => {
  it("lists log files with size and mtime", async () => {
    const res = await call("/api/admin/logs");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].file, "harvest_2026-06-14.log");
    assert.ok(res.body[0].size > 0);
  });

  it("returns the tail of a log file", async () => {
    const res = await call("/api/admin/logs/harvest_2026-06-14.log");
    assert.equal(res.status, 200);
    assert.match(res.body.content, /line two/);
  });

  it("blocks path traversal", async () => {
    for (const attempt of ["..%2F..%2Fetc%2Fpasswd", "..%2Fsettings%2Ffeeds.json", "%2Fetc%2Fpasswd"]) {
      const res = await call(`/api/admin/logs/${attempt}`);
      assert.ok(res.status === 400 || res.status === 404, `traversal ${attempt} should be rejected, got ${res.status}`);
    }
  });

  it("404s a missing log file", async () => {
    const res = await call("/api/admin/logs/nope.log");
    assert.equal(res.status, 404);
  });

  it("rejects a bad retention window for prune", async () => {
    for (const days of [0, -1, 400, 1.5, "abc"]) {
      const res = await call("/api/admin/logs/prune", { method: "POST", body: JSON.stringify({ days }) });
      assert.equal(res.status, 400, `days=${days} should be rejected`);
    }
  });

  it("keeps fresh logs when pruning", async () => {
    const res = await call("/api/admin/logs/prune", { method: "POST", body: JSON.stringify({ days: 14 }) });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.removed, []);
    assert.ok(fs.existsSync(path.join(tmpRoot, "data", "logs", "harvest_2026-06-14.log")));
  });

  it("removes logs older than the retention window", async () => {
    const stale = path.join(tmpRoot, "data", "logs", "harvest_old.log");
    fs.writeFileSync(stale, "ancient\n");
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    fs.utimesSync(stale, new Date(old), new Date(old));

    const res = await call("/api/admin/logs/prune", { method: "POST", body: JSON.stringify({ days: 14 }) });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.removed, ["harvest_old.log"]);
    assert.equal(fs.existsSync(stale), false);
    assert.ok(fs.existsSync(path.join(tmpRoot, "data", "logs", "harvest_2026-06-14.log")));
  });
});

describe("channel labels", () => {
  it("lists channels with builtin and derived names", async () => {
    const res = await call("/api/admin/channels");
    assert.equal(res.status, 200);
    const bbc = res.body.find((c: any) => c.folder === "bbc_english_top_articles");
    assert.ok(bbc, "bbc channel should be listed");
    assert.equal(bbc.zh, "BBC 新闻");
    assert.equal(bbc.source, "builtin");
    assert.equal(bbc.articleCount, 1);
  });

  it("rejects a malformed folder name", async () => {
    const res = await call("/api/admin/channels/..%2Fetc", {
      method: "PUT",
      body: JSON.stringify({ en: "X", zh: "X" }),
    });
    assert.ok(res.status === 400 || res.status === 404, `expected rejection, got ${res.status}`);
  });

  it("rejects a partial rename", async () => {
    for (const body of [{ en: "Only English" }, { zh: "只有中文" }, { en: "", zh: "" }]) {
      const res = await call("/api/admin/channels/bbc_english_top_articles", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 400, `${JSON.stringify(body)} should be rejected`);
    }
  });

  it("saves a custom name and persists it to disk", async () => {
    const res = await call("/api/admin/channels/bbc_english_top_articles", {
      method: "PUT",
      body: JSON.stringify({ en: "BBC Headlines", zh: "BBC 头条" }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.zh, "BBC 头条");

    const stored = JSON.parse(fs.readFileSync(path.join(tmpRoot, "data", "state", "channels.json"), "utf8"));
    assert.equal(stored.bbc_english_top_articles.en, "BBC Headlines");

    const list = await call("/api/admin/channels");
    const bbc = list.body.find((c: any) => c.folder === "bbc_english_top_articles");
    assert.equal(bbc.source, "custom");
    assert.equal(bbc.en, "BBC Headlines");
  });

  it("resets back to the builtin name", async () => {
    const res = await call("/api/admin/channels/bbc_english_top_articles", {
      method: "PUT",
      body: JSON.stringify({ en: null, zh: null }),
    });
    assert.equal(res.status, 200);

    const list = await call("/api/admin/channels");
    const bbc = list.body.find((c: any) => c.folder === "bbc_english_top_articles");
    assert.equal(bbc.source, "builtin");
    assert.equal(bbc.zh, "BBC 新闻");
  });

  it("rejects an over-long name", async () => {
    const res = await call("/api/admin/channels/bbc_english_top_articles", {
      method: "PUT",
      body: JSON.stringify({ en: "x".repeat(120), zh: "长" }),
    });
    assert.equal(res.status, 400);
  });
});

describe("logout", () => {
  it("invalidates the session", async () => {
    const out = await call("/api/admin/logout", { method: "POST" });
    assert.equal(out.status, 200);
    const after = await call("/api/admin/stats");
    assert.equal(after.status, 401);
  });
});

// Must stay last: this deliberately trips the per-IP failure limit.
describe("login throttling", () => {
  it("locks out brute force after repeated failures", async () => {
    let sawLockout = false;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const res = await call("/api/admin/login", { method: "POST", body: JSON.stringify({ password: "wrong" }) });
      if (res.status === 429) {
        sawLockout = true;
        break;
      }
      assert.equal(res.status, 401);
    }
    assert.ok(sawLockout, "expected a 429 after repeated wrong passwords");
  });

  it("keeps rejecting the correct password while locked out", async () => {
    const res = await call("/api/admin/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }) });
    assert.equal(res.status, 429);
    assert.ok(Number(res.body?.error?.length) > 0);
  });
});
