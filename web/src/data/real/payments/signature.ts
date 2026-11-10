import type * as Crypto from 'node:crypto';
const crypto = (): typeof Crypto => process.getBuiltinModule('node:crypto');
/** Generic offline fixture protocol only. No claim of compatibility with Dodo/Standard Webhooks. */
export function sign(raw: string, headers: Headers, secret: string): string {
  return crypto().createHmac('sha256',secret).update(`${headers.get('webhook-id')}.${headers.get('webhook-timestamp')}.${raw}`).digest('hex');
}
export function verify(raw: string, headers: Headers, secret: string, now = Date.now()): boolean {
  const id=headers.get('webhook-id'), timestamp=headers.get('webhook-timestamp'), signature=headers.get('webhook-signature');
  if (!id || id.length > 200 || !timestamp || !/^\d{1,12}$/.test(timestamp) || !signature || !/^[a-f0-9]{64}$/.test(signature) || secret.length < 32) return false;
  if (Math.abs(now/1000-Number(timestamp)) > 300) return false;
  return crypto().timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(sign(raw,headers,secret),'hex'));
}
export function secretEqual(actual: string|null, expected: string|undefined): boolean {
  if (!actual || !expected || expected.length < 32) return false;
  const a=Buffer.from(actual), b=Buffer.from(expected);
  return a.length===b.length && crypto().timingSafeEqual(a,b);
}
