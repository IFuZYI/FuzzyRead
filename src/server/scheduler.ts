import { isBusy, onJobFinished, readFeeds, startJob, type JobMode, type NewsJob } from "./jobs";
import { readJson, stateDir, writeJson } from "./store";
import path from "node:path";

export type ScheduleType = "interval" | "daily";

export interface ScheduleConfig {
  enabled: boolean;
  type: ScheduleType;
  /** interval mode: minutes between runs (min 15) */
  intervalMinutes: number;
  /** daily mode: local wall-clock time, "HH:MM" */
  dailyTime: string;
  mode: JobMode;
  feeds: string[] | null;
  /** run a missed schedule as soon as the server is back up */
  catchUp: boolean;
}

export interface ScheduleState extends ScheduleConfig {
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  /** id of the job the scheduler most recently launched */
  lastJobId: string | null;
  nextRunAt: string | null;
}

const DEFAULTS: ScheduleConfig = {
  enabled: false,
  type: "daily",
  intervalMinutes: 360,
  dailyTime: "03:00",
  mode: "latest",
  feeds: null,
  catchUp: true,
};

const TICK_MS = 30_000;
const MIN_INTERVAL_MINUTES = 15;

let state: ScheduleState | null = null;
let timer: NodeJS.Timeout | null = null;

function configFile() {
  return path.join(stateDir(), "schedule.json");
}

function parseDailyTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function computeNextRun(config: ScheduleConfig, from: Date, lastRunAt: string | null): string | null {
  if (!config.enabled) return null;

  if (config.type === "interval") {
    const base = lastRunAt ? new Date(lastRunAt) : from;
    const next = new Date(base.getTime() + config.intervalMinutes * 60_000);
    if (next.getTime() > from.getTime()) return next.toISOString();
    // The slot already passed. With catch-up we run at once; otherwise we wait
    // a full interval from now so a long downtime can't cause a burst.
    return config.catchUp
      ? from.toISOString()
      : new Date(from.getTime() + config.intervalMinutes * 60_000).toISOString();
  }

  const parsed = parseDailyTime(config.dailyTime) ?? { hour: 3, minute: 0 };
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setHours(parsed.hour, parsed.minute, 0, 0);
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

function load(): ScheduleState {
  if (state) return state;
  const stored = readJson<Partial<ScheduleState>>(configFile(), {});
  const config: ScheduleConfig = {
    enabled: stored.enabled === true,
    type: stored.type === "interval" ? "interval" : "daily",
    intervalMinutes:
      typeof stored.intervalMinutes === "number" && stored.intervalMinutes >= MIN_INTERVAL_MINUTES
        ? Math.floor(stored.intervalMinutes)
        : DEFAULTS.intervalMinutes,
    dailyTime: typeof stored.dailyTime === "string" && parseDailyTime(stored.dailyTime) ? stored.dailyTime : DEFAULTS.dailyTime,
    mode: stored.mode === "retry" ? "retry" : "latest",
    feeds: Array.isArray(stored.feeds) && stored.feeds.length ? stored.feeds.filter(f => typeof f === "string") : null,
    catchUp: stored.catchUp !== false,
  };
  state = {
    ...config,
    lastRunAt: typeof stored.lastRunAt === "string" ? stored.lastRunAt : null,
    lastStatus: typeof stored.lastStatus === "string" ? stored.lastStatus : null,
    lastError: typeof stored.lastError === "string" ? stored.lastError : null,
    lastJobId: typeof stored.lastJobId === "string" ? stored.lastJobId : null,
    nextRunAt: typeof stored.nextRunAt === "string" ? stored.nextRunAt : null,
  };
  if (!config.enabled) {
    state.nextRunAt = null;
  } else if (!state.nextRunAt) {
    state.nextRunAt = computeNextRun(config, new Date(), state.lastRunAt);
  }
  return state;
}

function persist(): void {
  if (!state) return;
  try {
    writeJson(configFile(), state);
  } catch (err) {
    console.warn("[schedule] failed to persist:", (err as Error).message);
  }
}

export function getSchedule(): ScheduleState {
  const current = load();
  // Only fill in a missing nextRunAt. Never recompute an existing one here:
  // a due timestamp must survive until the ticker consumes it, otherwise a
  // page load a few seconds after the due time would push the run to tomorrow.
  if (!current.enabled) {
    current.nextRunAt = null;
  } else if (!current.nextRunAt) {
    current.nextRunAt = computeNextRun(current, new Date(), current.lastRunAt);
  }
  return current;
}

export function updateSchedule(patch: Partial<ScheduleConfig>): ScheduleState {
  const current = load();

  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== "boolean") throw new Error("enabled 必须是布尔值");
    current.enabled = patch.enabled;
  }

  if (patch.type !== undefined) {
    if (patch.type !== "interval" && patch.type !== "daily") throw new Error("调度类型无效");
    current.type = patch.type;
  }

  if (patch.intervalMinutes !== undefined) {
    const value = Number(patch.intervalMinutes);
    if (!Number.isInteger(value) || value < MIN_INTERVAL_MINUTES || value > 60 * 24 * 7) {
      throw new Error(`间隔必须是 ${MIN_INTERVAL_MINUTES} 到 10080 之间的整数分钟`);
    }
    current.intervalMinutes = value;
  }

  if (patch.dailyTime !== undefined) {
    if (typeof patch.dailyTime !== "string" || !parseDailyTime(patch.dailyTime)) {
      throw new Error("每日执行时间格式应为 HH:MM");
    }
    current.dailyTime = patch.dailyTime.trim();
  }

  if (patch.mode !== undefined) {
    if (patch.mode !== "latest" && patch.mode !== "retry") {
      throw new Error("自动任务仅支持 latest 或 retry 模式");
    }
    current.mode = patch.mode;
  }

  if (patch.feeds !== undefined) {
    if (patch.feeds === null) {
      current.feeds = null;
    } else {
      if (!Array.isArray(patch.feeds) || patch.feeds.some(f => typeof f !== "string")) {
        throw new Error("订阅源参数无效");
      }
      const configured = new Set(Object.keys(readFeeds()));
      const unknown = patch.feeds.filter(f => !configured.has(f));
      if (unknown.length) throw new Error(`包含未配置的订阅源: ${unknown.join(", ")}`);
      current.feeds = patch.feeds.length ? patch.feeds : null;
    }
  }

  if (patch.catchUp !== undefined) {
    if (typeof patch.catchUp !== "boolean") throw new Error("catchUp 必须是布尔值");
    current.catchUp = patch.catchUp;
  }

  current.nextRunAt = computeNextRun(current, new Date(), current.lastRunAt);
  persist();
  return current;
}

