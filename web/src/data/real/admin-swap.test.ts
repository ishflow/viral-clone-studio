// @vitest-environment node
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '..';
import { getStore, resetStore } from '../mock/store';
import { addDemoCustomers } from '../mock/test-helpers';
import { RULES } from '../ports';
import type { Job, SwapConsent, SwapInput } from '../ports';
import { mediaFile } from './media';
import { PERSON_PHOTO } from './photo-test-fixture';
import type { Card } from './rows';
import { closeSqliteEngines } from './sqlite-engine';
import { card, makeDataDir, putTemplate } from './testing';

// The admin's look at the photographs of a person swap, next to the real engine: the photographs are files (personal data), and only
// an admin is handed one, only while the job waits for the answer.

let dir: string;
let db: DatabaseSync;
const ADMIN = 'usr-admin';
const PNG = PERSON_PHOTO;                                                // a whole, small picture: the one photograph of these tests
const SWAP_PAID = { images: 0, clips: 2, clipSeconds: 12, music: 0, voice: 0 };
const swapCard: Card = {
  ...card({ seconds: 12, shots: [], products: 0 }),
  swap: { people: 1, sound: true, persons: [{ slot: 1, box: { left: 30, top: 10, right: 70, bottom: 95 }, hint: 'the woman on the left' }], parts: [{ n: 1, from: 0, to: 6 }, { n: 2, from: 6, to: 12 }] },
};
const consent: SwapConsent = { ownPerson: true, adults: true, notCelebrity: true, version: RULES.swapConsentVersion };
const upload = (userId: string) => data.uploads.save(userId, new File([PNG], 'me.png', { type: 'image/png' }));
const on = (stored: string) => existsSync(join(dir, stored));
const viewer = (id: string | null) => (id ? getStore().users.find((user) => user.id === id) ?? null : null);
const open = (stored: string, who: string | null) => mediaFile(stored.split('/'), viewer(who)) !== null;
const runOf = (jobId: string) => db.prepare('SELECT * FROM runs WHERE ref = ?').get(jobId) as Record<string, string | null> | undefined;

async function start(userId = 'usr-demo', key = 'key-1'): Promise<Job> {
  const input: SwapInput = { templateId: 'sw1', quality: 'fast', people: [{ slot: 1, body: await upload(userId), face: await upload(userId), side: await upload(userId) }] };
  return data.swap.start(userId, input, key, await data.swap.estimate(userId, input), consent);
}

beforeEach(() => {
  ({ dir, db } = makeDataDir());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'));
  vi.stubEnv('VC_ENGINE', 'sqlite'); vi.stubEnv('VC_DATA_DIR', dir); vi.stubEnv('VC_ADMIN_PASSWORD', 'test-only-password-123');
  resetStore(); addDemoCustomers(); closeSqliteEngines();
  Object.assign(getStore().limits, { personSwap: true });                    // the look of an admin is asked for: the launch default
  putTemplate(db, { id: 'sw1', state: 'published', card: swapCard, estimate: SWAP_PAID, minutes: 3 });
});
afterEach(() => {
  closeSqliteEngines(); db.close(); rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); resetStore();
});

