import { spawn, ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  feedsPath,
  harvesterDir,
  readJson,
  stateDir,
  writeJson,
} from "./store";

export type JobMode = "latest" | "history" | "retry";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "timeout";
export type JobTrigger = "manual" | "schedule";

/** Bad request payload — the caller must change the request (HTTP 400). */
export class JobValidationError extends Error {}

/** A job is already running, or the environment is not ready (HTTP 409). */
export class JobConflictError extends Error {}

export interface NewsJob {
  id: string;
  mode: JobMode;
  feeds: string[] | null;
  start?: number;
  end?: number;
  status: JobStatus;
  trigger: JobTrigger;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  savedCount?: number;
  output?: string;
  error?: string;
}

export interface JobRequest {
  mode: JobMode;
  feeds?: string[] | null;
  start?: number;
  end?: number;
  trigger?: JobTrigger;
}

const MODES: JobMode[] = ["latest", "history", "retry"];
const MAX_HISTORY = 60;
const OUTPUT_LIMIT = 200_000;

let jobs: NewsJob[] = [];
let activeProcess: ChildProcess | null = null;
let activeJobId: string | null = null;
let activeTimer: NodeJS.Timeout | null = null;
let loaded = false;

type JobDoneListener = (job: NewsJob) => void;
const doneListeners: JobDoneListener[] = [];

/** Subscribe to job completion (used by the scheduler to record outcomes). */
export function onJobFinished(listener: JobDoneListener): void {
  doneListeners.push(listener);
}

function historyFile() {
  return path.join(stateDir(), "jobs.json");
}

