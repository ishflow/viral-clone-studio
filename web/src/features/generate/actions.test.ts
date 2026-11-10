// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

let sessionId: string | null = 'usr-demo';
vi.mock('@/core/session/session', async () => {
  const { data } = await import('@/data');
  const readUser = async () => (sessionId ? data.auth.getUser(sessionId) : null);
  return { getSessionUser: readUser, getSessionState: async () => {
    const user = await readUser();
    return user ? { kind: user.blocked ? 'blocked' : 'active', user } : { kind: 'anonymous' };
  } };
});
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { data } from '@/data';
import { writeEntry } from '@/data/mock/ledger';
import { resetStore } from '@/data/mock/store';
import { confirmGeneration, estimateGeneration } from './actions';

const IMG = ['oil.jpg'];
const four = (over: Partial<Record<number, { name?: string; images?: string[] }>> = {}) =>
  ['Aurora Body Oil', 'Aurora Body Mist', 'Aurora Hair Mist', 'Solace Perfume'].map((name, i) => ({
    name: over[i]?.name ?? name,
    description: 'x',
    images: over[i]?.images ?? IMG,
  }));
const form = (over: Record<string, unknown> = {}) => ({
  templateId: 'tpl-layering',
  products: four(),
  quality: 'fast',
  variants: 1,
  language: 'en',
  ...over,
});

beforeEach(() => {
  resetStore();
  sessionId = 'usr-demo';
  revalidatePath.mockClear();
});

async function redirected(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    return (e as Error).message;
  }
  return 'no redirect';
}

describe('estimateGeneration', () => {
  it('needs a name and at least one image for every product, and says which', async () => {
    const out = await estimateGeneration(form({ products: four({ 1: { images: [] }, 2: { name: '  ' } }) }));
    expect(out).toEqual({
      status: 'invalid',
      problems: [
        { product: 1, field: 'images' },
        { product: 2, field: 'name' },
      ],
    });
  });

  it('a 121-character name comes back as name-long, a 301-character description as description-long, never as a missing name or the generic error', async () => {
    const products = four().map((p, i) => (i === 1 ? { ...p, name: 'a'.repeat(121) } : i === 2 ? { ...p, description: 'b'.repeat(301) } : p));
    const out = await estimateGeneration(form({ products }));
    expect(out).toEqual({
      status: 'invalid',
      problems: [
        { product: 1, field: 'name-long' },
        { product: 2, field: 'description-long' },
      ],
    });
  });

  it('a name of exactly 120 characters and a description of exactly 300 are accepted', async () => {
    const products = four().map((p, i) => (i === 0 ? { ...p, name: 'a'.repeat(120), description: 'b'.repeat(300) } : p));
    const out = await estimateGeneration(form({ products }));
    expect(out.status).not.toBe('invalid');
  });

  it('lists the name problem before the image problem of the same product', async () => {
    const out = await estimateGeneration(form({ products: four({ 0: { name: '', images: [] } }) }));
    expect(out).toMatchObject({ status: 'invalid', problems: [{ product: 0, field: 'name' }, { product: 0, field: 'images' }] });
  });

  it('refuses a number of products that does not match the template', async () => {
    const out = await estimateGeneration(form({ products: four().slice(0, 2) }));
    expect(out).toEqual({ status: 'error', code: 'generic' });
  });

  it('returns the estimate and spends nothing', async () => {
    const before = await data.ledger.balance('usr-demo');
    const out = await estimateGeneration(form());
    expect(out).toMatchObject({ status: 'ready', title: 'Fragrance layering recipe' });
    if (out.status !== 'ready') throw new Error('unreachable');
    expect(out.estimate).toMatchObject({ images: 5, clips: 5, credits: 2, enough: true });
    expect(await data.ledger.balance('usr-demo')).toBe(before);
    expect((await data.jobs.listFor('usr-demo')).length).toBe(5);
  });

  it('reports the free video as covered, 0 credits', async () => {
    sessionId = 'usr-new';
    const out = await estimateGeneration(form());
    expect(out).toMatchObject({ status: 'ready', estimate: { coveredByFreeVideo: true, credits: 0, enough: true } });
  });

  it('reports a balance that is too low through enough: false', async () => {
    writeEntry('usr-demo', 'generation', -7, 'Back to 12'); // D0: the fixture balance is 19 now (B1, B9); these tests need the old 12
    const out = await estimateGeneration(form({ quality: 'best', variants: 3 }));
    if (out.status !== 'ready') throw new Error('unreachable');
    expect(out.estimate.enough).toBe(false);
    expect(out.estimate.credits).toBeGreaterThan(out.estimate.balance);
  });

  it('answers not-ready for a template that is still being prepared', async () => {
    const out = await estimateGeneration(form({ templateId: 'tpl-own-failed', products: [{ name: 'a', description: '', images: IMG }] }));
    expect(out).toEqual({ status: 'error', code: 'not-ready' });
  });

  it('sends a signed-out visitor to the login page', async () => {
    sessionId = null;
    expect(await redirected(estimateGeneration(form()))).toBe('NEXT_REDIRECT:/login');
  });
});

