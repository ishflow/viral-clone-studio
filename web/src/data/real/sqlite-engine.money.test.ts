// @vitest-environment node
// S9d: the money paths of a regeneration (B2), through the site's `data.jobs` on the real engine (`VC_ENGINE=sqlite`, a temp data
// directory built from the worker's schema; the worker's own writes are played by SQL). Nothing is requested from anyone.
import { rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ledgerFault = vi.hoisted(() => ({ on: false }));
vi.mock('../mock/ledger', async (importOriginal) => {
  const original = await importOriginal<typeof import('../mock/ledger')>();
  return {
    ...original,
    // A charge of a generation that cannot be written (the lots do not add up to the balance): the call the site makes after the hold.
    writeRecord: (...args: Parameters<typeof original.writeRecord>) => {
      if (ledgerFault.on && args[1] === 'generation') throw new Error('ledger-fault');
      return original.writeRecord(...args);
    },
  };
});

import { data } from '..';
import { resetStore } from '../mock/store';
import { addDemoCustomers } from '../mock/test-helpers';
import { generateInput as input } from '../mock/test-helpers';
import { closeSqliteEngines } from './sqlite-engine';
import { makeDataDir, putTemplate } from './testing';

const USER = 'usr-demo';                                                  // 19 credits in the fixtures
const T0 = '2026-10-04T12:00:00.000Z';
let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  ({ dir, db } = makeDataDir());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(T0));
  vi.stubEnv('VC_ENGINE', 'sqlite');
  vi.stubEnv('VC_DATA_DIR', dir);
  vi.stubEnv('VC_ADMIN_PASSWORD', 'test-only-password-123');   // the store of the real engine seeds its admin from it
  resetStore();
  addDemoCustomers();   // and only its admin: the customers of these tests are added
  closeSqliteEngines();
  putTemplate(db, { id: 't1', state: 'published', card: undefined });
  db.prepare(`UPDATE templates SET card = json_set(card, '$.format', 'talking')`).run();   // fast talking: 4 credits a variant
  ledgerFault.on = false;
});
afterEach(() => {
  closeSqliteEngines();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetStore();
});

const tick = (seconds = 1) => vi.setSystemTime(new Date(Date.now() + seconds * 1000));
const photos = { products: [] };
const runs = () => db.prepare('SELECT * FROM runs ORDER BY created_at, id').all() as { id: string; ref: string; state: string; input: string }[];
const regenerations = () => runs().filter((run) => run.ref.includes('/'));
function worker(ref: string, state: string, variants: object[], reason: string | null = null): void {
  db.prepare('UPDATE runs SET state = ?, reason = ?, variants = ?, updated_at = ? WHERE ref = ?').run(state, reason, JSON.stringify(variants), new Date().toISOString(), ref);
}
const done = (n: number, run: string) => ({ n, status: 'done', video: `jobs/${run}/v${n}/final.mp4`, image: `jobs/${run}/v${n}/poster.jpg`, reason: null });
const stopped = (n: number, reason = 'clips-failed') => ({ n, status: 'stopped', video: null, image: null, reason });
const balance = () => data.ledger.balance(USER);

/** A 2-variant job (8 credits) of which the worker delivered v1: the site shows it `done`, 4 credits back. */
async function partlyDone(variants: object[] = [done(1, 'r'), stopped(2)]): Promise<{ id: string; variantId: string }> {
  const started = await data.jobs.start(USER, { ...input('t1', { variants: 2 }), ...photos }, `k-${Math.random()}`, { credits: 8, coveredByFreeVideo: false });
  worker(started.id, 'stopped', variants, 'clips-failed');
  tick(10);
  expect(await data.jobs.get(started.id, USER)).toMatchObject({ status: 'done' });
  return { id: started.id, variantId: `${started.id}-v2` };
}

