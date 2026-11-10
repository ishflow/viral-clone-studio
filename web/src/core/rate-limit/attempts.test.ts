// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

let forwardedFor: string | undefined;
let cloudflareIp: string | undefined;
let realIp: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}), ...(cloudflareIp ? { 'cf-connecting-ip': cloudflareIp } : {}), ...(realIp ? { 'x-real-ip': realIp } : {}) }),
}));

import { attemptAllowed, clientKey } from './attempts';
import { limiter } from './rate-limit';

beforeEach(() => {
  vi.stubEnv('VC_TRUST_PROXY', '');
  vi.stubEnv('VC_BIND_HOST', '127.0.0.1');
  forwardedFor = undefined;
  cloudflareIp = undefined;
  realIp = undefined;
  limiter.reset();
});

describe('attemptAllowed without a trusted proxy (every caller shares one bucket)', () => {
  it('a script that tries many addresses does not stop other people from logging in', async () => {
    for (let i = 0; i < 150; i++) await attemptAllowed('logIn', `victim-${i}@example.com`);
    expect(await attemptAllowed('logIn', 'real-user@example.com')).toBe(true);
  });
  it('the address rule still holds: one address cannot be tried without end', async () => {
    for (let i = 0; i < 10; i++) expect(await attemptAllowed('logIn', 'one@example.com')).toBe(true);
    expect(await attemptAllowed('logIn', 'one@example.com')).toBe(false);
  });
  it('a new password: a script that sends many different links is stopped, a link is no address rule', async () => {
    for (let i = 0; i < 1000; i++) expect(await attemptAllowed('setPassword', `made-up-link-${i}`)).toBe(true);
    expect(await attemptAllowed('setPassword', 'made-up-link-last')).toBe(false);
  });
  it('a reset: a script that asks for many different addresses is stopped, but far past what the people of one site send', async () => {
    for (let i = 0; i < 1000; i++) expect(await attemptAllowed('reset', `ghost-${i}@example.com`)).toBe(true);
    expect(await attemptAllowed('reset', 'ghost-last@example.com')).toBe(false);
  });
  it('ten thousand other addresses do not wash the lock of one address out of the memory', async () => {
    for (let i = 0; i < 10; i++) await attemptAllowed('logIn', 'victim@example.com');
    expect(await attemptAllowed('logIn', 'victim@example.com')).toBe(false);
    for (let i = 0; i < 10_001; i++) await attemptAllowed('logIn', `spray-${i}@example.com`);
    expect(await attemptAllowed('logIn', 'victim@example.com')).toBe(false);
  });
  it('the forwarding header is not believed: ten attempts on one address from "different callers" stop it for everybody, as before', async () => {
    for (let i = 0; i < 10; i++) {
      forwardedFor = `7.7.7.${i}`;
      expect(await attemptAllowed('logIn', 'one@example.com')).toBe(true);
    }
    forwardedFor = '1.2.3.4';
    expect(await attemptAllowed('logIn', 'one@example.com')).toBe(false);
  });
  it('an action with no address rule keeps its (widened) flood guard', async () => {
    for (let i = 0; i < 50; i++) expect(await attemptAllowed('signUp', `new-${i}@example.com`)).toBe(true);
    expect(await attemptAllowed('signUp', 'late@example.com')).toBe(false);
  });
});

