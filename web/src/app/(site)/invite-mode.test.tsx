// @vitest-environment node
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let viewer: { id: string; role: 'customer'; emailVerified: boolean; freeVideoAvailable: boolean } | null = null;
vi.mock('@/core/session/session', () => ({ getSessionUser: async () => viewer }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import { resetStore } from '@/data/mock/store';
import type { GalleryData } from '@/features/gallery/queries';
import { SessionHeader } from '@/shared/ui/SessionHeader';
import GalleryPage from './(browse)/gallery/page';
import HomePage from './(marketing)/page';
import PricingPage from './(marketing)/pricing/page';

const realMail = (allow: string) => {
  for (const [name, value] of Object.entries({ VC_MAIL: 'resend', RESEND_API_KEY: 'test-placeholder', MAIL_FROM: 'no-reply@ishflow.com', VC_MAIL_ALLOW: allow })) vi.stubEnv(name, value);
};
beforeEach(() => {
  resetStore();
  viewer = null;
});
afterEach(() => vi.unstubAllEnvs());

type Props = Record<string, unknown>;
const propsOf = async (page: () => Promise<unknown>) => ((await page()) as ReactElement<Props>).props;
const home = () => propsOf(() => HomePage());
const pricing = () => propsOf(() => PricingPage({ searchParams: Promise.resolve({}) }));
const gallery = async () => (await propsOf(() => GalleryPage({ searchParams: Promise.resolve({}) }))).data as GalleryData;
const header = () => propsOf(() => SessionHeader());

describe('invite mode: a signed-out visitor cannot sign up, so the public pages do not promise the free video or a way in', () => {
  it('the home, pricing, gallery and header say invite mode to a visitor', async () => {
    realMail('guest@example.com');
    expect((await home()).invite).toBe(true);
    expect((await pricing()).invite).toBe(true);
    expect((await gallery()).free).toBe(false);
    expect((await header()).invite).toBe(true);
    expect((await header()).freeOffer).toBe(false);
  });

  it('an open site (no guest list, or "*") is as before: no invite mode, the free video is promised', async () => {
    for (const setup of [() => undefined, () => realMail('*')]) {
      vi.unstubAllEnvs();
      setup();
      expect((await home()).invite).toBe(false);
      expect((await pricing()).invite).toBe(false);
      expect((await gallery()).free).toBe(true);
      expect((await header()).invite).toBe(false);
      expect((await header()).freeOffer).toBe(true);
    }
  });

  it('a signed-in customer is not asked to request an invite', async () => {
    realMail('guest@example.com');
    viewer = { id: 'usr-demo', role: 'customer', emailVerified: true, freeVideoAvailable: true };
    expect((await home()).invite).toBe(false);
    expect((await home()).freeOffer).toBe(true);
    expect((await pricing()).invite).toBe(false);
    expect((await gallery()).free).toBe(true);
  });
});
