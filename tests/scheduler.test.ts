/**
 * Unit tests for the auto-update scheduler: next-run maths, validation,
 * persistence, and the due-timestamp stability guarantee.
 *
 * Run with: npm run test:server
 */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpRoot: string;
let originalCwd: string;
let scheduler: typeof import("../src/server/scheduler.ts");

function scheduleFile(): string {
  return path.join(tmpRoot, "data", "state", "schedule.json");
}

function readStored(): any {
  return JSON.parse(fs.readFileSync(scheduleFile(), "utf8"));
}

/** Drop in-memory state so the next read comes from disk. */
function reload(): void {
  scheduler.resetScheduleForTests();
}

before(async () => {
  originalCwd = process.cwd();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fuzyread-sched-"));
  fs.mkdirSync(path.join(tmpRoot, "harvester", "settings"), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, "data", "state"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, "harvester", "settings", "feeds.json"),
    JSON.stringify({ bbc_english_top: "http://example.invalid/rss.xml", time_english_top: "http://example.invalid/time.xml" }),
  );
  fs.writeFileSync(path.join(tmpRoot, "harvester", "runner.py"), "print('stub')\n");

  process.chdir(tmpRoot);
  process.env.DATA_DIR = "data";
  process.env.HARVESTER_DIR = "harvester";
  process.env.NODE_ENV = "test";

  scheduler = await import("../src/server/scheduler.ts");
});

after(() => {
  scheduler.stopScheduler();
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(scheduleFile(), { force: true });
  reload();
});

describe("schedule defaults", () => {
  it("starts disabled with no next run", () => {
    const s = scheduler.getSchedule();
    assert.equal(s.enabled, false);
    assert.equal(s.type, "daily");
    assert.equal(s.dailyTime, "03:00");
    assert.equal(s.mode, "latest");
    assert.equal(s.catchUp, true);
    assert.equal(s.nextRunAt, null);
    assert.equal(s.lastJobId, null);
  });
});

describe("daily scheduling", () => {
  it("targets the configured wall-clock time in the future", () => {
    const s = scheduler.updateSchedule({ enabled: true, type: "daily", dailyTime: "04:15" });
    assert.ok(s.nextRunAt);
    const next = new Date(s.nextRunAt!);
    assert.equal(next.getHours(), 4);
    assert.equal(next.getMinutes(), 15);
    assert.ok(next.getTime() > Date.now(), "next run must be in the future");
    // Never more than 24h out.
    assert.ok(next.getTime() - Date.now() <= 24 * 60 * 60 * 1000 + 60_000);
  });

  it("accepts single-digit hours", () => {
    const s = scheduler.updateSchedule({ enabled: true, type: "daily", dailyTime: "7:05" });
    assert.equal(new Date(s.nextRunAt!).getHours(), 7);
  });
});

describe("interval scheduling", () => {
  it("schedules one interval ahead from now on a fresh enable", () => {
    const s = scheduler.updateSchedule({ enabled: true, type: "interval", intervalMinutes: 30 });
    const delta = new Date(s.nextRunAt!).getTime() - Date.now();
    assert.ok(delta > 29 * 60_000 && delta <= 30 * 60_000 + 5_000, `delta was ${delta}ms`);
  });

  it("without catch-up, an overdue slot moves a full interval out", () => {
    scheduler.updateSchedule({ enabled: true, type: "interval", intervalMinutes: 15, catchUp: false });
    const stored = readStored();
    stored.lastRunAt = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    stored.nextRunAt = null;
    fs.writeFileSync(scheduleFile(), JSON.stringify(stored));
    reload();

    const s = scheduler.getSchedule();
    const delta = new Date(s.nextRunAt!).getTime() - Date.now();
    assert.ok(delta > 14 * 60_000, `overdue run should be pushed forward, delta was ${delta}ms`);
  });

  it("with catch-up, an overdue slot stays due immediately", () => {
    scheduler.updateSchedule({ enabled: true, type: "interval", intervalMinutes: 15, catchUp: true });
    const stored = readStored();
    stored.lastRunAt = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    stored.nextRunAt = null;
    fs.writeFileSync(scheduleFile(), JSON.stringify(stored));
    reload();

    const s = scheduler.getSchedule();
    assert.ok(new Date(s.nextRunAt!).getTime() <= Date.now() + 1_000, "catch-up should keep the run due");
  });
});

