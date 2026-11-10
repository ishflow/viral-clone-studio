import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { resolveReturnTo } from './returnTo';

describe('resolveReturnTo', () => {
  it('keeps a same-site path', () => {
    expect(resolveReturnTo('/templates/tpl-eye/generate')).toBe('/templates/tpl-eye/generate');
  });
  it('drops anything else', () => {
    for (const v of ['https://evil.example', '//evil.example', '/login', '/\\\\evil.com', '/ //evil.com', undefined, ['/a', '/b']]) {
      expect(resolveReturnTo(v)).toBeUndefined();
    }
  });
});
