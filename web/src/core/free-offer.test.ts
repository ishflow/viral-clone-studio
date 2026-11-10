// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { data } from '@/data';
import type { SiteLimits } from '@/data/ports';
import { freeOffer } from './free-offer';

const setting = async (freeFirstVideo: boolean) => {
  const limits = await data.admin.limits();
  vi.spyOn(data.admin, 'limits').mockResolvedValue({ ...limits, freeFirstVideo } satisfies SiteLimits);
};

afterEach(() => vi.restoreAllMocks());

describe('freeOffer', () => {
  it('a verified customer follows their own free video; a visitor and an unverified account follow the setting', async () => {
    await setting(false);
    expect(await freeOffer({ emailVerified: true, freeVideoAvailable: true })).toBe(true);
    expect(await freeOffer({ emailVerified: true, freeVideoAvailable: false })).toBe(false);
    expect(await freeOffer(null)).toBe(false);
    expect(await freeOffer({ emailVerified: false, freeVideoAvailable: false })).toBe(false);
    await setting(true);
    expect(await freeOffer({ emailVerified: true, freeVideoAvailable: false })).toBe(false);
    expect(await freeOffer(null)).toBe(true);
    expect(await freeOffer({ emailVerified: false, freeVideoAvailable: false })).toBe(true);
  });
});