describe("due-timestamp stability", () => {
  it("getSchedule never pushes an already-due nextRunAt forward", () => {
    scheduler.updateSchedule({ enabled: true, type: "daily", dailyTime: "03:00" });
    const due = new Date(Date.now() - 5_000).toISOString();
    const stored = readStored();
    stored.nextRunAt = due;
    fs.writeFileSync(scheduleFile(), JSON.stringify(stored));
    reload();

    // Two consecutive reads (as the admin UI polls) must not lose the due slot.
    assert.equal(scheduler.getSchedule().nextRunAt, due);
    assert.equal(scheduler.getSchedule().nextRunAt, due);
  });

  it("clears nextRunAt when disabled", () => {
    scheduler.updateSchedule({ enabled: true, type: "daily", dailyTime: "03:00" });
    const s = scheduler.updateSchedule({ enabled: false });
    assert.equal(s.nextRunAt, null);
  });
});

describe("validation", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["interval below the 15 minute floor", { intervalMinutes: 5 }],
    ["interval above one week", { intervalMinutes: 20_000 }],
    ["non-integer interval", { intervalMinutes: 20.5 }],
    ["malformed daily time", { dailyTime: "25:99" }],
    ["daily time without minutes", { dailyTime: "07" }],
    ["history mode", { mode: "history" }],
    ["unknown mode", { mode: "nope" }],
    ["unconfigured feed", { feeds: ["does_not_exist"] }],
    ["non-boolean enabled", { enabled: "yes" }],
    ["non-boolean catchUp", { catchUp: "yes" }],
    ["bad schedule type", { type: "hourly" }],
  ];

  for (const [label, patch] of cases) {
    it(`rejects ${label}`, () => {
      assert.throws(() => scheduler.updateSchedule(patch as any));
    });
  }

  it("accepts a configured feed subset", () => {
    const s = scheduler.updateSchedule({ feeds: ["bbc_english_top"] });
    assert.deepEqual(s.feeds, ["bbc_english_top"]);
  });

  it("treats an empty feed list as all feeds", () => {
    const s = scheduler.updateSchedule({ feeds: [] });
    assert.equal(s.feeds, null);
  });

  it("keeps prior config when a later field is invalid", () => {
    scheduler.updateSchedule({ enabled: true, dailyTime: "05:00" });
    assert.throws(() => scheduler.updateSchedule({ dailyTime: "nope" }));
    assert.equal(scheduler.getSchedule().dailyTime, "05:00");
  });
});

describe("persistence", () => {
  it("survives a reload from disk", () => {
    scheduler.updateSchedule({
      enabled: true,
      type: "interval",
      intervalMinutes: 90,
      mode: "retry",
      feeds: ["time_english_top"],
      catchUp: false,
    });
    reload();

    const s = scheduler.getSchedule();
    assert.equal(s.enabled, true);
    assert.equal(s.type, "interval");
    assert.equal(s.intervalMinutes, 90);
    assert.equal(s.mode, "retry");
    assert.deepEqual(s.feeds, ["time_english_top"]);
    assert.equal(s.catchUp, false);
  });

  it("falls back to defaults on a corrupt state file", () => {
    fs.writeFileSync(scheduleFile(), "{ this is not json");
    reload();
    const s = scheduler.getSchedule();
    assert.equal(s.enabled, false);
    assert.equal(s.dailyTime, "03:00");
  });

  it("sanitises out-of-range stored values", () => {
    fs.writeFileSync(
      scheduleFile(),
      JSON.stringify({ enabled: true, type: "interval", intervalMinutes: 1, dailyTime: "99:99", mode: "history" }),
    );
    reload();
    const s = scheduler.getSchedule();
    assert.equal(s.intervalMinutes, 360, "sub-floor interval should fall back to the default");
    assert.equal(s.dailyTime, "03:00");
    assert.equal(s.mode, "latest", "history must never be restorable for automation");
  });
});
