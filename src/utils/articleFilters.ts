import type { ArticleMeta } from '../types';

export interface ArticleFilterInput {
  articles: ArticleMeta[];
  channel: string;
  quickRange: 'all' | '10days' | 'june';
  startDate?: string;
  endDate?: string;
  query?: string;
  translatedTitles?: Record<string, { text?: string }>;
}

/** Apply the reader's channel, date, and keyword filters without React state. */
export function filterArticles(input: ArticleFilterInput): ArticleMeta[] {
  const {
    articles,
    channel,
    quickRange,
    startDate = '',
    endDate = '',
    query = '',
    translatedTitles = {},
  } = input;
  let result = articles;
  const normalizedChannel = channel === 'bbc_news'
    ? 'bbc_english_top_articles'
    : channel === 'time_english_top'
      ? 'time_english_top_articles'
      : channel;

  if (normalizedChannel !== 'home' && normalizedChannel !== 'all') {
    result = result.filter(article => article.sourceChannel === normalizedChannel);
  }
  if (quickRange === '10days') result = result.filter(article => article.date >= '20260605');
  if (quickRange === 'june') result = result.filter(article => article.date >= '20260601' && article.date <= '20260630');

  const compactStart = startDate.replace(/-/g, '');
  const compactEnd = endDate.replace(/-/g, '');
  if (compactStart) result = result.filter(article => article.date >= compactStart);
  if (compactEnd) result = result.filter(article => article.date <= compactEnd);

  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery) {
    result = result.filter(article => (
      article.title.toLowerCase().includes(normalizedQuery)
      || Boolean(article.titleZh && article.titleZh.toLowerCase().includes(normalizedQuery))
      || Boolean(translatedTitles[article.id]?.text?.toLowerCase().includes(normalizedQuery))
      || article.id.toLowerCase().includes(normalizedQuery)
    ));
  }
  return result;
}

export function paginateArticles<T>(items: T[], page: number, pageSize = 10): T[] {
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.floor(pageSize));
  return items.slice((safePage - 1) * safeSize, safePage * safeSize);
}

export function totalPages(itemCount: number, pageSize = 10): number {
  return Math.max(1, Math.ceil(Math.max(0, itemCount) / Math.max(1, pageSize)));
}
