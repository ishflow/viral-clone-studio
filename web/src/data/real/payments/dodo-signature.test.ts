// @vitest-environment node
import nodeCrypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dodoSecretUsable, verifyDodoWebhook } from './dodo-signature';
import { signDodoWebhook } from './dodo-test-helpers';

/** Made-up key: 32 random bytes per test run, never a real Dodo secret. */
const newSecret = () => `whsec_${nodeCrypto.randomBytes(32).toString('base64')}`;
const NOW = Date.UTC(2026, 9, 7, 3, 0, 0);
const SECONDS = Math.floor(NOW / 1000);
const ID = 'msg_2zH9cQpLx81aVw';
const RAW = '{ "type": "payment.succeeded", "data": { "total_amount": 1900 } }';

/** Computed without the module under test, so a shared mistake in the signed content cannot hide. */
function independentSignature(raw: string, id: string, seconds: number, secret: string): string {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  return `v1,${nodeCrypto.createHmac('sha256', key).update(`${id}.${seconds}.${raw}`).digest('base64')}`;
}
function delivery(secret: string, overrides: Record<string, string | null> = {}): Headers {
  const headers = new Headers({
    'webhook-id': ID,
    'webhook-timestamp': String(SECONDS),
    'webhook-signature': independentSignature(RAW, ID, SECONDS, secret),
  });
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return headers;
}

afterEach(() => vi.restoreAllMocks());

