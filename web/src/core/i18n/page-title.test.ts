import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en/titles.json';
import tr from '@/messages/tr/titles.json';
import type { User } from '@/data/ports';
import { pageTitle, recordTitle } from './page-title';

let locale: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'vc_locale' && locale ? { value: locale } : undefined) }),
}));

let viewer: Partial<User> | null;
vi.mock('@/core/session/session', () => ({ getSessionUser: async () => viewer }));

beforeEach(() => {
  locale = undefined;
  viewer = null;
});

describe('pageTitle', () => {
  it('pageTitle gives the Turkish title to a Turkish visitor and the English one otherwise', async () => {
    expect(await pageTitle('pricing')).toEqual({ title: 'Pricing' });
    locale = 'tr';
    expect(await pageTitle('pricing')).toEqual({ title: 'Fiyatlar' });
    locale = 'fr';
    expect(await pageTitle('pricing')).toEqual({ title: 'Pricing' });
  });
});

describe('recordTitle', () => {
  it('names the page while the record is there, and says "Page not found" when it is not (the page shows its 404)', async () => {
    expect(await recordTitle('invoice', async () => ({ id: 'i1' }))).toEqual({ title: 'Invoice' });
    expect(await recordTitle('invoice', async () => null)).toEqual({ title: 'Page not found' });
    locale = 'tr';
    expect(await recordTitle('invoice', async () => null)).toEqual({ title: 'Sayfa bulunamadı' });
  });
  it('hands the signed-in viewer to the lookup, so a record of someone else is as missing as an unknown one', async () => {
    viewer = { id: 'u1' };
    const seen: Array<string | undefined> = [];
    await recordTitle('job', async (who) => { seen.push(who?.id); return null; });
    expect(seen).toEqual(['u1']);
  });
  it('a lookup that fails keeps the page title: the page reads the record itself and answers', async () => {
    expect(await recordTitle('job', async () => { throw new Error('store down'); })).toEqual({ title: 'Your video' });
  });
});

describe('titles messages', () => {
  it('English and Turkish name the same pages', () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });
  it('no title is empty', () => {
    for (const title of [...Object.values(en), ...Object.values(tr)]) expect(title.trim()).not.toBe('');
  });
});