describe('a photograph of a job that waits for the look', () => {
  it('is handed to an admin as the stored file, and to nobody else: no path and no byte of it', async () => {
    const job = await start();
    const { body, face, side } = job.swap!.people[0]!;
    for (const who of ['usr-new', 'usr-demo', '', 'usr-nobody']) await expect(data.admin.swapPhoto(who, job.id, 1, 'body')).rejects.toThrow('forbidden');
    const shown = await data.admin.swapPhoto(ADMIN, job.id, 1, 'body');
    expect(shown).toMatchObject({ state: 'shown', name: '1.png', file: { type: 'image/png', size: PNG.length } });
    if (shown.state !== 'shown' || !shown.file) throw new Error('no file');
    expect(new Uint8Array(readFileSync(shown.file.path))).toEqual(PNG);
    expect(shown.file.path.endsWith(body)).toBe(true);
    expect(await data.admin.swapPhoto(ADMIN, job.id, 1, 'face')).toMatchObject({ state: 'shown', file: { size: PNG.length } });
    expect(face).not.toBe(body);
    const third = await data.admin.swapPhoto(ADMIN, job.id, 1, 'side');
    expect(third).toMatchObject({ state: 'shown', file: { size: PNG.length } });
    expect(third.state === 'shown' && third.file?.path.endsWith(side!)).toBe(true);
    expect(new Set([body, face, side]).size).toBe(3);
  });

  it('is shown to no admin once the job has its yes, on no way: the work keeps the file, its uploader still sees it', async () => {
    const job = await start();
    const { body, side } = job.swap!.people[0]!;
    expect([open(side!, ADMIN), open(side!, 'usr-demo'), open(side!, 'usr-new'), open(side!, null)]).toEqual([true, true, false, false]);
    expect([open(body, ADMIN), open(body, 'usr-demo'), open(body, 'usr-new'), open(body, null)]).toEqual([true, true, false, false]);
    expect(runOf(job.id)).toBeUndefined();
    expect(await data.admin.reviewSwap(ADMIN, job.id, 'approved')).toMatchObject({ outcome: 'done', value: { status: 'running' } });
    expect(runOf(job.id)).toMatchObject({ state: 'queued' });                // on the disk, and the worker may take it
    expect(await data.admin.swapPhoto(ADMIN, job.id, 1, 'body')).toEqual({ state: 'decided' });
    expect([open(body, ADMIN), open(body, 'usr-demo')]).toEqual([false, true]);
    expect(on(body)).toBe(true);
    expect(await data.admin.swapPhoto(ADMIN, job.id, 1, 'side')).toEqual({ state: 'decided' });
    expect([open(side!, ADMIN), open(side!, 'usr-demo'), on(side!)]).toEqual([false, true, true]);
  });

  it('that another job still waits with stays with the admin until that one has its answer too', async () => {
    const first = await start('usr-demo', 'key-1');
    const people = first.swap!.people;
    const input: SwapInput = { templateId: 'sw1', quality: 'fast', people };
    const second = await data.swap.start('usr-demo', input, 'key-2', await data.swap.estimate('usr-demo', input), consent);
    await data.admin.reviewSwap(ADMIN, first.id, 'approved');
    expect([open(people[0]!.body, ADMIN), open(people[0]!.side!, ADMIN)]).toEqual([true, true]);
    expect(await data.admin.swapPhoto(ADMIN, second.id, 1, 'body')).toMatchObject({ state: 'shown', file: { size: PNG.length } });
    await data.admin.reviewSwap(ADMIN, second.id, 'approved');
    expect([open(people[0]!.body, ADMIN), open(people[0]!.side!, ADMIN)]).toEqual([false, false]);
  });

  it('is deleted from the disk at once by a no: the admin is told so, everything came back, and no run was ever made', async () => {
    const job = await start();
    const { body, face, side } = job.swap!.people[0]!;
    expect(await data.admin.reviewSwap(ADMIN, job.id, 'rejected')).toMatchObject({ outcome: 'done', value: { status: 'closed', creditsReturned: 3 } });
    expect([body, face!, side!].map((stored) => on(dirname(stored)))).toEqual([false, false, false]);
    expect(await data.admin.swapPhoto(ADMIN, job.id, 1, 'side')).toEqual({ state: 'deleted' });
    expect(await data.admin.swapPhoto(ADMIN, job.id, 1, 'body')).toEqual({ state: 'deleted' });
    expect(runOf(job.id)).toBeUndefined();
    expect(await data.ledger.balance('usr-demo')).toBe(19);
    expect(await data.admin.reviewSwap(ADMIN, job.id, 'approved')).toMatchObject({ outcome: 'already-done' });
    expect(runOf(job.id)).toBeUndefined();
  });
});
