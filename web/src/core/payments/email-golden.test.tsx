// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { renderEmail } from './email';
import type { Locale, SentEmail } from '@/data/ports';

const BASE = 'http://localhost:3202';
const mail = (kind: SentEmail['kind'], data: Record<string, string>): SentEmail => ({ id: 'm', kind, to: 'owner@example.com', at: '2026-10-05T10:00:00.000Z', data });
/** Every kind and sub-state of a sent email: what the subject, the plain text and the link addresses must keep. */
export const CASES: Record<string, SentEmail> = {
  verify: mail('verify', { token: 'a/b c', purpose: 'verify', free: '1' }),
  verifyPlain: mail('verify', { token: 't1', purpose: 'verify', free: '0' }),
  verifyChange: mail('verify', { token: 't2', purpose: 'email-change' }),
  reset: mail('reset', { token: 'r<1>' }),
  ready: mail('ready', { jobId: 'job/1', templateTitle: 'Layering', minutes: '7', seconds: '8', quality: 'fast' }),
  readyUnknown: mail('ready', { jobId: 'job-2' }),
  stoppedPaid: mail('stopped', { jobId: 'j1', templateTitle: 'T', reason: 'clips-failed', returned: '2', resumeCost: '2', free: '0' }),
  stoppedFree: mail('stopped', { jobId: 'j1', templateTitle: 'T', reason: 'clips-failed', free: '1' }),
  stoppedContent: mail('stopped', { jobId: 'j1', templateTitle: 'T', reason: 'content-rule', returned: '2', free: '0' }),
  stoppedChecking: mail('stopped', { jobId: 'j1', templateTitle: 'T', reason: 'submission-unknown', returned: '2', resumeCost: '2', free: '0' }),
  payment: mail('payment', { packName: 'Standard', credits: '30', balance: '42', amount: '$19.00', number: '001', invoiceId: 'inv/1', returnTo: '/templates/t1', date: '2026-10-06T20:31:52.279Z' }),
  refund: mail('payment', { refund: 'true', packName: 'Standard', credits: '30', invoiceId: 'inv' }),
  refundSent: mail('payment', { refund: 'sent', packName: 'Standard', credits: '30', amount: '$19.00', date: '2026-10-05T10:00:00.000Z' }),
};
/** The logo links to the home page; every other address is one the email had before. */
const hrefs = (html: string) => [...new Set([...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replaceAll('&amp;', '&')))].filter((href) => href !== `${BASE}/`).sort();
const GOLDEN = join(__dirname, 'email-golden.json');
const actual = Object.fromEntries(Object.entries(CASES).flatMap(([name, m]) => (['en', 'tr'] as Locale[]).map((locale) => {
  const r = renderEmail(m, locale, BASE);
  return [`${name}.${locale}`, { subject: r.subject, text: r.text, hrefs: hrefs(r.html) }];
})));

it('the subject, the plain text and the link addresses of every email stay as they were before the design was applied', () => {
  expect(actual).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
});