describe('confirmGeneration', () => {
  const PAID = { credits: 2, free: false };
  const FREE = { credits: 0, free: true };

  it('starts one job, writes one ledger entry, refreshes the shell and redirects to the job', async () => {
    const before = await data.ledger.balance('usr-demo');
    const to = await redirected(confirmGeneration(form(), 'key-1', PAID));
    expect(to).toMatch(/^NEXT_REDIRECT:\/jobs\/[0-9a-f-]{36}$/);
    expect(await data.ledger.balance('usr-demo')).toBe(before - 2);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    const jobs = await data.jobs.listFor('usr-demo');
    expect(jobs.length).toBe(6);
    expect(to).toBe(`NEXT_REDIRECT:/jobs/${jobs[0]!.id}`);
    expect(jobs[0]!.input.products.map((p) => p.images)).toEqual(four().map((p) => p.images));
  });

  it('a second confirm with the same key makes no second job and no second charge', async () => {
    const first = await redirected(confirmGeneration(form(), 'same-key', PAID));
    const balance = await data.ledger.balance('usr-demo');
    const second = await redirected(confirmGeneration(form(), 'same-key', PAID));
    expect(second).toBe(first);
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
    expect((await data.jobs.listFor('usr-demo')).length).toBe(6);
  });

  it('answers with the not-enough numbers when the balance is too low, and spends nothing', async () => {
    writeEntry('usr-demo', 'generation', -7, 'Back to 12'); // D0: the fixture balance is 19 now (B1, B9); these tests need the old 12
    const before = await data.ledger.balance('usr-demo');
    const out = await confirmGeneration(form({ quality: 'best', variants: 3 }), 'key-low', { credits: 15, free: false });
    expect(out).toMatchObject({ status: 'ready', estimate: { enough: false, balance: before } });
    expect(await data.ledger.balance('usr-demo')).toBe(before);
    expect((await data.jobs.listFor('usr-demo')).length).toBe(5);
  });

  it('validates again on the server', async () => {
    const out = await confirmGeneration(form({ products: four({ 3: { name: '' } }) }), 'key-bad', PAID);
    expect(out).toEqual({ status: 'invalid', problems: [{ product: 3, field: 'name' }] });
  });

  it('refuses a key that is blank or not a string with a typed error, never a throw', async () => {
    const before = await data.ledger.balance('usr-demo');
    for (const bad of ['   ', '', undefined, null, 7, {}, ['key']]) {
      expect(await confirmGeneration(form(), bad, PAID)).toEqual({ status: 'error', code: 'generic' });
    }
    expect(await data.ledger.balance('usr-demo')).toBe(before);
    expect((await data.jobs.listFor('usr-demo')).length).toBe(5);
  });

  it('charges nothing without the amount the dialog showed', async () => {
    const before = await data.ledger.balance('usr-demo');
    for (const bad of [undefined, null, {}, { credits: '2', free: false }, { credits: 2 }, { credits: -1, free: false }, { credits: 1.5, free: false }]) {
      expect(await confirmGeneration(form(), 'key-1', bad)).toEqual({ status: 'error', code: 'generic' });
    }
    expect(await data.ledger.balance('usr-demo')).toBe(before);
  });

  it('uses the free video once, for 0 credits', async () => {
    sessionId = 'usr-new';
    const before = await data.ledger.balance('usr-new');
    const to = await redirected(confirmGeneration(form(), 'key-free', FREE));
    expect(to).toMatch(/^NEXT_REDIRECT:\/jobs\//);
    expect(await data.ledger.balance('usr-new')).toBe(before);
    expect((await data.auth.getUser('usr-new'))?.freeVideoAvailable).toBe(false);
  });

  it('the free video was used in another tab: the dialog said 0, so nothing is charged and the new estimate comes back', async () => {
    sessionId = 'usr-new';
    await data.admin.addCredits('usr-admin', 'usr-new', 5, 'test', 'k');
    const shown = await estimateGeneration(form());
    expect(shown).toMatchObject({ status: 'ready', estimate: { credits: 0, coveredByFreeVideo: true } });
    await redirected(confirmGeneration(form({ templateId: 'tpl-eye', products: four().slice(0, 1) }), 'other-tab', FREE));
    revalidatePath.mockClear();

    const out = await confirmGeneration(form(), 'key-1', FREE);
    expect(out).toMatchObject({ status: 'changed', title: 'Fragrance layering recipe', estimate: { credits: 2, coveredByFreeVideo: false, balance: 5, enough: true } });
    expect(await data.ledger.balance('usr-new')).toBe(5);
    expect((await data.jobs.listFor('usr-new')).length).toBe(1);
    expect(revalidatePath).not.toHaveBeenCalled();

    // Confirming what the dialog shows now starts the job for that amount.
    expect(await redirected(confirmGeneration(form(), 'key-1', { credits: 2, free: false }))).toMatch(/^NEXT_REDIRECT:\/jobs\//);
    expect(await data.ledger.balance('usr-new')).toBe(3);
  });

  it('a changed estimate that the balance does not cover comes back as changed, with enough: false', async () => {
    writeEntry('usr-demo', 'generation', -7, 'Back to 12'); // D0: the fixture balance is 19 now (B1, B9); these tests need the old 12
    const out = await confirmGeneration(form({ quality: 'best', variants: 3 }), 'key-1', PAID);
    expect(out).toMatchObject({ status: 'changed', estimate: { credits: 15, enough: false } });
    expect(await data.ledger.balance('usr-demo')).toBe(12);
  });

  it('sends a user whose email is not verified to /verify-email', async () => {
    sessionId = 'usr-unverified';
    expect(await redirected(estimateGeneration(form()))).toBe('NEXT_REDIRECT:/verify-email');
    expect(await redirected(confirmGeneration(form(), 'key-1', PAID))).toBe('NEXT_REDIRECT:/verify-email');
  });
});
