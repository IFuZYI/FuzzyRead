import type { TranslationEngine } from '../types';

export const DEFAULT_MODELS: Record<TranslationEngine, string[]> = {
  free: ['Microsoft Translate Free', 'Google Translate Free', 'Microsoft Azure Translate', 'Google Cloud Translate'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1-mini'],
  gemini: ['gemini-3.5-flash', 'gemini-3.1-pro-preview'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  other: ['custom-model'],
};

export const DEFAULT_BASES: Record<TranslationEngine, string> = {
  free: '',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseek: 'https://api.deepseek.com',
  other: '',
};

export const FONT_SIZES = [
  { label: '小', value: 'sm', class: 'text-sm' },
  { label: '标准', value: 'base', class: 'text-base' },
  { label: '中', value: 'lg', class: 'text-lg' },
  { label: '大', value: 'xl', class: 'text-xl' },
  { label: '特大', value: '2xl', class: 'text-2xl' },
] as const;

export function activeProviderKey(settings: { engine: TranslationEngine; apiKey: string; openaiKey?: string; geminiKey?: string; deepseekKey?: string; otherKey?: string }): string {
  if (settings.engine === 'openai') return settings.openaiKey ?? settings.apiKey ?? '';
  if (settings.engine === 'gemini') return settings.geminiKey ?? settings.apiKey ?? '';
  if (settings.engine === 'deepseek') return settings.deepseekKey ?? settings.apiKey ?? '';
  if (settings.engine === 'other') return settings.otherKey ?? settings.apiKey ?? '';
  return '';
}

export function activeProviderBase(settings: { engine: TranslationEngine; baseUrl: string; openaiBase?: string; geminiBase?: string; deepseekBase?: string; otherBase?: string }): string {
  if (settings.engine === 'openai') return settings.openaiBase ?? settings.baseUrl ?? DEFAULT_BASES.openai;
  if (settings.engine === 'gemini') return settings.geminiBase ?? settings.baseUrl ?? DEFAULT_BASES.gemini;
  if (settings.engine === 'deepseek') return settings.deepseekBase ?? settings.baseUrl ?? DEFAULT_BASES.deepseek;
  if (settings.engine === 'other') return settings.otherBase ?? settings.baseUrl ?? '';
  return '';
}
