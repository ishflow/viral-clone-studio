// @vitest-environment node
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let viewer: { id: string; emailVerified: boolean; freeVideoAvailable: boolean } | null = null;
vi.mock('@/core/session/session', () => ({ getSessionUser: async () => viewer }));

import { getStore, resetStore } from '@/data/mock/store';
import type { GalleryData } from '@/features/gallery/queries';
import GalleryPage from './page';

beforeEach(() => {
  resetStore();
  viewer = null;
});
const free = async () => ((await GalleryPage({ searchParams: Promise.resolve({}) })) as ReactElement<{ data: GalleryData }>).props.data.free;

describe('the gallery page: the Free on the cards', () => {
  it('says Free to a visitor while the admin offers the first video, and not after the admin switched it off', async () => {
    expect(await free()).toBe(true);
    getStore().limits.freeFirstVideo = false;
    expect(await free()).toBe(false);
  });
  it('still says Free to a verified customer who has the free video, whatever the setting says now', async () => {
    getStore().limits.freeFirstVideo = false;
    viewer = { id: 'usr-demo', emailVerified: true, freeVideoAvailable: true };
    expect(await free()).toBe(true);
  });
  it('never says Free to a verified customer who used it', async () => {
    viewer = { id: 'usr-demo', emailVerified: true, freeVideoAvailable: false };
    expect(await free()).toBe(false);
  });
});