describe('I1: what a stopped regeneration returns is what it was charged', () => {
  it('the template is deleted (or changes format) while the regeneration runs: the refund is still the charged 4, not the price of the template that is left', async () => {
    const job = await partlyDone();
    expect(await balance()).toBe(19 - 8 + 4);
    expect(await data.jobs.variantCost(job.id, USER, job.variantId)).toBe(4);
    await data.jobs.regenerateVariant(job.id, USER, job.variantId, 4);
    expect(await balance()).toBe(11);
    db.prepare('DELETE FROM templates WHERE id = ?').run('t1');            // the owner deleted it (or the account went)
    worker(regenerations()[0]!.ref, 'stopped', [stopped(1, 'images-failed')], 'images-failed');
    tick(10);
    expect(await data.jobs.get(job.id, USER)).toMatchObject({ status: 'done', creditsReturned: 4 });
    expect(await balance()).toBe(15);
    await data.jobs.get(job.id, USER);
    expect(await balance()).toBe(15);                                       // once
  });
});

describe('C1: the customer sees the regeneration the moment it is held, and while the worker has not written its variant', () => {
  it('held, running with no variant, running with a waiting variant: generating; done: done', async () => {
    const job = await partlyDone();
    await data.jobs.regenerateVariant(job.id, USER, job.variantId, 4);
    const status = async () => (await data.jobs.get(job.id, USER))?.variants.map((variant) => variant.status);
    expect(await status()).toEqual(['done', 'generating']);
    const ref = regenerations()[0]!.ref;
    worker(ref, 'running', []);
    expect(await status()).toEqual(['done', 'generating']);
    worker(ref, 'running', [{ n: 1, status: 'waiting', video: null, image: null, reason: null }]);
    expect(await status()).toEqual(['done', 'generating']);
    worker(ref, 'done', [done(1, regenerations()[0]!.id)]);
    expect(await status()).toEqual(['done', 'done']);
    expect(await balance()).toBe(11);
  });

  it('a regeneration that stops before its variant was written gives the price back', async () => {
    const job = await partlyDone();
    await data.jobs.regenerateVariant(job.id, USER, job.variantId, 4);
    const ref = regenerations()[0]!.ref;
    worker(ref, 'running', []);
    await data.jobs.get(job.id, USER);
    worker(ref, 'stopped', [], 'images-failed');
    expect(await data.jobs.get(job.id, USER)).toMatchObject({ status: 'done', creditsReturned: 4 });
    expect(await balance()).toBe(15);
  });
});

describe('M1: the charge of a regeneration is written before the run is held', () => {
  it('a charge that cannot be written leaves no run behind, no mark and no charge', async () => {
    const job = await partlyDone();
    ledgerFault.on = true;
    await expect(data.jobs.regenerateVariant(job.id, USER, job.variantId, 4)).rejects.toThrow('ledger-fault');
    expect(regenerations()).toEqual([]);                                    // not even a held run that a release could start for free
    expect(await balance()).toBe(15);
    const after = await data.jobs.get(job.id, USER);
    expect(after?.variants.map((variant) => variant.status)).toEqual(['done', 'stopped']);
  });
});

describe('M4: a variant stopped by the content rules is neither offered nor charged again', () => {
  it('variantCost and regenerateVariant refuse it; nothing is held and nothing is charged', async () => {
    const job = await partlyDone([done(1, 'r'), stopped(2, 'content-rule')]);
    await expect(data.jobs.variantCost(job.id, USER, job.variantId)).rejects.toThrow('not-resumable');
    await expect(data.jobs.regenerateVariant(job.id, USER, job.variantId, 4)).rejects.toThrow('not-resumable');
    expect(regenerations()).toEqual([]);
    expect(await balance()).toBe(15);
  });
});

it('a dead ready preparation is failed and its single charge returns exactly once', async () => {
  const before = await data.ledger.balance(USER);
  const template = await data.catalog.prepareOwn(USER, { kind: 'link', url: 'https://www.youtube.com/shorts/test-codexu' }, 1, 'codexu-fragment');
  expect(await data.ledger.balance(USER)).toBe(before - 1);
  db.prepare("UPDATE templates SET state = 'ready' WHERE id = ?").run(template.id);
  expect(await data.catalog.get(template.id, USER)).toMatchObject({ preparation: 'failed', preparationNote: 'check-failed' });
  expect(await data.ledger.balance(USER)).toBe(before);
  await data.catalog.get(template.id, USER);
  expect(await data.ledger.balance(USER)).toBe(before);
  expect((await data.ledger.entries(USER)).filter(e => e.type === 'returned' && e.change === 1)).toHaveLength(1);
});