describe('Standard Webhooks signature', () => {
  it('accepts the published Standard Webhooks example vector', () => {
    const headers = new Headers({
      'webhook-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      'webhook-timestamp': '1614265330',
      'webhook-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    });
    const result = verifyDodoWebhook('{"test": 2432232314}', headers, 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 1614265330_000);
    expect(result).toEqual({ ok: true, webhookId: 'msg_p5jXN8AQM9LWM0D4loKWxJek' });
  });

  it('accepts a correctly signed delivery and hands back the signed webhook id', () => {
    const secret = newSecret();
    expect(verifyDodoWebhook(RAW, delivery(secret), secret, NOW)).toEqual({ ok: true, webhookId: ID });
  });

  it('accepts a secret written without the whsec_ prefix', () => {
    const secret = newSecret();
    expect(verifyDodoWebhook(RAW, delivery(secret), secret.slice('whsec_'.length), NOW).ok).toBe(true);
  });

  it('signs the way an independent implementation does', () => {
    const secret = newSecret();
    expect(signDodoWebhook(RAW, ID, SECONDS, secret)).toBe(independentSignature(RAW, ID, SECONDS, secret));
  });

  it('rejects a body in which a single byte changed', () => {
    const secret = newSecret();
    const tampered = RAW.replace('1900', '1901');
    expect(tampered).toHaveLength(RAW.length);
    expect(verifyDodoWebhook(tampered, delivery(secret), secret, NOW)).toEqual({ ok: false, reason: 'no-matching-signature' });
  });

  it('rejects a body that was parsed and serialised again', () => {
    const secret = newSecret();
    const rewritten = JSON.stringify(JSON.parse(RAW));
    expect(verifyDodoWebhook(rewritten, delivery(secret), secret, NOW)).toEqual({ ok: false, reason: 'no-matching-signature' });
  });

  it('rejects a delivery signed with another secret', () => {
    expect(verifyDodoWebhook(RAW, delivery(newSecret()), newSecret(), NOW)).toEqual({ ok: false, reason: 'no-matching-signature' });
  });

  it('rejects a signature that belongs to another webhook id or another timestamp', () => {
    const secret = newSecret();
    expect(verifyDodoWebhook(RAW, delivery(secret, { 'webhook-id': 'msg_other' }), secret, NOW).ok).toBe(false);
    expect(verifyDodoWebhook(RAW, delivery(secret, { 'webhook-timestamp': String(SECONDS - 1) }), secret, NOW).ok).toBe(false);
  });
});

describe('timestamp tolerance', () => {
  const signedAt = (seconds: number, secret: string) =>
    new Headers({ 'webhook-id': ID, 'webhook-timestamp': String(seconds), 'webhook-signature': independentSignature(RAW, ID, seconds, secret) });

  it('accepts a delivery exactly five minutes old or five minutes ahead', () => {
    const secret = newSecret();
    expect(verifyDodoWebhook(RAW, signedAt(SECONDS - 300, secret), secret, NOW).ok).toBe(true);
    expect(verifyDodoWebhook(RAW, signedAt(SECONDS + 300, secret), secret, NOW).ok).toBe(true);
  });

  it('rejects a correctly signed delivery older than five minutes', () => {
    const secret = newSecret();
    expect(verifyDodoWebhook(RAW, signedAt(SECONDS - 301, secret), secret, NOW)).toEqual({ ok: false, reason: 'timestamp-out-of-tolerance' });
  });

  it('rejects a correctly signed delivery more than five minutes in the future', () => {
    const secret = newSecret();
    expect(verifyDodoWebhook(RAW, signedAt(SECONDS + 301, secret), secret, NOW)).toEqual({ ok: false, reason: 'timestamp-out-of-tolerance' });
  });
});

describe('several signatures in one header', () => {
  it('accepts when any one of the space separated v1 signatures is right', () => {
    const secret = newSecret();
    const right = independentSignature(RAW, ID, SECONDS, secret);
    const wrong = independentSignature(RAW, ID, SECONDS, newSecret());
    for (const header of [`${wrong} ${right}`, `${right} ${wrong}`, `${wrong} ${wrong} ${right}`]) {
      expect(verifyDodoWebhook(RAW, delivery(secret, { 'webhook-signature': header }), secret, NOW).ok).toBe(true);
    }
  });

  it('skips entries of other versions and still finds the v1 signature', () => {
    const secret = newSecret();
    const header = `v1a,${nodeCrypto.randomBytes(64).toString('base64')} ${independentSignature(RAW, ID, SECONDS, secret)}`;
    expect(verifyDodoWebhook(RAW, delivery(secret, { 'webhook-signature': header }), secret, NOW).ok).toBe(true);
  });

  it('rejects when none of the signatures is right', () => {
    const secret = newSecret();
    const header = `${independentSignature(RAW, ID, SECONDS, newSecret())} ${independentSignature(RAW, ID, SECONDS, newSecret())}`;
    expect(verifyDodoWebhook(RAW, delivery(secret, { 'webhook-signature': header }), secret, NOW)).toEqual({ ok: false, reason: 'no-matching-signature' });
  });

  it('does not accept the right signature under another version label', () => {
    const secret = newSecret();
    const header = independentSignature(RAW, ID, SECONDS, secret).replace('v1,', 'v2,');
    expect(verifyDodoWebhook(RAW, delivery(secret, { 'webhook-signature': header }), secret, NOW).ok).toBe(false);
  });
});

describe('missing or broken headers', () => {
  it.each(['webhook-id', 'webhook-timestamp', 'webhook-signature'])('rejects a delivery without %s', (name) => {
    const secret = newSecret();
    expect(verifyDodoWebhook(RAW, delivery(secret, { [name]: null }), secret, NOW)).toEqual({ ok: false, reason: 'missing-header' });
  });

  it.each([
    ['a timestamp that is not a number', { 'webhook-timestamp': 'yesterday' }],
    ['a timestamp in milliseconds', { 'webhook-timestamp': `${SECONDS}000` }],
    ['a negative timestamp', { 'webhook-timestamp': `-${SECONDS}` }],
    ['a webhook id longer than 200 characters', { 'webhook-id': 'm'.repeat(201) }],
  ])('rejects %s', (_label, overrides) => {
    const secret = newSecret();
    expect(verifyDodoWebhook(RAW, delivery(secret, overrides), secret, NOW)).toEqual({ ok: false, reason: 'bad-header' });
  });

  it('rejects signatures that are not v1 base64 of a SHA-256 digest', () => {
    const secret = newSecret();
    const good = independentSignature(RAW, ID, SECONDS, secret);
    const digest = Buffer.from(good.slice(3), 'base64');
    const broken = [
      good.slice(3), // no version label
      `v1,${digest.toString('hex')}`, // the old hex fixture format
      `v1,${digest.toString('base64url')}`, // url alphabet, no padding
      `v1,${good.slice(3, -6)}`, // truncated
      `v1,${good.slice(3)}!`, // trailing garbage a lenient decoder would drop
      'v1,',
      'v1',
    ];
    for (const header of broken) {
      expect(verifyDodoWebhook(RAW, delivery(secret, { 'webhook-signature': header }), secret, NOW), header).toEqual({ ok: false, reason: 'no-matching-signature' });
    }
  });
});

describe('unusable secret', () => {
  it.each([
    ['empty', ''],
    ['only the prefix', 'whsec_'],
    ['not clean base64, though a lenient decoder would still read 32 bytes from it', `whsec_*${Buffer.alloc(32, 7).toString('base64')}`],
    ['shorter than 24 bytes', `whsec_${Buffer.alloc(23, 7).toString('base64')}`],
  ])('never accepts a delivery when the configured secret is %s', (_label, secret) => {
    // An attacker who guesses the degenerate key signs a perfectly valid looking delivery.
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const forged = `v1,${nodeCrypto.createHmac('sha256', key).update(`${ID}.${SECONDS}.${RAW}`).digest('base64')}`;
    const headers = new Headers({ 'webhook-id': ID, 'webhook-timestamp': String(SECONDS), 'webhook-signature': forged });
    expect(verifyDodoWebhook(RAW, headers, secret, NOW)).toEqual({ ok: false, reason: 'bad-secret' });
  });

  it('tells a usable secret from one no webhook could ever match, by the verifier\'s own rule', () => {
    expect(dodoSecretUsable(newSecret())).toBe(true);
    for (const secret of ['', 'whsec_', 'whsec_c2hvcnQ=', 'not base64 !!']) expect(dodoSecretUsable(secret)).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity])('refuses everything when the clock reads %s, even a signature of a year ago', (now) => {
    const secret = newSecret();
    expect(verifyDodoWebhook(RAW, delivery(secret), secret, now)).toEqual({ ok: false, reason: 'timestamp-out-of-tolerance' });
  });

  it('has no signing tool next to the verifier', async () => {
    expect(Object.keys(await import('./dodo-signature')).sort()).toEqual(['dodoSecretUsable', 'verifyDodoWebhook']);
  });
});

describe('constant time comparison', () => {
  it('compares every candidate digest with timingSafeEqual and decides by its answer', () => {
    const secret = newSecret();
    const right = independentSignature(RAW, ID, SECONDS, secret);
    const wrong = independentSignature(RAW, ID, SECONDS, newSecret());
    const spy = vi.spyOn(nodeCrypto, 'timingSafeEqual');

    expect(verifyDodoWebhook(RAW, delivery(secret, { 'webhook-signature': `${wrong} ${right}` }), secret, NOW).ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.results.map((r) => r.value)).toEqual([false, true]);
    for (const [candidate, expected] of spy.mock.calls) {
      expect(candidate.byteLength).toBe(32);
      expect(expected.byteLength).toBe(32);
    }
  });

  it('trusts no other comparison: when timingSafeEqual says no, a right signature is refused', () => {
    const secret = newSecret();
    vi.spyOn(nodeCrypto, 'timingSafeEqual').mockReturnValue(false);
    expect(verifyDodoWebhook(RAW, delivery(secret), secret, NOW)).toEqual({ ok: false, reason: 'no-matching-signature' });
  });
});
