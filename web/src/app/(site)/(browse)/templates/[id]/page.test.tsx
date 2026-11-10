// @vitest-environment node
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let viewer: { id: string; emailVerified: boolean; freeVideoAvailable: boolean } | null = null;
vi.mock('@/core/session/session', () => ({ getSessionUser: async () => viewer }));

import { getStore, resetStore } from '@/data/mock/store';
import TemplatePage from './page';

beforeEach(() => {
  resetStore();
  viewer = null;
});
const free = async () => ((await TemplatePage({ params: Promise.resolve({ id: 'tpl-layering' }) })) as ReactElement<{ free: boolean }>).props.free;

describe('the template page: Free with your first video (B1)', () => {
  it('says it while a free video on the template would start now, and not while the free videos of the day are used up', async () => {
    expect(await free()).toBe(true);
    getStore().limits.freeVideosPerDay = 0;
    expect(await free()).toBe(false);
  });
  it('says nothing to a visitor while the admin has switched the free first video off', async () => {
    getStore().limits.freeFirstVideo = false;
    expect(await free()).toBe(false);
  });
  it('still tells a verified customer who has the free video, whatever the setting says now', async () => {
    getStore().limits.freeFirstVideo = false;
    viewer = { id: 'usr-demo', emailVerified: true, freeVideoAvailable: true };
    expect(await free()).toBe(true);
  });
  it('never tells a verified customer who used it', async () => {
    viewer = { id: 'usr-demo', emailVerified: true, freeVideoAvailable: false };
    expect(await free()).toBe(false);
  });
});
