import type { AISettings, ReadingPreferences } from '../types';

export const AI_SETTINGS_STORAGE_KEY = 'bi_reader_ai_settings';
export const READING_PREFERENCES_STORAGE_KEY = 'bi_reader_preferences';

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadPreferences(defaults: ReadingPreferences): ReadingPreferences {
  if (!storageAvailable()) return defaults;
  try {
    const raw = window.localStorage.getItem(READING_PREFERENCES_STORAGE_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

export function savePreferences(preferences: ReadingPreferences): void {
  if (!storageAvailable()) return;
  window.localStorage.setItem(READING_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

export function loadAISettings(defaults: AISettings, cookieKeys: Partial<AISettings> = {}): AISettings {
  if (!storageAvailable()) return { ...defaults, ...cookieKeys };
  try {
    const raw = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed.engine === 'free' && (!parsed.model || !parsed.model.includes('Translate'))) {
      parsed.model = 'Microsoft Translate Free';
    }
    return { ...defaults, ...parsed, ...cookieKeys };
  } catch {
    return { ...defaults, ...cookieKeys };
  }
}

export function saveAISettings(settings: AISettings): void {
  if (!storageAvailable()) return;
  window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}
