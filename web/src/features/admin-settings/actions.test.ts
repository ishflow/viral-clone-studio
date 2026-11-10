// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

let sessionId: string | null = 'usr-admin';
vi.mock('@/core/session/session', async () => {
  const { data } = await import('@/data');
  const readUser = async () => (sessionId ? data.auth.getUser(sessionId) : null);
  return { getSessionUser: readUser, getSessionState: async () => {
    const user = await readUser();
    return user ? { kind: user.blocked ? 'blocked' : 'active', user } : { kind: 'anonymous' };
  } };
});
vi.mock('next/navigation', () => ({
  forbidden: () => { throw new Error('NEXT_FORBIDDEN'); },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { data } from '@/data';
import { resetStore } from '@/data/mock/store';
import { checkConnection, saveSettings } from './actions';
import { toHealthView } from './health';
import { RANGES } from './schema';
import { AdminSettings } from './index';

const IDLE = { status: 'idle' as const, errors: {} };
const form = (over: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    time1: '09:00', time2: '15:00', time3: '21:00', threshold: '70', dailyCandidates: '45', dailyTemplates: '10',
    sourceTopads: '1', sourceShorts: '1', searches: 'skincare', secondsMin: '6', secondsMax: '35', shortsMinViews: '500000', topAdsCards: '30', perScan: '15', ...over,
  })) f.set(k, v);
  return f;
};

beforeEach(() => {
  resetStore();
  sessionId = 'usr-admin';
  revalidatePath.mockClear();
});

describe('guards', () => {
  it.each([['usr-demo'], [null]])('a visitor (%s) gets the 404 page from the page and the action; nothing is saved', async (who) => {
    sessionId = who;
    await expect(saveSettings(IDLE, form({ threshold: '10' }))).rejects.toThrow('NEXT_FORBIDDEN');
    await expect(AdminSettings()).rejects.toThrow('NEXT_FORBIDDEN');
    await expect(checkConnection()).rejects.toThrow('NEXT_FORBIDDEN');
    sessionId = 'usr-admin';
    expect((await data.admin.settings()).threshold).toBe(70);
  });
});

describe('ranges', () => {
  it('101 jobs at once is refused as a field error and nothing is saved', async () => {
    const state = await saveSettings(IDLE, form({ jobsAtOnce: '101' }));
    expect(state).toMatchObject({ status: 'error', errors: { jobsAtOnce: 'invalid' } });
    expect((await data.admin.limits()).jobsAtOnce).not.toBe(101);
  });

  it.each(Object.entries(RANGES))('%s takes the number at each end of its range and refuses the one past it', async (field, { min, max }) => {
    for (const ok of [min, max]) {
      const state = await saveSettings(IDLE, form({ [field]: String(ok), ...(field === 'secondsMin' ? { secondsMax: '600' } : {}), ...(field === 'secondsMax' ? { secondsMin: '1' } : {}) }));
      expect(state.errors).toEqual({});
    }
    expect((await saveSettings(IDLE, form({ [field]: String(max + 1) }))).errors).toMatchObject({ [field]: 'invalid' });
    if (min > 0) expect((await saveSettings(IDLE, form({ [field]: String(min - 1) }))).errors).toMatchObject({ [field]: 'invalid' });
  });
});

describe('scan times', () => {
  it('a duplicate time is a field error on the later one and saves nothing', async () => {
    const state = await saveSettings(IDLE, form({ time1: '09:00', time2: '15:00', time3: '09:00' }));
    expect(state.errors.time3).toBe('duplicate');
    expect((await data.admin.settings()).scanTimes).toEqual(['09:00', '15:00', '21:00']);
  });
  it('the optional slots may be empty; at least the first time is needed', async () => {
    expect((await saveSettings(IDLE, form({ time2: '', time3: '' }))).status).toBe('saved');
    expect((await data.admin.settings()).scanTimes).toEqual(['09:00']);
    expect((await saveSettings(IDLE, form({ time1: '' }))).errors.time1).toBe('invalid');
  });
});

