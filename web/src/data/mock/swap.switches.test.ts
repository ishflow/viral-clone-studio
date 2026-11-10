// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { getStore, resetStore } from './store';

// What a customer's page may read of the two switches of person swap: is it open, and does an admin look first. Two booleans, nothing else of the limits.

beforeEach(() => resetStore());
afterEach(() => vi.unstubAllEnvs());

describe('the switches of person swap, as a customer page reads them', () => {
  it('a store without them: person swap is closed, and an admin would look first', async () => {
    expect(getStore().limits).not.toHaveProperty('personSwap');
    expect([await data.swap.enabled(), await data.swap.reviewed()]).toEqual([false, true]);
  });

  it('follow the limits at once, each on its own', async () => {
    Object.assign(getStore().limits, { personSwap: true, swapReview: false });
    expect([await data.swap.enabled(), await data.swap.reviewed()]).toEqual([true, false]);
    Object.assign(getStore().limits, { personSwap: false, swapReview: true });
    expect([await data.swap.enabled(), await data.swap.reviewed()]).toEqual([false, true]);
  });

  it('open does not wait for a video: person swap is open with none published', async () => {
    getStore().limits.personSwap = true;
    expect(await data.swap.templates()).toEqual([]);
    expect(await data.swap.enabled()).toBe(true);
  });

  it('are two booleans: nothing else of the limits comes with them', async () => {
    expect(typeof (await data.swap.enabled())).toBe('boolean');
    expect(typeof (await data.swap.reviewed())).toBe('boolean');
  });
});
