// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

let locale: string | undefined;
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => (name === 'vc_locale' && locale ? { value: locale } : undefined) }) }));

import { LOCALE_COOKIE } from '@/core/i18n/types';
import { shareMetadata } from './share';

afterEach(() => {
  locale = undefined;
});

describe('shareMetadata: what a link to the home or pricing page shows when it is shared', () => {
  it('uses the cookie name of the locale (the mock above is keyed by it)', () => {
    expect(LOCALE_COOKIE).toBe('vc_locale');
  });

  it('the home page has a description, an Open Graph card and a large Twitter card, all in English by default', async () => {
    const meta = await shareMetadata('home');
    expect(meta.description).toMatch(/shot-by-shot structure/);
    expect(meta.openGraph).toMatchObject({ type: 'website', siteName: 'Viral Clone', title: 'Viral Clone: Same video. Your product.', description: meta.description });
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', title: 'Viral Clone: Same video. Your product.', description: meta.description });
  });

  it('the card carries the picture of the site itself: a page that sets its own Open Graph card would otherwise lose the file-based picture of the root', async () => {
    for (const page of ['home', 'pricing'] as const) {
      const meta = await shareMetadata(page);
      expect(meta.openGraph).toMatchObject({ images: [{ url: '/opengraph-image', width: 1200, height: 630 }] });
      expect(meta.twitter).toMatchObject({ images: ['/opengraph-image'] });
    }
  });

  it('the pricing page has its own description and title', async () => {
    const meta = await shareMetadata('pricing');
    expect(meta.description).toMatch(/credits/);
    expect(meta.openGraph).toMatchObject({ title: 'Pricing · Viral Clone', description: meta.description });
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', title: 'Pricing · Viral Clone' });
  });

  it('follows the language of the visitor', async () => {
    locale = 'tr';
    const meta = await shareMetadata('pricing');
    expect(meta.description).toMatch(/kredi/);
    expect(meta.openGraph).toMatchObject({ title: 'Fiyatlar · Viral Clone' });
  });

  it('promises nothing a visitor may not get: no free video, no card of the sign-up kind', async () => {
    for (const page of ['home', 'pricing'] as const) {
      for (const l of [undefined, 'tr']) {
        locale = l;
        const meta = await shareMetadata(page);
        expect(JSON.stringify(meta)).not.toMatch(/free|ücretsiz/i);
      }
    }
  });
});
