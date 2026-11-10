// A person swap through the worker from end to end: the template the worker prepares from a file on this disk is one the worker
// makes a video from. A model that answers from a script, the pretend provider, the real ffmpeg tools; nothing is fetched or paid.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock, FakeLlm, FakeRenderer } from '../adapters/fakes.ts';
import type { RunInput } from '../contracts.ts';
import { openDb } from '../db/open.ts';
import { claim, enqueue, getRun } from '../db/runs.ts';
import * as templates from '../db/templates.ts';
import { countOf } from '../produce/plan.ts';
import { PHOTOGRAPH, put } from '../produce/testing.ts';
import { loadSwap, needsOf } from '../swap/plan.ts';
import { ONE_PERSON, video } from '../swap/prepare.testing.ts';
import { BODY, hasFfmpeg, inputOf } from '../swap/testing.ts';
import { realHandlers } from './main.ts';
import { buildParts } from './parts.ts';

const clock = new FakeClock('2026-10-07T10:00:00.000Z');
const ID = 'swap-new', UPLOAD = '11111111-2222-4333-8444-555555555555', ADMIN = 'admin-1';
type Prepare = Extract<RunInput, { kind: 'prepare' }>;

/** A worker on a data dir of its own, with a model that answers from `answers` and nothing that starts a process when it is built. */
function build(answers: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), 'vc-swap-prepare-'));
  vi.stubEnv('VC_DATA_DIR', dir);
  const db = openDb(join(dir, 'db.sqlite'));
  const parts = buildParts({ VC_DATA_DIR: dir, CLAUDE_CODE_OAUTH_TOKEN: 'token-made-up' }, db, clock, { renderer: new FakeRenderer({ ready: { ready: true, note: null } }), aligner: { align: async () => [], ready: async () => ({ ready: false, note: null }) } });
  const llm = new FakeLlm(answers);
  return { dir, db, llm, handlers: realHandlers({ ...parts, prepareDeps: { ...parts.prepareDeps, llm } }) };
}
/** The row the site writes with a prepare run, and the run, claimed. */
function begin(db: ReturnType<typeof openDb>, input: Prepare) {
  templates.upsert(db, {
    id: ID, state: 'preparing', owner: null, sourceKind: 'upload', sourceUrl: null, note: null, estimate: null, minutes: null,
    card: { title: 'dance.mp4', category: '', format: 'no-talking', seconds: 0, referenceViews: '', image: null, video: null, products: 0, shots: [], description: '', tags: [] },
  }, clock.now());
  enqueue(db, input, ID, null, clock.now());
  return claim(db, 'worker-test', clock.now())!;
}
/** A video under uploads/ as the site keeps a file an admin uploaded, and the prepare run the site writes for it. Call after `build`. */
function uploaded(): Prepare {
  const bytes = readFileSync(video(12, 5)), sha256 = createHash('sha256').update(bytes).digest('hex');
  put(`uploads/${UPLOAD}/source.mp4`, bytes);
  put(`uploads/${UPLOAD}/uploader`, ADMIN);
  put(`uploads/${UPLOAD}/video.json`, JSON.stringify({ sha256, path: `uploads/${UPLOAD}/source.mp4`, bytes: bytes.length, name: 'dance.mp4' }));
  return { kind: 'prepare', templateId: ID, ownerId: ADMIN, mode: 'swap', from: { kind: 'upload', uploadId: UPLOAD, sha256 } };
}
afterEach(() => { vi.unstubAllEnvs(); });

describe.skipIf(!hasFfmpeg)('the worker, from a file an admin uploaded to a delivered video', () => {
  it('prepares the person-swap template without asking a provider for anything, and makes a video from it with the photographs of a customer', async () => {
    const { dir, db, llm, handlers } = build([ONE_PERSON]);
    const prepared = begin(db, uploaded());
    await handlers.prepare(prepared);
    expect(getRun(db, prepared.id)).toMatchObject({ state: 'done', result: { kind: 'prepare', state: 'ready', note: null }, sent: null });
    expect(llm.calls).toHaveLength(1);
    const swap = loadSwap(ID)!;
    expect(templates.get(db, ID)).toMatchObject({ state: 'ready', card: { swap, shots: [] } });
    // free: neither provider was sent anything, and no paid request was recorded
    const logs = () => ['fake-swapper.log', 'fake-generator.log'].map((log) => existsSync(join(dir, log)));
    expect(logs()).toEqual([false, false]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM operations').get()).toEqual({ n: 0 });

    put(BODY, PHOTOGRAPH);
    const id = enqueue(db, inputOf({ templateId: ID }), 'job-1', countOf(needsOf(swap, 'any')), clock.now());
    await handlers.produce(claim(db, 'worker-test', clock.now())!);
    expect(getRun(db, id)).toMatchObject({ state: 'done', reason: null, sent: { clips: 2, clipSeconds: 12 }, result: { kind: 'produce', variants: [{ video: `jobs/${id}/v1/final.mp4`, image: `jobs/${id}/v1/poster.jpg` }] } });
    expect(existsSync(join(dir, 'jobs', id, 'v1', 'final.mp4'))).toBe(true);
    expect(logs()).toEqual([true, false]);
  }, 120_000);

  it('a person-swap template is no product template: a product run of it finds none', async () => {
    const { dir, db, handlers } = build([ONE_PERSON]);
    await handlers.prepare(begin(db, uploaded()));

    const id = enqueue(db, { kind: 'produce', templateId: ID, quality: 'fast', variants: 1, language: 'en', products: [], sample: false }, 'job-2', null, clock.now());
    await handlers.produce(claim(db, 'worker-test', clock.now())!);
    expect(getRun(db, id)).toMatchObject({ state: 'stopped', reason: 'template-missing' });
    expect(['fake-swapper.log', 'fake-generator.log'].map((log) => existsSync(join(dir, log)))).toEqual([false, false]);
  }, 120_000);
});
