import { describe, expect, it } from 'vitest';
import { readTheme } from './theme';

describe('readTheme', () => {
  it('returns the stored choice', () => {
    expect(readTheme('dark')).toBe('dark');
    expect(readTheme('light')).toBe('light');
  });
  it('falls back to system for a missing or unknown value', () => {
    expect(readTheme(undefined)).toBe('system');
    expect(readTheme('purple')).toBe('system');
  });
});
