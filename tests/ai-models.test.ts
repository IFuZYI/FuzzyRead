import { describe, expect, it } from 'vitest';
import { modelIdsFromResponse, normalizeOpenAIBaseUrl } from '../src/utils/settingsModel';

describe('AI upstream model helpers', () => {
  it('normalizes OpenAI-compatible endpoint suffixes', () => {
    expect(normalizeOpenAIBaseUrl(' https://newapi.example.com/v1/chat/completions/ ')).toBe('https://newapi.example.com/v1');
    expect(normalizeOpenAIBaseUrl('https://newapi.example.com/v1/models')).toBe('https://newapi.example.com/v1');
  });

  it('extracts model IDs from OpenAI-compatible responses', () => {
    expect(modelIdsFromResponse({ data: [{ id: 'gpt-4o', owned_by: 'openai' }, { id: 'qwen-plus' }, 'deepseek-chat', { name: 'invalid' }] })).toEqual(['gpt-4o', 'qwen-plus', 'deepseek-chat']);
    expect(modelIdsFromResponse({ data: [] })).toEqual([]);
    expect(modelIdsFromResponse({ models: [{ id: 'wrong-shape' }] })).toEqual([]);
  });
});