function jobTimeoutMs(): number {
  const raw = Number(process.env.JOB_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60 * 60 * 1000;
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const stored = readJson<NewsJob[]>(historyFile(), []);
  // A job recorded as running belongs to a process that died with the old
  // server — surface that honestly instead of showing a phantom running job.
  jobs = stored.map(job =>
    job.status === "running" || job.status === "queued"
      ? { ...job, status: "failed" as JobStatus, error: job.error || "服务重启，任务中断" }
      : job,
  );
}

function persist(): void {
  try {
    writeJson(historyFile(), jobs.slice(0, MAX_HISTORY));
  } catch (err) {
    console.warn("[jobs] failed to persist history:", (err as Error).message);
  }
}

export function readFeeds(): Record<string, string> {
  const parsed = readJson<Record<string, string>>(feedsPath(), {});
  return parsed && typeof parsed === "object" ? parsed : {};
}

export function listJobs(): NewsJob[] {
  load();
  return jobs;
}

export function getJob(id: string): NewsJob | undefined {
  load();
  return jobs.find(job => job.id === id);
}

export function isBusy(): boolean {
  return activeProcess !== null;
}

export function activeJob(): NewsJob | null {
  load();
  return activeJobId ? jobs.find(job => job.id === activeJobId) ?? null : null;
}

/** Pull the "saved N articles" count out of the harvester's console summary. */
function parseSavedCount(output: string): number | undefined {
  const match = output.match(/成功隔离落盘\s*(\d+)\s*篇/);
  if (match) return Number(match[1]);
  // Fall back to counting per-article success lines (history / retry modes).
  const landed = output.match(/成功落盘/g);
  return landed ? landed.length : undefined;
}

function validate(request: JobRequest): Required<Pick<JobRequest, "mode">> & {
  feeds: string[] | null;
  start: number;
  end: number;
  trigger: JobTrigger;
} {
  if (!MODES.includes(request.mode)) throw new JobValidationError("任务模式无效");

  if (request.feeds != null && (!Array.isArray(request.feeds) || request.feeds.some(f => typeof f !== "string"))) {
    throw new JobValidationError("订阅源参数无效");
  }
  const feeds = request.feeds && request.feeds.length ? request.feeds : null;

  const configured = new Set(Object.keys(readFeeds()));
  if (feeds) {
    const unknown = feeds.filter(feed => !configured.has(feed));
    if (unknown.length) throw new JobValidationError(`包含未配置的订阅源: ${unknown.join(", ")}`);
  }

  const currentYear = new Date().getFullYear();
  const start = request.start ?? 2020;
  const end = request.end ?? currentYear;
  if (request.mode === "history") {
    const valid =
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 2000 &&
      end >= start &&
      end <= currentYear + 1;
    if (!valid) throw new JobValidationError("历史任务年份范围无效");
  }

  const trigger: JobTrigger = request.trigger === "schedule" ? "schedule" : "manual";
  return { mode: request.mode, feeds, start, end, trigger };
}

export function startJob(request: JobRequest): NewsJob {
  load();
  const { mode, feeds, start, end, trigger } = validate(request);
  if (activeProcess) throw new JobConflictError("已有采集任务正在运行");

  const pythonSetting = process.env.PYTHON_BIN || "python3";
  const pythonBin = path.isAbsolute(pythonSetting)
    ? pythonSetting
    : path.resolve(process.cwd(), pythonSetting);
  if (pythonSetting.includes("/") && !fs.existsSync(pythonBin)) {
    throw new JobConflictError(`未找到 Python 解释器: ${pythonBin}（请检查 PYTHON_BIN）`);
  }

  const runner = path.join(harvesterDir(), "runner.py");
  if (!fs.existsSync(runner)) throw new JobConflictError(`未找到采集入口: ${runner}`);

  const job: NewsJob = {
    id: crypto.randomUUID(),
    mode,
    feeds,
    start: mode === "history" ? start : undefined,
    end: mode === "history" ? end : undefined,
    status: "running",
    trigger,
    startedAt: new Date().toISOString(),
  };

  const args = ["runner.py", "--mode", mode];
  if (feeds) args.push("--feeds", ...feeds);
  if (mode === "history") args.push("--start", String(start), "--end", String(end));

  const child = spawn(pythonBin, args, {
    cwd: harvesterDir(),
    env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONWARNINGS: "ignore::SyntaxWarning" },
  });

  activeProcess = child;
  activeJobId = job.id;
  jobs.unshift(job);
  jobs = jobs.slice(0, MAX_HISTORY);

  let output = "";
  const collect = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.length > OUTPUT_LIMIT) output = output.slice(-OUTPUT_LIMIT);
    job.output = output;
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  activeTimer = setTimeout(() => {
    if (activeProcess === child) {
      job.status = "timeout";
      job.error = `任务超过 ${Math.round(jobTimeoutMs() / 60000)} 分钟未完成，已终止`;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000);
    }
  }, jobTimeoutMs());

  const finish = () => {
    if (activeTimer) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }
    activeProcess = null;
    activeJobId = null;
    job.finishedAt = new Date().toISOString();
    job.durationMs = new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
    persist();
    for (const listener of doneListeners) {
      try {
        listener(job);
      } catch (err) {
        console.warn("[jobs] done listener failed:", (err as Error).message);
      }
    }
  };

  child.on("error", err => {
    job.status = "failed";
    job.error = err.message;
    finish();
  });

  child.on("close", code => {
    job.exitCode = code;
    if (job.status !== "cancelled" && job.status !== "timeout") {
      job.status = code === 0 ? "completed" : "failed";
      if (code !== 0 && !job.error) job.error = `采集进程退出码 ${code}`;
    }
    job.savedCount = parseSavedCount(output);
    finish();
  });

  persist();
  return job;
}

export function cancelJob(id: string): NewsJob {
  load();
  const job = jobs.find(j => j.id === id);
  if (!job) throw new Error("任务不存在");
  if (job.status !== "running") throw new Error("任务不在运行中");
  job.status = "cancelled";
  job.error = "任务已被手动取消";
  activeProcess?.kill("SIGTERM");
  persist();
  return job;
}

/** Trim long output before sending a job over the wire. */
export function publicJob(job: NewsJob) {
  return { ...job, output: job.output ? job.output.slice(-12_000) : undefined };
}
