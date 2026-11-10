// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionKey } from './secret';

const holder = globalThis as typeof globalThis & { __vcSessionKey?: Buffer };
const GOOD = 'a-session-secret-of-at-least-32-characters';

beforeEach(() => {
  vi.stubEnv('VC_SESSION_SECRET', '');
  vi.stubEnv('VC_PROVIDER', '');
  holder.__vcSessionKey = undefined;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sessionKey', () => {
  it('derives the key from VC_SESSION_SECRET, the same one every time', () => {
    vi.stubEnv('VC_SESSION_SECRET', GOOD);
    expect(sessionKey().equals(sessionKey())).toBe(true);
    vi.stubEnv('VC_SESSION_SECRET', `${GOOD}-other`);
    expect(sessionKey().equals(Buffer.from(GOOD))).toBe(false);
  });

  it('refuses a secret shorter than 32 characters, in any mode', () => {
    vi.stubEnv('VC_SESSION_SECRET', 'short');
    expect(() => sessionKey()).toThrow('session-secret-too-short');
  });

  it('without a secret, a random per-process key is used and logged once as a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = sessionKey();
    expect(sessionKey().equals(first)).toBe(true);
    expect(first.length).toBe(32);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('VC_SESSION_SECRET');
  });

  it('in paid mode (VC_PROVIDER=magnific) a missing secret refuses to start', () => {
    vi.stubEnv('VC_PROVIDER', 'magnific');
    expect(() => sessionKey()).toThrow('session-secret-required');
    vi.stubEnv('VC_SESSION_SECRET', GOOD);
    expect(() => sessionKey()).not.toThrow();
  });
});
