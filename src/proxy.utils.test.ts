import { describe, it, expect } from 'vitest';
import { extractCacheSalt, extractUsage } from './proxy.js';

describe('extractCacheSalt', () => {
  it('should extract cache_salt from valid JSON', () => {
    const body = JSON.stringify({ cache_salt: 'abc123', prompt: 'test' });
    expect(extractCacheSalt(body)).toBe('abc123');
  });

  it('should return null when cache_salt is not present', () => {
    const body = JSON.stringify({ prompt: 'test' });
    expect(extractCacheSalt(body)).toBeNull();
  });

  it('should return null for invalid JSON', () => {
    const body = 'not valid json';
    expect(extractCacheSalt(body)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(extractCacheSalt('')).toBeNull();
  });

  it('should return null when cache_salt is undefined', () => {
    const body = JSON.stringify({ cache_salt: undefined });
    expect(extractCacheSalt(body)).toBeNull();
  });
});

describe('extractUsage', () => {
  it('should extract all token counts from valid usage object', () => {
    const body = JSON.stringify({
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });
    expect(extractUsage(body)).toEqual({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    });
  });

  it('should return empty object when usage is not present', () => {
    const body = JSON.stringify({ prompt: 'test' });
    expect(extractUsage(body)).toEqual({});
  });

  it('should return empty object for invalid JSON', () => {
    const body = 'not valid json';
    expect(extractUsage(body)).toEqual({});
  });

  it('should handle partial usage data', () => {
    const body = JSON.stringify({
      usage: {
        prompt_tokens: 10,
      },
    });
    expect(extractUsage(body)).toEqual({
      prompt_tokens: 10,
    });
  });

  it('should handle zero token counts', () => {
    const body = JSON.stringify({
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    });
    expect(extractUsage(body)).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  });
});
