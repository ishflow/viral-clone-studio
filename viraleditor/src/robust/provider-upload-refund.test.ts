// A request that fails before its paid POST (`upload-failed`: a reference could not be read or uploaded) cost nothing, so the units
// `beforePaid` took go back the way a refused POST gives them back (R2): to the day that was charged, and once. A request that was
// sent, or whose outcome is not known, stays counted.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClock, FakeRenderer } from '../adapters/fakes.ts';
import { createMagnific } from '../adapters/magnific.ts';
import { UPLOAD_PATH } from '../adapters/routes.ts';
import { beginOperation, getRun, operation } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import { abs } from '../paths.ts';
import type { GeneratorError } from '../ports.ts';
import { paid } from '../produce/paid.ts';
import type { PaidContext } from '../produce/paid.ts';
import { planOf } from '../produce/plan.ts';
import type { Planned } from '../produce/plan.ts';
import { operationsOf } from '../produce/rows.ts';
import { golden, inputOf, PHOTOGRAPH, put, resumeRun, startRun, workspace } from '../produce/testing.ts';
import { buildParts } from '../worker/parts.ts';
import { budgetSchema, consumeProvider, refundProvider } from './provider-budget.ts';
import { settleUnknown } from './settle-unknown.ts';

const DAY = new Date('2026-10-06T10:00:00Z');
const caps = { daily: 100, job: 60 };
type Answer = Response | Error;
const status = (code: number): Answer => new Response(JSON.stringify({ message: 'no' }), { status: code });
const slot = (): Answer => new Response(JSON.stringify({ files: [{ upload_url: 'https://up.example/u', asset_url: 'https://assets.example/photo.png', headers: {} }] }), { status: 200 });
const accepted = (): Answer => new Response(JSON.stringify({ data: { task_id: 't', status: 'CREATED' } }), { status: 200 });
const settle = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as GeneratorError);
const consumedOn = (db: DatabaseSync, run: string, day: string): number =>
  (db.prepare('SELECT COALESCE(SUM(consumed), 0) AS n FROM provider_budget WHERE run_id = ? AND day = ?').get(run, day) as { n: number }).n;
const consumedOf = (db: DatabaseSync, run: string): number =>
  (db.prepare('SELECT COALESCE(SUM(consumed), 0) AS n FROM provider_budget WHERE run_id = ?').get(run) as { n: number }).n;

interface Script { address?: () => Answer; put?: () => Answer; paid?: () => Answer }
/** A Magnific client on scripted answers (the upload address, the upload, the paid POST), wired to a real budget database the way worker/parts.ts wires it. */
function stage(script: Script = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vc-upload-refund-'));
  const db = new DatabaseSync(join(dir, 'db.sqlite')); budgetSchema(db);
  const photo = join(dir, 'photo.png'); writeFileSync(photo, PHOTOGRAPH);
  const clock = { now: DAY };
  const seen = { address: 0, put: 0, paid: 0 };
  const refunds: number[] = [];
  const answer = (a: () => Answer): Response => { const r = a(); if (r instanceof Error) throw r; return r; };
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (method === 'POST' && String(url).endsWith(UPLOAD_PATH)) { seen.address += 1; return answer(script.address ?? slot); }
    if (method === 'PUT') { seen.put += 1; return answer(script.put ?? (() => new Response('', { status: 200 }))); }
    if (method === 'POST') { seen.paid += 1; return answer(script.paid ?? accepted); }
    return new Response(JSON.stringify({ data: { task_id: 't', status: 'IN_PROGRESS', generated: [] } }), { status: 200 });
  }) as unknown as typeof fetch;
  const generator = createMagnific({
    apiKey: 'test-key-made-up', spendDir: dir, fetch: fetcher, pollMs: 1, taskTimeoutMs: 5, requestTimeoutMs: 1000, sleep: async () => {},
    beforePaid: (runId, units) => { const at = clock.now; consumeProvider(db, caps, runId, units, at); return at; },
    afterRefused: (runId, units, at) => { refunds.push(units); refundProvider(db, caps, runId, units, at ?? clock.now); },
  });
  const image = (run: string, file = photo) => settle(generator.image({ prompt: 'circle', references: [file], aspect: '1:1' }, join(dir, 'jobs', run, 'a.png'), () => {}));
  const clip = (run: string, seconds: number) => settle(generator.clip(
    { mode: 'first-frame', firstFrame: photo, prompt: 'slow push in', seconds, tier: { model: 'seedance-2-mini', resolution: '720p' } }, join(dir, 'jobs', run, 'a.mp4'), () => {}));
  return { db, dir, clock, seen, refunds, image, clip };
}

