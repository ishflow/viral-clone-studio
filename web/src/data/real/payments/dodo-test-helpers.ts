import type * as Crypto from 'node:crypto';
/**
 * Tests only: the `webhook-signature` value Dodo would send. It lives here so that no signing tool sits next to the real secret.
 * (The Node module through `getBuiltinModule`: browser-safe.test.ts holds every non-test file of the data layer to that.)
 */
export function signDodoWebhook(raw: string, webhookId: string, timestampSeconds: number, secret: string): string {
  const crypto: typeof Crypto = process.getBuiltinModule('node:crypto');
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64');
  return `v1,${crypto.createHmac('sha256', key).update(`${webhookId}.${timestampSeconds}.${raw}`).digest('base64')}`;
}
