import { describe, expect, it, beforeEach } from 'vitest';
import { filterArticles, paginateArticles, totalPages } from '../src/utils/articleFilters';
import { loadAISettings, loadPreferences, saveAISettings, savePreferences } from '../src/utils/preferences';
import type { AISettings, ArticleMeta, ReadingPreferences } from '../src/types';

const articles: ArticleMeta[] = [
  { id: 'bbc-a', title: 'Climate and Cities', titleZh: '气候与城市', date: '20260614', sourceChannel: 'bbc_english_top_articles', originalLink: '', filePath: '' },
  { id: 'bbc-b', title: 'World Cup Preview', titleZh: '', date: '20260605', sourceChannel: 'bbc_english_top_articles', originalLink: '', filePath: '' },
  { id: 'time-a', title: 'The Future of Work', titleZh: '工作的未来', date: '20260530', sourceChannel: 'time_english_top_articles', originalLink: '', filePath: '' },
];

const preferences: ReadingPreferences = { fontSize: 'lg', fontFamily: 'times', autoplayAudio: true };
const settings: AISettings = { engine: 'free', model: 'Microsoft Translate Free', apiKey: '', baseUrl: '' };

describe('articleFilters', () => {
  it('filters by channel including legacy aliases', () => {
    expect(filterArticles({ articles, channel: 'bbc_news', quickRange: 'all' }).map(a => a.id)).toEqual(['bbc-a', 'bbc-b']);
    expect(filterArticles({ articles, channel: 'time_english_top', quickRange: 'all' }).map(a => a.id)).toEqual(['time-a']);
  });

  it('filters by quick range and explicit dates', () => {
    expect(filterArticles({ articles, channel: 'all', quickRange: 'june' }).map(a => a.id)).toEqual(['bbc-a', 'bbc-b']);
    expect(filterArticles({ articles, channel: 'all', quickRange: 'all', startDate: '2026-06-10' }).map(a => a.id)).toEqual(['bbc-a']);
  });

  it('searches English, Chinese, translated titles, and ids', () => {
    expect(filterArticles({ articles, channel: 'all', quickRange: 'all', query: '未来' }).map(a => a.id)).toEqual(['time-a']);
    expect(filterArticles({ articles, channel: 'all', quickRange: 'all', query: 'translated', translatedTitles: { 'bbc-b': { text: 'Translated headline' } } }).map(a => a.id)).toEqual(['bbc-b']);
  });

  it('paginates safely and reports at least one page', () => {
    expect(paginateArticles([1, 2, 3], 2, 2)).toEqual([3]);
    expect(paginateArticles([1, 2, 3], 0, 2)).toEqual([1, 2]);
    expect(totalPages(0)).toBe(1);
    expect(totalPages(21)).toBe(3);
  });
});

describe('preferences persistence', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips preferences through localStorage', () => {
    savePreferences({ ...preferences, fontSize: '2xl' });
    expect(loadPreferences(preferences).fontSize).toBe('2xl');
  });

  it('merges defaults and survives corrupt stored JSON', () => {
    window.localStorage.setItem('bi_reader_preferences', '{bad');
    expect(loadPreferences(preferences)).toEqual(preferences);
  });

  it('merges cookie keys over saved AI settings', () => {
    saveAISettings({ ...settings, engine: 'openai', model: 'gpt-4o' });
    const loaded = loadAISettings(settings, { openaiKey: 'cookie-key' });
    expect(loaded.engine).toBe('openai');
    expect(loaded.openaiKey).toBe('cookie-key');
  });
});