describe('upload-failed: the Magnific client and the budget', () => {
  it.each([
    ['the upload address gets no answer', { address: () => new TypeError('fetch failed') }],
    ['the upload address is refused', { address: () => status(500) }],
    ['the answer has no upload address', { address: () => new Response('{}', { status: 200 }) }],
    ['the upload gets no answer', { put: () => new TypeError('fetch failed') }],
    ['the upload is refused', { put: () => status(403) }],
  ] as [string, Script][])('%s: no paid POST was sent, the unit goes back, once', async (_name, script) => {
    const s = stage(script);
    const error = await s.image('job-a');
    expect(error?.code).toBe('upload-failed');
    expect(s.seen.paid).toBe(0);
    expect(s.refunds).toEqual([1]);
    expect(consumedOf(s.db, 'job-a')).toBe(0);
  });
  it('a reference that cannot be read or is no image: nothing is sent at all, the unit goes back, once', async () => {
    const s = stage();
    expect((await s.image('job-b', join(s.dir, 'gone.png')))?.code).toBe('upload-failed');
    writeFileSync(join(s.dir, 'notes.txt'), 'x');
    expect((await s.image('job-b', join(s.dir, 'notes.txt')))?.code).toBe('upload-failed');
    expect(s.seen).toEqual({ address: 0, put: 0, paid: 0 });
    expect(s.refunds).toEqual([1, 1]);
    expect(consumedOf(s.db, 'job-b')).toBe(0);
  });
  it('gives back exactly the units of the request: what another request of the job really spent stays counted', async () => {
    const s = stage({ put: () => status(500) });
    consumeProvider(s.db, caps, 'job-c', 7, DAY);                              // another request, sent and paid for
    expect((await s.clip('job-c', 5))?.code).toBe('upload-failed');
    expect(s.refunds).toEqual([5]);
    expect(consumedOf(s.db, 'job-c')).toBe(7);
  });
  it('an upload that fails after UTC midnight gives back the day that was charged, not the units another request consumed on the next day', async () => {
    const next = new Date('2026-10-07T00:00:30Z');
    const s = stage({ put: () => { s.clock.now = next; consumeProvider(s.db, caps, 'job-d', 4, next); return status(500); } });
    s.clock.now = new Date('2026-10-06T23:59:30Z');
    expect((await s.image('job-d'))?.code).toBe('upload-failed');
    expect(consumedOn(s.db, 'job-d', '2026-10-06')).toBe(0);
    expect(consumedOn(s.db, 'job-d', '2026-10-07')).toBe(4);
  });
  it('many upload failures in a row never fill the job cap: the failed tries cost nothing', async () => {
    const s = stage({ address: () => status(503) });
    const codes = new Set<string | undefined>();
    for (let i = 0; i < 100; i += 1) codes.add((await s.image('job-e'))?.code);
    expect([...codes]).toEqual(['upload-failed']);                              // never `rejected` by our own cap (job cap 60)
    expect(s.refunds).toHaveLength(100);                                        // one refund per try
    expect(consumedOf(s.db, 'job-e')).toBe(0);
    expect(() => consumeProvider(s.db, caps, 'job-e', 43, DAY)).not.toThrow();
  });
  it.each([
    ['500', () => status(500)], ['408', () => status(408)], ['no answer', () => new TypeError('fetch failed')],
    ['200 without a task', () => new Response('{}', { status: 200 })],
  ] as [string, () => Answer][])('the reference was uploaded and the paid POST answered %s: the outcome is unknown, nothing is given back', async (_name, answer) => {
    const s = stage({ paid: answer });
    expect((await s.clip('job-f', 5))?.code).toBe('submission-unknown');
    expect(s.seen.paid).toBe(1);
    expect(s.refunds).toEqual([]);
    expect(consumedOf(s.db, 'job-f')).toBe(5);
  });
  it('the reference was uploaded and the paid POST was accepted: nothing is given back', async () => {
    const s = stage();
    await s.clip('job-g', 5);
    expect(s.seen.paid).toBe(1);
    expect(s.refunds).toEqual([]);
    expect(consumedOf(s.db, 'job-g')).toBe(5);
  });
  it('the reference was uploaded and the paid POST was refused for good: given back once, by the refusal alone', async () => {
    const s = stage({ paid: () => status(402) });
    expect((await s.clip('job-h', 5))?.code).toBe('rejected');
    expect(s.refunds).toEqual([5]);
    expect(consumedOf(s.db, 'job-h')).toBe(0);
  });
});