describe('saveSettings', () => {
  it.each([['25:00'], ['9:00'], ['09:60'], ['abc']])('scan time "%s" is a field error and saves nothing', async (time2) => {
    const state = await saveSettings(IDLE, form({ time2 }));
    expect(state.status).toBe('error');
    expect(state.errors.time2).toBe('invalid');
    expect((await data.admin.settings()).scanTimes).toEqual(['09:00', '15:00', '21:00']);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([['-1'], ['101'], ['70.5'], [''], ['abc'], ['1e2'], ['0x10'], [' 7 0']])('threshold "%s" is a field error, the only one', async (threshold) => {
    const state = await saveSettings(IDLE, form({ threshold }));
    expect(state.errors).toEqual({ threshold: 'invalid' });
    expect((await data.admin.settings()).threshold).toBe(70);
  });

  it.each([['0'], ['-5'], ['2.5'], [''], ['x'], ['1e3']])('caps "%s" are field errors', async (value) => {
    const state = await saveSettings(IDLE, form({ dailyCandidates: value, dailyTemplates: value }));
    expect(state.errors).toEqual({ dailyCandidates: 'invalid', dailyTemplates: 'invalid' });
  });

  it('the bounds 0 and 100 are fine', async () => {
    expect((await saveSettings(IDLE, form({ threshold: '0' }))).status).toBe('saved');
    expect((await saveSettings(IDLE, form({ threshold: '100' }))).status).toBe('saved');
  });

  it('saves every field, sorts the times, keeps the provider account and refreshes the shell', async () => {
    const state = await saveSettings(IDLE, form({
      time1: '21:30', time2: '06:15', time3: '12:00', threshold: '55', dailyCandidates: '60', dailyTemplates: '12',
      sourceTopads: '0', searches: '#skincare\r\n\n  glass skin \n', secondsMin: '5', secondsMax: '40', shortsMinViews: '0', topAdsCards: '20', perScan: '9',
    }));
    expect(state).toEqual({ status: 'saved', errors: {} });
    expect(await data.admin.settings()).toMatchObject({
      scanTimes: ['06:15', '12:00', '21:30'], threshold: 55, dailyCandidates: 60, dailyTemplates: 12, providerAccount: 'default',
      sources: { topads: false, shorts: true }, searches: ['skincare', 'glass skin'], secondsMin: 5, secondsMax: 40, shortsMinViews: 0, topAdsCards: 20, perScan: 9,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });
});

describe('scan settings', () => {
  // What the store holds before the call: a refused form leaves it as it was.
  let initial: Awaited<ReturnType<typeof data.admin.settings>>;
  beforeEach(async () => {
    initial = await data.admin.settings();
  });
  const unchanged = async () => expect(await data.admin.settings()).toEqual(initial);

  it.each([['0'], ['601'], ['6.5'], [''], ['x'], ['1e1']])('a length of "%s" is a field error and saves nothing', async (value) => {
    const state = await saveSettings(IDLE, form({ secondsMin: value, secondsMax: value }));
    expect(state.errors).toEqual({ secondsMin: 'invalid', secondsMax: 'invalid' });
    await unchanged();
  });

  it('the minimum length may equal the maximum, never exceed it', async () => {
    expect((await saveSettings(IDLE, form({ secondsMin: '36', secondsMax: '35' }))).errors).toEqual({ secondsMax: 'order' });
    await unchanged();
    expect((await saveSettings(IDLE, form({ secondsMin: '35', secondsMax: '35' }))).status).toBe('saved');
  });

  it.each([['-1'], ['1.5'], [''], ['many'], ['5e5'], ['0x10']])('minimum views "%s" is the only field error; 0 is fine', async (value) => {
    expect((await saveSettings(IDLE, form({ shortsMinViews: value }))).errors).toEqual({ shortsMinViews: 'invalid' });
    expect((await saveSettings(IDLE, form({ shortsMinViews: '0' }))).status).toBe('saved');
  });

  it.each([['0'], ['-3'], ['2.5'], ['']])('cards and per-scan "%s" are field errors', async (value) => {
    const state = await saveSettings(IDLE, form({ topAdsCards: value, perScan: value }));
    expect(state.errors).toEqual({ topAdsCards: 'invalid', perScan: 'invalid' });
  });

  it('Shorts on needs at least one hashtag; with Shorts off the list may be empty', async () => {
    expect((await saveSettings(IDLE, form({ searches: ' \n # \n' }))).errors).toEqual({ searches: 'required' });
    await unchanged();
    expect((await saveSettings(IDLE, form({ searches: '', sourceShorts: '0' }))).status).toBe('saved');
    expect((await data.admin.settings()).searches).toEqual([]);
  });

  it('too many hashtags, or one too long, is a field error', async () => {
    expect((await saveSettings(IDLE, form({ searches: Array.from({ length: 51 }, (_, i) => `tag${i}`).join('\n') }))).errors.searches).toBe('invalid');
    expect((await saveSettings(IDLE, form({ searches: 'x'.repeat(101) }))).errors.searches).toBe('invalid');
  });

  it('hashtags: a comma also separates, inner spaces are squeezed, duplicates (case and spaces ignored) are dropped', async () => {
    expect((await saveSettings(IDLE, form({ searches: 'skincare, Beauty\n#SkinCare\nglass   skin\nglassskin\n##beauty' }))).status).toBe('saved');
    expect((await data.admin.settings()).searches).toEqual(['skincare', 'Beauty', 'glass skin']);
  });

  it.each([['skin/care'], ['#'], ['a.b'], ['🔥']])('a hashtag shaped like "%s" is refused (a lone # is just empty)', async (value) => {
    const errors = (await saveSettings(IDLE, form({ searches: `skincare\n${value}` }))).errors;
    expect(errors).toEqual(value === '#' ? {} : { searches: 'invalid' });
  });

  it('a source toggle that is not 0 or 1 saves nothing', async () => {
    expect((await saveSettings(IDLE, form({ sourceTopads: 'yes' }))).errors.sourceTopads).toBe('invalid');
    await unchanged();
  });
});

describe('checkConnection', () => {
  it('returns the health of now, its last-seen time written in server time', async () => {
    const health = await checkConnection();
    expect(health).toMatchObject({ worker: 'running', provider: 'fake' });
    expect(health?.lastSeenText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('toHealthView: no or broken last-seen time → null; else the local clock of the server', () => {
    const at = new Date(2026, 9, 5, 7, 3);
    expect(toHealthView({ worker: 'down', lastSeen: at.toISOString(), provider: 'ready' }).lastSeenText).toBe('2026-10-05 07:03');
    expect(toHealthView({ worker: 'down', lastSeen: null, provider: 'ready' }).lastSeenText).toBeNull();
    expect(toHealthView({ worker: 'down', lastSeen: 'garbage', provider: 'ready' }).lastSeenText).toBeNull();
  });

  it('toHealthView: out of credits when the worker holds the provider for it, or when the jobs say so; else not', () => {
    const ready = { worker: 'running' as const, lastSeen: null, provider: 'ready' as const };
    const held = { ...ready, outOfCredits: true };   // as the real engine reads the worker's health row
    expect(toHealthView(held).outOfCredits).toBe(true);
    expect(toHealthView(held, false).outOfCredits).toBe(true);
    expect(toHealthView(ready, true).outOfCredits).toBe(true);
    expect(toHealthView(ready).outOfCredits).toBe(false);
    const odd = { ...ready, outOfCredits: 'yes' } as unknown as typeof ready;   // not what the port's type allows: a value read from elsewhere
    expect(toHealthView(odd).outOfCredits).toBe(false);
  });
});

it('a country code typed in lowercase is saved in uppercase; one that is not two letters is still refused', async () => {
  expect((await saveSettings(IDLE, form({ topAdsCountry: ' gb ' }))).status).toBe('saved');
  expect((await data.admin.settings()).topAdsCountry).toBe('GB');
  expect((await saveSettings(IDLE, form({ topAdsCountry: 'g1' }))).errors).toEqual({ topAdsCountry: 'invalid' });
});

it('saves validated Top Ads filters and rejects tampered filters', async () => {
  expect((await saveSettings(IDLE, form({ topAdsIndustry: 'skincare', topAdsCountry: 'GB', topAdsPeriod: '30' }))).status).toBe('saved');
  expect(await data.admin.settings()).toMatchObject({ topAdsIndustry: 'skincare', topAdsCountry: 'GB', topAdsPeriod: 30 });
  expect((await saveSettings(IDLE, form({ topAdsIndustry: 'invented', topAdsCountry: '../', topAdsPeriod: '8' }))).errors).toEqual({ topAdsIndustry: 'invalid', topAdsCountry: 'invalid', topAdsPeriod: 'invalid' });
});

describe('person swap switches', () => {
  it('are saved to the site limits as the form sent them, each on its own', async () => {
    const before = await data.admin.limits();
    expect((await saveSettings(IDLE, form({ personSwap: before.personSwap ? '0' : '1', swapReview: before.swapReview ? '0' : '1' }))).status).toBe('saved');
    expect(await data.admin.limits()).toMatchObject({ personSwap: !before.personSwap, swapReview: !before.swapReview });
    expect((await saveSettings(IDLE, form({ swapReview: before.swapReview ? '1' : '0' }))).status).toBe('saved');
    expect(await data.admin.limits()).toMatchObject({ personSwap: !before.personSwap, swapReview: before.swapReview });
  });

  it('a value that is neither on nor off is a field error and nothing is saved', async () => {
    const before = await data.admin.limits();
    expect(await saveSettings(IDLE, form({ personSwap: 'yes', threshold: '10' }))).toEqual({ status: 'error', errors: { personSwap: 'invalid' } });
    expect(await saveSettings(IDLE, form({ swapReview: '' }))).toEqual({ status: 'error', errors: { swapReview: 'invalid' } });
    expect(await data.admin.limits()).toEqual(before);
    expect((await data.admin.settings()).threshold).toBe(70);
  });

  it('the data layer decides who may save them: its no is the 403 page, not a "could not save"', async () => {
    const refuse = vi.spyOn(data.admin, 'saveLimits').mockRejectedValueOnce(new Error('forbidden'));
    await expect(saveSettings(IDLE, form({ personSwap: '1' }))).rejects.toThrow('NEXT_FORBIDDEN');
    refuse.mockRestore();
  });
});
