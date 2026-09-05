import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response, type NextFunction } from "express";

import {
  activeJob,
  cancelJob,
  getJob,
  isBusy,
  JobValidationError,
  listJobs,
  publicJob,
  readFeeds,
  startJob,
} from "./jobs";
import { getSchedule, updateSchedule } from "./scheduler";
import { listChannels, setChannelLabel } from "./channels";
import { articlesDir, feedsPath, logsDir, readTail, writeJson } from "./store";

/* ------------------------------------------------------------------ auth --- */

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map<string, number>();

function pruneSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [token, created] of sessions) {
    if (created < cutoff) sessions.delete(token);
  }
}

function adminPasswordConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

function validPassword(password: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD || "";
  if (typeof password !== "string" || !expected) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookieOptions(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`;
}

function sessionToken(req: Request): string | undefined {
  return req.headers.cookie?.match(/(?:^|;\s*)admin_session=([^;]+)/)?.[1];
}

function authenticated(req: Request): boolean {
  pruneSessions();
  const token = sessionToken(req);
  return Boolean(token && sessions.has(token));
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!authenticated(req)) return res.status(401).json({ error: "需要管理员登录" });
  next();
}

/* ------------------------------------------------------- login throttling --- */

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const loginFailures = new Map<string, { count: number; first: number }>();

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

/** Seconds the caller must wait, or 0 when they may try now. */
function loginLockedFor(req: Request): number {
  const entry = loginFailures.get(clientKey(req));
  if (!entry) return 0;
  const elapsed = Date.now() - entry.first;
  if (elapsed > LOGIN_WINDOW_MS) {
    loginFailures.delete(clientKey(req));
    return 0;
  }
  if (entry.count < LOGIN_MAX_FAILURES) return 0;
  return Math.ceil((LOGIN_WINDOW_MS - elapsed) / 1000);
}

function noteLoginFailure(req: Request): void {
  const key = clientKey(req);
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

function clearLoginFailures(req: Request): void {
  loginFailures.delete(clientKey(req));
}

/* --------------------------------------------------------------- helpers --- */

const FEED_KEY_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/i;

function countArticles(): { total: number; byChannel: Record<string, number>; latestDate: string | null } {
  const root = articlesDir();
  const byChannel: Record<string, number> = {};
  let total = 0;
  let latestDate: string | null = null;

  const walk = (dir: string, channel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, channel);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        total += 1;
        byChannel[channel] = (byChannel[channel] || 0) + 1;
        const match = /^(\d{8})/.exec(entry.name);
        if (match && (!latestDate || match[1] > latestDate)) latestDate = match[1];
      }
    }
  };

  let channels: fs.Dirent[];
  try {
    channels = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { total: 0, byChannel: {}, latestDate: null };
  }
  for (const channel of channels) {
    if (channel.isDirectory()) walk(path.join(root, channel.name), channel.name);
  }
  return { total, byChannel, latestDate };
}

function dirSizeBytes(dir: string): number {
  let bytes = 0;
  const walk = (target: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(target, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(target, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try {
          bytes += fs.statSync(full).size;
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(dir);
  return bytes;
}

function listLogFiles(): { file: string; size: number; modified: string }[] {
  const dir = logsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(name => name.endsWith(".log"))
    .map(name => {
      const stat = fs.statSync(path.join(dir, name));
      return { file: name, size: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

/** Delete log files older than `days`, keeping today's. Returns removed names. */
function pruneLogs(days: number): string[] {
  const dir = logsDir();
  if (!fs.existsSync(dir)) return [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const entry of listLogFiles()) {
    if (new Date(entry.modified).getTime() >= cutoff) continue;
    try {
      fs.unlinkSync(path.join(dir, entry.file));
      removed.push(entry.file);
    } catch {
      /* ignore individual failures */
    }
  }
  return removed;
}

/**
 * Fetch an RSS URL and report whether it looks usable. Run before saving a feed
 * so a typo or dead endpoint is caught at configuration time, not at 03:00.
 */
async function probeFeed(url: string): Promise<{ ok: boolean; status?: number; items?: number; title?: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; FuzyReadBot/1.0)", accept: "application/rss+xml, application/xml, text/xml, */*" },
    });
    if (!res.ok) return { ok: false, status: res.status, error: `订阅源返回 HTTP ${res.status}` };

    const body = (await res.text()).slice(0, 300_000);
    const items = (body.match(/<item[\s>]/gi) || []).length + (body.match(/<entry[\s>]/gi) || []).length;
    const title = body.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1];
    if (!items) return { ok: false, status: res.status, items: 0, error: "未在响应中发现 item/entry 节点，可能不是 RSS/Atom 源" };

    return {
      ok: true,
      status: res.status,
      items,
      title: title?.replace(/<!\[CDATA\[|\]\]>/g, "").trim(),
    };
  } catch (err) {
    const message = (err as Error).name === "AbortError" ? "请求超时（12 秒）" : (err as Error).message;
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- router --- */

export function adminRouter(): Router {
  const router = Router();

  // --- public (pre-auth) endpoints ---
  router.get("/session", (req, res) => {
    res.json({
      authenticated: authenticated(req),
      passwordConfigured: adminPasswordConfigured(),
    });
  });

  router.post("/login", (req, res) => {
    if (!adminPasswordConfigured()) {
      return res.status(503).json({ error: "服务端未配置 ADMIN_PASSWORD，管理后台已禁用" });
    }
    const lockedFor = loginLockedFor(req);
    if (lockedFor > 0) {
      res.setHeader("Retry-After", String(lockedFor));
      return res.status(429).json({ error: `登录失败次数过多，请 ${Math.ceil(lockedFor / 60)} 分钟后再试` });
    }
    if (!validPassword(req.body?.password)) {
      noteLoginFailure(req);
      return res.status(401).json({ error: "管理员密码错误" });
    }
    clearLoginFailures(req);
    pruneSessions();
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now());
    res.setHeader("Set-Cookie", `admin_session=${token}; ${cookieOptions()}`);
    res.json({ authenticated: true });
  });

  router.post("/logout", (req, res) => {
    const token = sessionToken(req);
    if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", `admin_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`);
    res.json({ authenticated: false });
  });

  // --- everything below requires a session ---
  router.use(requireAdmin);

  router.get("/stats", (_req, res) => {
    const articles = countArticles();
    const jobs = listJobs();
    const logs = listLogFiles();
    res.json({
      articles,
      feeds: Object.keys(readFeeds()).length,
      jobs: {
        total: jobs.length,
        running: isBusy(),
        activeJobId: activeJob()?.id ?? null,
        lastCompletedAt: jobs.find(j => j.finishedAt)?.finishedAt ?? null,
      },
      schedule: getSchedule(),
      storage: {
        articlesDir: articlesDir(),
        articlesBytes: dirSizeBytes(articlesDir()),
        logFiles: logs.length,
        logBytes: logs.reduce((sum, log) => sum + log.size, 0),
      },
    });
  });

  // --- feeds CRUD ---
  router.get("/feeds", (_req, res) => {
    const feeds = readFeeds();
    const counts = countArticles().byChannel;
    res.json(
      Object.entries(feeds).map(([key, url]) => ({
        key,
        url,
        articleCount: counts[`${key}_articles`] ?? 0,
      })),
    );
  });

  router.post("/feeds", (req, res) => {
    const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!FEED_KEY_RE.test(key)) {
      return res.status(400).json({ error: "订阅源标识仅允许字母、数字、下划线和短横线（2-64 位）" });
    }
    if (!/^https?:\/\/\S+$/i.test(url)) {
      return res.status(400).json({ error: "订阅源地址必须是 http(s) URL" });
    }
    const feeds = readFeeds();
    if (feeds[key]) return res.status(409).json({ error: "该订阅源标识已存在" });
    feeds[key] = url;
    try {
      writeJson(feedsPath(), feeds);
    } catch (err) {
      return res.status(500).json({ error: `写入 feeds.json 失败: ${(err as Error).message}` });
    }
    res.status(201).json({ key, url });
  });

  router.post("/feeds/test", async (req, res) => {
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!/^https?:\/\/\S+$/i.test(url)) {
      return res.status(400).json({ error: "订阅源地址必须是 http(s) URL" });
    }
    const result = await probeFeed(url);
    res.status(result.ok ? 200 : 502).json(result);
  });

  router.delete("/feeds/:key", (req, res) => {
    const feeds = readFeeds();
    const key = req.params.key;
    if (!feeds[key]) return res.status(404).json({ error: "订阅源不存在" });
    delete feeds[key];
    try {
      writeJson(feedsPath(), feeds);
    } catch (err) {
      return res.status(500).json({ error: `写入 feeds.json 失败: ${(err as Error).message}` });
    }
    res.json({ removed: key });
  });

  // --- jobs ---
  router.get("/channels", (_req, res) => {
    const counts = countArticles().byChannel;
    const feedFolders = Object.keys(readFeeds()).map(key => `${key}_articles`);
    const folders = Array.from(new Set([...Object.keys(counts), ...feedFolders]));
    res.json(listChannels(folders).map(channel => ({ ...channel, articleCount: counts[channel.folder] ?? 0 })));
  });

  router.put("/channels/:folder", (req, res) => {
    const folder = req.params.folder;
    if (!/^[\w.-]{2,80}$/.test(folder)) {
      return res.status(400).json({ error: "频道标识无效" });
    }
    const { en, zh } = req.body ?? {};
    const clearing = en === null && zh === null;
    if (!clearing && (typeof en !== "string" || typeof zh !== "string")) {
      return res.status(400).json({ error: "请同时提供中英文名称，或传 null 恢复默认" });
    }
    try {
      const label = setChannelLabel(folder, clearing ? null : (en as string), clearing ? null : (zh as string));
      res.json({ folder, ...(label ?? { reset: true }) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get("/jobs", (_req, res) => res.json(listJobs().map(publicJob)));

  router.get("/jobs/:id", (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "任务不存在" });
    res.json(publicJob(job));
  });

  router.post("/jobs", (req, res) => {
    try {
      const job = startJob({
        mode: req.body?.mode,
        feeds: req.body?.feeds,
        start: req.body?.start,
        end: req.body?.end,
        trigger: "manual",
      });
      res.status(202).json(publicJob(job));
    } catch (err) {
      // A malformed request is the caller's fault (400); a busy runner or a
      // missing interpreter is a server-state conflict (409).
      const status = err instanceof JobValidationError ? 400 : 409;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.post("/jobs/:id/cancel", (req, res) => {
    try {
      res.json(publicJob(cancelJob(req.params.id)));
    } catch (err) {
      const message = (err as Error).message;
      res.status(message === "任务不存在" ? 404 : 409).json({ error: message });
    }
  });

  // --- schedule ---
  router.get("/schedule", (_req, res) => res.json(getSchedule()));

  router.put("/schedule", (req, res) => {
    try {
      res.json(updateSchedule(req.body ?? {}));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // --- logs ---
  router.get("/logs", (_req, res) => res.json(listLogFiles()));

  router.get("/logs/:file", (req, res) => {
    const name = req.params.file;
    // Reject anything that isn't a plain log filename — no traversal.
    if (!/^[\w.-]+\.log$/.test(name) || name.includes("..")) {
      return res.status(400).json({ error: "日志文件名无效" });
    }
    const target = path.join(logsDir(), name);
    if (!target.startsWith(logsDir() + path.sep) || !fs.existsSync(target)) {
      return res.status(404).json({ error: "日志文件不存在" });
    }
    const bytes = Math.min(Number(req.query.bytes) || 40_000, 200_000);
    res.json({ file: name, content: readTail(target, bytes) });
  });

  router.post("/logs/prune", (req, res) => {
    const days = Number(req.body?.days ?? 14);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return res.status(400).json({ error: "保留天数必须是 1 到 365 之间的整数" });
    }
    res.json({ removed: pruneLogs(days) });
  });

  return router;
}
