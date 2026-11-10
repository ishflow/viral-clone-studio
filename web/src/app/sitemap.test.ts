// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_DOCS } from '@/features/marketing/legal';

const headerList = vi.hoisted(() => ({ values: {} as Record<string, string> }));
vi.mock('next/headers', () => ({ headers: async () => ({ get: (name: string) => headerList.values[name] ?? null }) }));

import sitemap from './sitemap';

describe('sitemap.xml', () => {
  beforeEach(() => { headerList.values = {}; });

  it('lists the public pages only, on the host the visitor used (https when the proxy says so)', async () => {
    headerList.values = { host: 'example.test', 'x-forwarded-proto': 'https' };
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toEqual([
      'https://example.test/', 'https://example.test/pricing', 'https://example.test/gallery', 'https://example.test/contact',
      ...LEGAL_DOCS.map((doc) => `https://example.test/legal/${doc}`),
    ]);
  });

  it('keeps the account, admin and sign-in routes out', async () => {
    headerList.values = { host: 'example.test' };
    for (const { url } of await sitemap()) {
      expect(url.startsWith('http://example.test/')).toBe(true);
      expect(new URL(url).pathname).not.toMatch(/^\/(admin|api|dev|login|signup|account|checkout|jobs|videos|welcome|templates|invoices|blocked|verify-email|forgot-password|reset-password)/);
    }
  });

  it('falls back to the site domain when the request names no host', async () => {
    expect((await sitemap())[0]!.url).toBe('https://viralclone.app/');
  });
});