function fire(reason: string): void {
  const current = load();
  if (isBusy()) return; // a manual job wins; the next tick retries

  try {
    const job = startJob({ mode: current.mode, feeds: current.feeds, trigger: "schedule" });
    current.lastStatus = "running";
    current.lastError = null;
    current.lastJobId = job.id;
    console.log(`[schedule] ${reason} -> started ${current.mode} job ${job.id}`);
  } catch (err) {
    current.lastStatus = "error";
    current.lastError = (err as Error).message;
    console.warn(`[schedule] ${reason} -> failed: ${current.lastError}`);
  }

  current.lastRunAt = new Date().toISOString();
  current.nextRunAt = computeNextRun(current, new Date(), current.lastRunAt);
  persist();
}

function tick(): void {
  const current = load();
  if (!current.enabled) return;
  const now = Date.now();
  const next = current.nextRunAt ? new Date(current.nextRunAt).getTime() : null;
  if (next !== null && next <= now) fire("scheduled time reached");
}

/** Start the in-process ticker. Safe to call once at boot. */
export function startScheduler(): void {
  if (timer) return;
  const current = load();

  // Record the terminal status of any job the scheduler launched.
  onJobFinished((job: NewsJob) => {
    if (job.trigger !== "schedule") return;
    const s = load();
    s.lastStatus = job.status;
    s.lastError = job.error ?? null;
    s.lastJobId = job.id;
    persist();
  });

  if (current.enabled && current.catchUp && current.nextRunAt) {
    const overdue = new Date(current.nextRunAt).getTime() <= Date.now();
    if (overdue) fire("missed run detected at startup");
  }

  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  console.log(
    current.enabled
      ? `[schedule] enabled (${current.type === "daily" ? `daily ${current.dailyTime}` : `every ${current.intervalMinutes}m`}, mode=${current.mode}), next run ${current.nextRunAt}`
      : "[schedule] disabled",
  );
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Reset in-memory state. Test-only helper. */
export function resetScheduleForTests(): void {
  stopScheduler();
  state = null;
}