// The rows of a run, with the worker's own wiring (`buildParts`): the budget key is the job, the charge time is the worker's clock.
describe('upload-failed: a row is given back once, whatever happens to the run afterwards', () => {
  const { template, fill } = golden('layering-01');
  let db: DatabaseSync, clock: FakeClock, run: RunRow, uploads: 'fail' | 'ok', paidPosts: number;
  let withPhoto: Planned, plain: Planned, generator: PaidContext['generator'];
  beforeEach(() => {
    uploads = 'fail'; paidPosts = 0;
    // the worker's Magnific client speaks through the global fetch: scripted, so nothing reaches the network
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      if (method === 'POST' && String(url).endsWith(UPLOAD_PATH)) return uploads === 'ok' ? slot() : status(500);
      if (method === 'PUT') return new Response('', { status: 200 });
      if (method === 'POST') { paidPosts += 1; return new Response(JSON.stringify({ data: { task_id: `t${paidPosts}`, status: 'COMPLETED', generated: ['https://files.example/a.png'] } }), { status: 200 }); }
      return new Response(PHOTOGRAPH, { status: 200, headers: { 'content-type': 'image/png' } });
    });
    const work = workspace();
    db = work.db;
    clock = new FakeClock('2026-10-06T10:00:00.000Z');
    run = startRun(db, clock, template, inputOf(template, fill, 1));
    const plan = Object.fromEntries(planOf(template, fill, run.id, 1, { model: 'seedance-2-mini', resolution: '720p' }).map((item) => [item.key, item]));
    put('uploads/photo.png', PHOTOGRAPH);
    const s1 = plan['v1:image:s1']!, s2 = plan['v1:image:s2']!;
    if (s1.paid.kind !== 'image' || s2.paid.kind !== 'image') throw new Error('the plan has no image requests');
    withPhoto = { ...s1, paid: { kind: 'image', request: { ...s1.paid.request, references: [abs('uploads/photo.png')] } } };
    plain = { ...s2, paid: { kind: 'image', request: { ...s2.paid.request, references: [] } } };
    generator = buildParts(
      { VC_DATA_DIR: work.dir, CLAUDE_CODE_OAUTH_TOKEN: 'token-made-up', VC_PROVIDER: 'magnific', MAGNIFIC_API_KEY: 'k-test', VC_PROVIDER_DAILY_CAP: '100', VC_PROVIDER_JOB_CAP: '60' },
      db, clock, { renderer: new FakeRenderer({ ready: { ready: true, note: null } }), aligner: { align: async () => [], ready: async () => ({ ready: false, note: null }) } },
    ).produceDeps().generator;
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  const context = (claimedBy = 'worker-test'): PaidContext => ({ db, generator, clock, runId: run.id, claimedBy, lost: () => {}, approved: getRun(db, run.id)!.approved, billed: () => 4 });
  const consumed = () => consumedOf(db, run.ref);
  const UPLOAD_FAILED = { ok: false, whole: true, reason: 'engine-error', code: 'upload-failed' };
  const stopAndResume = () => {
    db.prepare("UPDATE runs SET state = 'stopped', reason = 'engine-error', detail = 'upload-failed' WHERE id = ?").run(run.id);
    resumeRun(db, clock, run.id);
  };

  it('tried again: each try is its own row and its own unit; the unit the paid request spent stays counted', async () => {
    expect(await paid(context(), plain)).toMatchObject({ ok: true });                         // a request that was sent: 1 unit, really spent
    expect(await paid(context(), withPhoto)).toEqual(UPLOAD_FAILED);
    expect(operation(db, run.id, 'v1:image:s1')).toMatchObject({ state: 'failed', externalId: null });
    expect(consumed()).toBe(1);
    expect(await paid(context(), withPhoto)).toEqual(UPLOAD_FAILED);                          // the first row is not given back a second time: that would read 0
    expect(consumed()).toBe(1);
    uploads = 'ok';
    expect(await paid(context(), withPhoto)).toMatchObject({ ok: true });
    expect(operationsOf(db, run.id).map((row) => `${row.key} ${row.state}`)).toEqual(['v1:image:s1 failed', 'v1:image:s1#2 failed', 'v1:image:s1#3 done', 'v1:image:s2 done']);
    expect(paidPosts).toBe(2);
    expect(consumed()).toBe(2);                                                               // exactly the two requests that were sent
  });
  it('stopped and resumed: the failed row is not given back again, the resend is charged once', async () => {
    expect(await paid(context(), plain)).toMatchObject({ ok: true });
    expect(await paid(context(), withPhoto)).toEqual(UPLOAD_FAILED);
    stopAndResume();
    expect(consumed()).toBe(1);
    expect(await paid(context(), withPhoto)).toEqual(UPLOAD_FAILED);
    stopAndResume();
    expect(consumed()).toBe(1);
    uploads = 'ok';
    expect(await paid(context(), withPhoto)).toMatchObject({ ok: true });
    expect(paidPosts).toBe(2);
    expect(consumed()).toBe(2);
  });
  it('taken over by another worker: the failed row is not given back again and cannot be settled', async () => {
    expect(await paid(context(), plain)).toMatchObject({ ok: true });
    expect(await paid(context(), withPhoto)).toEqual(UPLOAD_FAILED);
    db.prepare("UPDATE runs SET claimed_by = 'worker-b' WHERE id = ?").run(run.id);
    expect(await paid(context('worker-b'), withPhoto)).toEqual(UPLOAD_FAILED);
    expect(consumed()).toBe(1);
    db.prepare("UPDATE runs SET state = 'stopped', reason = 'submission-unknown' WHERE id = ?").run(run.id);
    const refund = vi.fn();
    expect(() => settleUnknown(db, refund, { runId: run.id, by: 'admin', at: clock.now(), keys: ['v1:image:s1'] })).toThrow('not-unknown');
    expect(refund).not.toHaveBeenCalled();
    expect(consumed()).toBe(1);
  });
  it('a worker that died while it uploaded leaves a row whose outcome is unknown: it is not given back, not by the takeover and not by a settle', async () => {
    // what the dead worker left: the row, and the unit `beforePaid` took (its POST may or may not have gone out)
    beginOperation(db, run.id, 'v1:image:s1', 'image', clock.now());
    consumeProvider(db, { daily: 100, job: 60 }, run.ref, 1, clock.now());
    db.prepare("UPDATE runs SET claimed_by = 'worker-b' WHERE id = ?").run(run.id);
    expect(await paid(context('worker-b'), withPhoto)).toEqual({ ok: false, whole: true, reason: 'submission-unknown' });
    expect(operation(db, run.id, 'v1:image:s1')).toMatchObject({ state: 'unknown', externalId: null });
    expect(paidPosts).toBe(0);
    expect(consumed()).toBe(1);
    db.prepare("UPDATE runs SET state = 'stopped', reason = 'submission-unknown' WHERE id = ?").run(run.id);
    const done = settleUnknown(db, (key, units, at) => refundProvider(db, { daily: 100, job: 60 }, key, units, at), { runId: run.id, by: 'admin', at: clock.now() });
    expect(done.refunded).toBe(0);
    expect(consumed()).toBe(1);
  });
});
