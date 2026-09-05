import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { articlesDir, stateDir } from './store';

export interface IndexedArticle {
  id: string;
  title: string;
  date: string;
  originalLink: string;
  sourceChannel: string;
  filePath: string;
  mtimeMs: number;
  size: number;
}

function dbPath(): string { return path.join(stateDir(), 'articles.sqlite'); }

function allMarkdownFiles(root: string): string[] {
  const result: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) result.push(full);
    }
  };
  walk(root);
  return result;
}

function parseMetadata(content: string, filename: string): Pick<IndexedArticle, 'title' | 'date' | 'originalLink'> {
  let title = '';
  let date = '';
  let originalLink = '';
  const front = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  for (const line of (front?.[1] ?? '').split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index < 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key === 'title') title = value;
    else if (key === 'date') date = value;
    else if (key === 'originallink' || key === 'original_link') originalLink = value;
  }
  if (!title) title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? filename.replace(/^\d{8}_/, '').replace(/\.md$/, '').replace(/_/g, ' ');
  if (!date) date = content.match(/\*\*Date:\*\*\s*(\d{8})/)?.[1] ?? filename.match(/^(\d{8})/)?.[1] ?? '19700101';
  if (!originalLink) {
    const link = content.match(/\*\*Original Link:\*\*\s*\[?([^\]\n]+)\]?\(([^\)]+)\)/) ?? content.match(/\*\*Original Link:\*\*\s*(https?:\/\/[^\s]+)/);
    originalLink = link?.[2] ?? link?.[1] ?? '';
  }
  return { title, date, originalLink };
}

function openDatabase(): DatabaseSync {
  fs.mkdirSync(stateDir(), { recursive: true });
  const db = new DatabaseSync(dbPath());
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS articles (
      file_path TEXT PRIMARY KEY,
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      original_link TEXT NOT NULL DEFAULT '',
      source_channel TEXT NOT NULL,
      mtime_ms REAL NOT NULL,
      size INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_articles_date ON articles(date DESC);
  `);
  return db;
}

/**
 * Build or incrementally refresh the SQLite metadata index. Unchanged files
 * (same relative path, mtime, and size) are never parsed again, including after
 * a server restart. Removed files are deleted from the index in the same tx.
 */
export function loadArticleIndex(): IndexedArticle[] {
  const root = articlesDir();
  if (!fs.existsSync(root)) return [];
  const files = new Map<string, { mtimeMs: number; size: number }>();
  for (const full of allMarkdownFiles(root)) {
    try {
      const stat = fs.statSync(full);
      files.set(path.relative(root, full).replace(/\\/g, '/'), { mtimeMs: stat.mtimeMs, size: stat.size });
    } catch { /* file disappeared during scan */ }
  }

  const db = openDatabase();
  try {
    db.exec('BEGIN IMMEDIATE');
    const existing = db.prepare('SELECT file_path AS filePath, id, title, date, original_link AS originalLink, source_channel AS sourceChannel, mtime_ms AS mtimeMs, size FROM articles').all() as unknown as IndexedArticle[];
    const oldByPath = new Map(existing.map(article => [article.filePath, article]));
    const upsert = db.prepare(`INSERT INTO articles (file_path,id,title,date,original_link,source_channel,mtime_ms,size)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(file_path) DO UPDATE SET id=excluded.id,title=excluded.title,date=excluded.date,
      original_link=excluded.original_link,source_channel=excluded.source_channel,mtime_ms=excluded.mtime_ms,size=excluded.size`);
    const remove = db.prepare('DELETE FROM articles WHERE file_path = ?');
    const result: IndexedArticle[] = [];

    for (const [filePath, stat] of files) {
      const old = oldByPath.get(filePath);
      if (old && old.mtimeMs === stat.mtimeMs && old.size === stat.size) {
        result.push(old);
        oldByPath.delete(filePath);
        continue;
      }
      const full = path.join(root, filePath);
      const parsed = parseMetadata(fs.readFileSync(full, 'utf8'), path.basename(full));
      const article: IndexedArticle = {
        id: path.basename(full).replace(/\.md$/, ''),
        ...parsed,
        sourceChannel: filePath.split('/')[0],
        filePath,
        ...stat,
      };
      upsert.run(article.filePath, article.id, article.title, article.date, article.originalLink, article.sourceChannel, article.mtimeMs, article.size);
      result.push(article);
      oldByPath.delete(filePath);
    }
    for (const stale of oldByPath.keys()) remove.run(stale);
    db.exec('COMMIT');
    result.sort((a, b) => b.date.localeCompare(a.date));
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* no active tx */ }
    throw error;
  } finally {
    db.close();
  }
}

/** Clear the index, useful after changing metadata parsing rules. */
export function invalidateArticleIndex(): void {
  try { fs.rmSync(dbPath(), { force: true }); } catch { /* already absent */ }
  try { fs.rmSync(`${dbPath()}-wal`, { force: true }); } catch { /* already absent */ }
  try { fs.rmSync(`${dbPath()}-shm`, { force: true }); } catch { /* already absent */ }
}