describe('attemptAllowed behind a trusted proxy (callers are told apart)', () => {
  beforeEach(() => vi.stubEnv('VC_TRUST_PROXY', '1'));
  const from = (caller: string, action: Parameters<typeof attemptAllowed>[0], email: string) => {
    forwardedFor = caller;
    return attemptAllowed(action, email);
  };

  it('logIn: ten attempts of one caller on an address stop that caller, not another caller on the same address', async () => {
    for (let i = 0; i < 10; i++) expect(await from('6.6.6.6', 'logIn', 'owner@example.com')).toBe(true);
    expect(await from('6.6.6.6', 'logIn', 'owner@example.com')).toBe(false);
    expect(await from('1.2.3.4', 'logIn', 'Owner+tag@Example.com')).toBe(true);
  });
  it('logIn: twenty callers together stop one address at 20, for every caller; another address is not affected', async () => {
    for (let i = 0; i < 20; i++) expect(await from(`7.7.7.${i}`, 'logIn', 'owner@example.com')).toBe(true);
    expect(await from('7.7.7.99', 'logIn', 'owner@example.com')).toBe(false);
    expect(await from('7.7.7.0', 'logIn', 'owner@example.com')).toBe(false);
    expect(await from('7.7.7.99', 'logIn', 'other@example.com')).toBe(true);
  });
  it('logIn: a caller that is refused adds nothing to the count of the address', async () => {
    for (let i = 0; i < 40; i++) await from('6.6.6.6', 'logIn', 'owner@example.com');
    for (let i = 0; i < 10; i++) expect(await from(`7.7.7.${i}`, 'logIn', 'owner@example.com')).toBe(true);
    expect(await from('7.7.7.99', 'logIn', 'owner@example.com')).toBe(false);
  });
  it('logIn: the address rule is counted per caller (its own key), next to the count of the address for all callers', async () => {
    await from('6.6.6.6', 'logIn', 'owner@example.com');
    await from('1.2.3.4', 'logIn', 'owner@example.com');
    expect(limiter.keys().filter((k) => k.startsWith('logIn:email:')).sort()).toEqual([
      'logIn:email:owner@example.com',
      'logIn:email:owner@example.com FROM 1.2.3.4',
      'logIn:email:owner@example.com FROM 6.6.6.6',
    ]);
  });
  it('the other actions keep their address rule for all callers together: a reset stops at 3', async () => {
    for (let i = 0; i < 3; i++) expect(await from(`7.7.7.${i}`, 'reset', 'owner@example.com')).toBe(true);
    expect(await from('1.2.3.4', 'reset', 'owner@example.com')).toBe(false);
  });
});

