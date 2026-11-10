import type * as Crypto from 'node:crypto';
const crypto = (): typeof Crypto => process.getBuiltinModule('node:crypto');

/**
 * Standard Webhooks verification, the scheme Dodo Payments signs its webhooks with:
 * HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{raw body}`, keyed with the base64 part of the
 * `whsec_` secret, sent as space separated `v1,<base64>` entries. Every doubt ends in a refusal.
 * No result or error ever carries the secret, a signature or the body.
 */
export type DodoSignatureFailure = 'missing-header' | 'bad-header' | 'bad-secret' | 'timestamp-out-of-tolerance' | 'no-matching-signature';
export type DodoSignatureResult = { ok: true; webhookId: string } | { ok: false; reason: DodoSignatureFailure };

const TOLERANCE_SECONDS = 300;
const MAX_ID_LENGTH = 200; // the payment gate keeps event ids up to this length
const MIN_KEY_BYTES = 24; // Standard Webhooks: 24 to 64 random bytes
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const DIGEST_BASE64 = /^[A-Za-z0-9+/]{43}=$/; // 32 bytes

function keyOf(secret: string): Buffer | null {
  const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  if (!BASE64.test(encoded)) return null;
  const key = Buffer.from(encoded, 'base64');
  return key.length >= MIN_KEY_BYTES ? key : null;
}
function digest(key: Buffer, raw: string, webhookId: string, timestamp: string): Buffer {
  return crypto().createHmac('sha256', key).update(`${webhookId}.${timestamp}.${raw}`).digest();
}

/** Can this secret verify anything at all? The site checks it at start, by the same rule the verifier applies. */
export function dodoSecretUsable(secret: string): boolean {
  return keyOf(secret) !== null;
}

/** `raw` must be the request body exactly as received: verify first, parse JSON afterwards. */
export function verifyDodoWebhook(raw: string, headers: Headers, secret: string, now = Date.now()): DodoSignatureResult {
  const webhookId = headers.get('webhook-id'), timestamp = headers.get('webhook-timestamp'), signatures = headers.get('webhook-signature');
  if (!webhookId || !timestamp || !signatures) return { ok: false, reason: 'missing-header' };
  if (webhookId.length > MAX_ID_LENGTH || !/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'bad-header' };
  const key = keyOf(secret);
  if (!key) return { ok: false, reason: 'bad-secret' };
  if (!Number.isFinite(now) || Math.abs(Math.floor(now / 1000) - Number(timestamp)) > TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp-out-of-tolerance' };
  const expected = digest(key, raw, webhookId, timestamp);
  for (const entry of signatures.split(' ')) {
    const [version, value, ...rest] = entry.split(',');
    if (version !== 'v1' || value === undefined || rest.length > 0 || !DIGEST_BASE64.test(value)) continue;
    if (crypto().timingSafeEqual(Buffer.from(value, 'base64'), expected)) return { ok: true, webhookId };
  }
  return { ok: false, reason: 'no-matching-signature' };
}
