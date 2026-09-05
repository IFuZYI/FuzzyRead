import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let root: string;
let originalCwd: string;
let indexApi: typeof import('../src/server/articleIndex');

beforeAll(async () => {
  originalCwd = process.cwd();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fuzyread-index-'));
  fs.mkdirSync(path.join(root, 'data', 'articles', 'bbc_english_top_articles', '2026'), { recursive: true });
  process.chdir(root);
  process.env.DATA_DIR = 'data';
  delete process.env.ARTICLES_DIR;
  indexApi = await import('../src/server/articleIndex');
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  indexApi.invalidateArticleIndex();
  fs.writeFileSync(
    path.join(root, 'data', 'articles', 'bbc_english_top_articles', '2026', '20260614_First.md'),
    '---\ntitle: First indexed article\ndate: 20260614\noriginal_link: https://example.com/first\n---\n\nBody\n',
  );
});

describe('article index', () => {
  it('builds metadata in SQLite without parsing bodies on API reads', () => {
    const index = indexApi.loadArticleIndex();
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({ id: '20260614_First', title: 'First indexed article', date: '20260614' });
    expect(fs.existsSync(path.join(root, 'data', 'state', 'articles.sqlite'))).toBe(true);
  });

  it('reuses unchanged metadata after a restart', () => {
    const first = indexApi.loadArticleIndex();
    const second = indexApi.loadArticleIndex();
    expect(second).toEqual(first);
  });

  it('reparses a changed file and removes deleted files', () => {
    const file = path.join(root, 'data', 'articles', 'bbc_english_top_articles', '2026', '20260614_First.md');
    expect(indexApi.loadArticleIndex()[0].title).toBe('First indexed article');
    fs.writeFileSync(file, '# Updated title\n\n**Date:** 20260615\n');
    const changed = indexApi.loadArticleIndex();
    expect(changed[0]).toMatchObject({ title: 'Updated title', date: '20260615' });

    fs.rmSync(file);
    expect(indexApi.loadArticleIndex()).toHaveLength(0);
  });

  it('keeps separate channels and supports article lookup by id', () => {
    const secondDir = path.join(root, 'data', 'articles', 'time_english_top_articles', '2026');
    fs.mkdirSync(secondDir, { recursive: true });
    fs.writeFileSync(path.join(secondDir, '20260613_Second.md'), '# Second\n\n**Date:** 20260613\n');
    const index = indexApi.loadArticleIndex();
    expect(index.map(article => article.sourceChannel)).toEqual(['bbc_english_top_articles', 'time_english_top_articles']);
  });
});
