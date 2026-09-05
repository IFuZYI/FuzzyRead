import fs from "node:fs";
import path from "node:path";

/**
 * Small atomic JSON store for admin state that must survive restarts.
 * Writes go to a temp file first, then rename — a crash mid-write can never
 * leave a truncated JSON file behind.
 */
export function dataDir(): string {
  return path.resolve(process.cwd(), process.env.DATA_DIR || "data");
}

export function stateDir(): string {
  return path.join(dataDir(), "state");
}

export function logsDir(): string {
  return path.join(dataDir(), "logs");
}

export function articlesDir(): string {
  const configured = process.env.ARTICLES_DIR;
  if (configured) return path.resolve(process.cwd(), configured);
  return path.join(dataDir(), "articles");
}

export function harvesterDir(): string {
  return path.resolve(process.cwd(), process.env.HARVESTER_DIR || "harvester");
}

export function feedsPath(): string {
  return path.join(harvesterDir(), "settings", "feeds.json");
}

/** Admin-editable display names for article channels. */
export function channelsPath(): string {
  return path.join(stateDir(), "channels.json");
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

/** Read only the last `bytes` of a file without loading the whole thing. */
export function readTail(file: string, bytes: number): string {
  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - bytes);
  const length = stat.size - start;
  if (length <= 0) return "";
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  const text = buffer.toString("utf8");
  // Drop a partial first line when we started mid-file.
  return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
}