describe('behind Cloudflare (VC_TRUST_PROXY=cloudflare): the caller is what Cloudflare wrote in cf-connecting-ip', () => {
  beforeEach(() => vi.stubEnv('VC_TRUST_PROXY', 'cloudflare'));
  const from = (caller: string, action: Parameters<typeof attemptAllowed>[0], email: string) => {
    cloudflareIp = caller;
    return attemptAllowed(action, email);
  };

  it('callers are told apart by cf-connecting-ip: the sixth sign-up of one caller is refused, another caller goes on', async () => {
    for (let i = 0; i < 5; i++) expect(await from('203.0.113.7', 'signUp', `new-${i}@example.com`)).toBe(true);
    expect(await from('203.0.113.7', 'signUp', 'sixth@example.com')).toBe(false);
    expect(await from('198.51.100.9', 'signUp', 'other@example.com')).toBe(true);
  });
  it('a made-up x-forwarded-for does not change the bucket: Cloudflare only adds to what the caller sent, so its first part is the caller\'s own word', async () => {
    for (let i = 0; i < 5; i++) {
      forwardedFor = `7.7.7.${i}, 203.0.113.7`;
      expect(await from('203.0.113.7', 'signUp', `new-${i}@example.com`)).toBe(true);
    }
    forwardedFor = '9.9.9.9, 203.0.113.7';
    realIp = '9.9.9.9';
    expect(await from('203.0.113.7', 'signUp', 'sixth@example.com')).toBe(false);
  });
  it('without cf-connecting-ip the request did not come through Cloudflare: x-forwarded-for and x-real-ip are not believed, it is in the shared bucket', async () => {
    forwardedFor = '7.7.7.7';
    realIp = '7.7.7.7';
    expect(await clientKey()).toEqual({ key: 'local', shared: true });
  });
  it('a cf-connecting-ip that is not one address is not a caller: the shared bucket', async () => {
    for (const value of ['1.2.3.4, 5.6.7.8', 'not-an-address', 'local']) {
      cloudflareIp = value;
      expect(await clientKey(), value).toEqual({ key: 'local', shared: true });
    }
  });
  it('one IPv6 /64 is one caller: changing the rest of the address does not open a new bucket', async () => {
    for (let i = 0; i < 5; i++) expect(await from(`2001:db8:1:2::${i + 1}`, 'signUp', `new-${i}@example.com`)).toBe(true);
    expect(await from('2001:db8:1:2:aaaa:bbbb:cccc:dddd', 'signUp', 'sixth@example.com')).toBe(false);
    expect(await from('2001:db8:1:3::1', 'signUp', 'neighbour@example.com')).toBe(true);
  });
  it('sign-up has a ceiling for all callers together: after fifty in an hour a caller who has sent nothing is refused too', async () => {
    for (let i = 0; i < 50; i++) expect(await from(`203.0.113.${i}`, 'signUp', `new-${i}@example.com`)).toBe(true);
    expect(await from('198.51.100.9', 'signUp', 'late@example.com')).toBe(false);
  });
  it('a caller refused by its own limit adds nothing to the ceiling', async () => {
    for (let i = 0; i < 30; i++) await from('203.0.113.7', 'signUp', `new-${i}@example.com`);
    for (let i = 0; i < 45; i++) expect(await from(`198.51.100.${i}`, 'signUp', `other-${i}@example.com`)).toBe(true);
    expect(await from('192.0.2.1', 'signUp', 'late@example.com')).toBe(false);
  });
  it('a request without the header (the shared bucket) counts under the same ceiling: there is no second fifty beside it', async () => {
    for (let i = 0; i < 25; i++) expect(await from(`203.0.113.${i}`, 'signUp', `new-${i}@example.com`)).toBe(true);
    for (let i = 0; i < 25; i++) expect(await from('', 'signUp', `local-${i}@example.com`)).toBe(true);
    expect(await from('', 'signUp', 'late@example.com')).toBe(false);
    expect(await from('198.51.100.9', 'signUp', 'later@example.com')).toBe(false);
  });
  it('the ceiling is of sign-up alone: a full one stops no log-in and no reset', async () => {
    for (let i = 0; i < 50; i++) await from(`203.0.113.${i}`, 'signUp', `new-${i}@example.com`);
    expect(await from('198.51.100.9', 'logIn', 'owner@example.com')).toBe(true);
    expect(await from('198.51.100.9', 'reset', 'owner@example.com')).toBe(true);
  });
  it('the ceiling is not washed out of the memory: a full one still refuses after thousands of log-in attempts from other callers', async () => {
    for (let i = 0; i < 50; i++) expect(await from(`203.0.113.${i}`, 'signUp', `new-${i}@example.com`)).toBe(true);
    for (let i = 0; i < 5_000; i++) await from(`10.${i >> 8}.${i & 255}.1`, 'logIn', `spray-${i}@example.com`);
    expect(limiter.size()).toBeLessThanOrEqual(10_000);
    expect(await from('198.51.100.9', 'signUp', 'late@example.com')).toBe(false);
  });
  it('the assumption, held by a test: only a loopback site has Cloudflare as its one door. Bound elsewhere, cf-connecting-ip is anybody\'s word and changes no bucket', async () => {
    for (const host of ['0.0.0.0', '192.168.1.20', '']) {
      vi.stubEnv('VC_BIND_HOST', host);
      cloudflareIp = '203.0.113.7';
      expect(await clientKey(), host).toEqual({ key: 'local', shared: true });
    }
  });
});

describe('the older values keep their meaning', () => {
  it('VC_TRUST_PROXY=1 reads x-forwarded-for (then x-real-ip) and never cf-connecting-ip', async () => {
    vi.stubEnv('VC_TRUST_PROXY', '1');
    cloudflareIp = '203.0.113.7';
    expect(await clientKey()).toEqual({ key: 'local', shared: true });
    realIp = '10.0.0.2';
    expect(await clientKey()).toEqual({ key: '10.0.0.2', shared: false });
    forwardedFor = '10.0.0.1, 10.0.0.9';
    expect(await clientKey()).toEqual({ key: '10.0.0.1', shared: false });
  });
  it('empty or any other value: nothing is believed, cf-connecting-ip included', async () => {
    cloudflareIp = '203.0.113.7';
    forwardedFor = '10.0.0.1';
    for (const trust of ['', '0', 'true', 'Cloudflare']) {
      vi.stubEnv('VC_TRUST_PROXY', trust);
      expect(await clientKey(), trust).toEqual({ key: 'local', shared: true });
    }
  });
});
