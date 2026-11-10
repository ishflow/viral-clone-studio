import { afterEach, describe, expect, it, vi } from 'vitest';
import { data } from '@/data';
import { getStore, resetStore } from '@/data/mock/store';
import { POST } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
  resetStore();
});

describe('POST /dev/reset', () => {
  it('puts the fake store back to the fixtures', async () => {
    await data.admin.addCredits('usr-admin', 'usr-demo', 5, 'test', 'key-1');
    expect(await data.ledger.balance('usr-demo')).toBe(24);
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, speed: 1 });
    expect(await data.ledger.balance('usr-demo')).toBe(19);
  });

  it('does not exist in a production build: 404, and the store is left alone', async () => {
    await data.admin.addCredits('usr-admin', 'usr-demo', 5, 'test', 'key-2');
    const before = getStore();
    vi.stubEnv('NODE_ENV', 'production');
    const response = await POST();
    expect(response.status).toBe(404);
    expect(getStore()).toBe(before);
    expect(await data.ledger.balance('usr-demo')).toBe(24);
  });
});

it('clears the authentication rate limiter in development, preserving it in production', async () => {
  const { limiter } = await import('@/core/rate-limit/rate-limit');
  const rules = [{ key: 'reset-test', max: 1, windowMs: 60000 }];
  limiter.reset();
  expect(limiter.allow(rules)).toBe(true);
  expect(limiter.allow(rules)).toBe(false);
  vi.stubEnv('NODE_ENV', 'production');
  await POST();
  expect(limiter.allow(rules)).toBe(false);
  vi.stubEnv('NODE_ENV', 'development');
  await POST();
  expect(limiter.allow(rules)).toBe(true);
  limiter.reset();
});
