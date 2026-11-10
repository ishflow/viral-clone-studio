import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock, FakeGenerator } from '../adapters/fakes.ts';
import type { GeneratorCall } from '../adapters/fakes.ts';
import type { FakeGeneratorOptions } from '../adapters/fakes.ts';
import type { Paid } from '../contracts.ts';
import { beginOperation, endOperation, getRun, operation } from '../db/runs.ts';
import { abs } from '../paths.ts';
import { GeneratorError } from '../ports.ts';
import type { Generator } from '../ports.ts';
import { paid } from './paid.ts';
import type { PaidContext } from './paid.ts';
import { planOf } from './plan.ts';
import type { Planned } from './plan.ts';
import { operationsOf } from './rows.ts';
import { creditsHold, holdCredits } from '../robust/provider-credits.ts';
import { golden, inputOf, JPEG, MediaGenerator, put, startRun, WAV, workspace } from './testing.ts';
import type { Delivery } from './testing.ts';

const { template, fill } = golden('layering-01');
const ANSWERS = { image: {}, clip: {}, music: {}, voice: {} };
const ZERO: Paid = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };
const PAID = ['image', 'clip', 'music', 'voice', 'resume'];

let db: DatabaseSync, clock: FakeClock, runId: string, plan: Record<string, Planned>, lostRuns = 0;
beforeEach(() => {
  lostRuns = 0;
  ({ db } = workspace());
  clock = new FakeClock();
  runId = startRun(db, clock, template, inputOf(template, fill, 1)).id;
  plan = Object.fromEntries(planOf(template, fill, runId, 1, { model: 'seedance-2-mini', resolution: '720p' }).map((item) => [item.key, item]));
});
const context = (generator: Generator, approved: Paid | null = getRun(db, runId)!.approved): PaidContext =>
  ({ db, generator, clock, runId, approved, billed: () => 4, claimedBy: 'worker-test', lost: () => { lostRuns += 1; } });
const fake = (options: FakeGeneratorOptions = {}, delivery?: Delivery) => new MediaGenerator({ answers: ANSWERS, ...options }, delivery);
const sent = () => getRun(db, runId)!.sent ?? ZERO;
const paidCalls = (generator: { calls: GeneratorCall[] }) => generator.calls.filter((call) => PAID.includes(call.kind));

describe('paid: a request that was never sent', () => {
  it('writes the pending row before the request, stores the ticket on acceptance, then the file and done', async () => {
    const seen: unknown[] = [];
    const generator = fake({ onCall: () => { seen.push(operation(db, runId, 'v1:image:s1')); } });
    const out = await paid(context(generator), plan['v1:image:s1']!);
    expect(seen).toEqual([expect.objectContaining({ state: 'pending', externalId: null, output: null })]);
    expect(out).toEqual({ ok: true, file: 'jobs/' + runId + '/paid/v1/image-s1.png', fresh: true });
    expect(operation(db, runId, 'v1:image:s1')).toMatchObject({ kind: 'image', state: 'done', externalId: 'fake-ticket-image-1', output: out.ok && out.file, error: null });
    expect(existsSync(abs(plan['v1:image:s1']!.file))).toBe(true);
    expect(generator.calls[0]).toMatchObject({ kind: 'image', to: abs(plan['v1:image:s1']!.file), request: plan['v1:image:s1']!.paid.request });
    expect(sent()).toEqual({ ...ZERO, images: 1 });
  });

  it('counts a clip with the seconds it bills, music and voice by one', async () => {
    const generator = fake();
    await paid(context(generator), plan['v1:clip:s2']!);
    await paid(context(generator), plan['v1:music']!);
    const withVoice = { ...getRun(db, runId)!.approved!, voice: 1 };                         // the beats template itself has no voice
    await paid(context(generator, withVoice), { ...plan['v1:music']!, key: 'v1:voice', kind: 'voice', paid: { kind: 'voice', request: { text: 'Hello.', voiceId: 'v' } } });
    expect(sent()).toEqual({ images: 0, clips: 1, clipSeconds: 4, music: 1, voice: 1 });
    expect(generator.calls.map((call) => call.kind)).toEqual(['clip', 'music', 'voice']);
  });

  it('refuses a request beyond what is approved: no row, no request', async () => {
    const generator = fake();
    const one = { ...ZERO, images: 1, clips: 2, clipSeconds: 7 };
    expect(await paid(context(generator, one), plan['v1:image:s1']!)).toMatchObject({ ok: true });
    expect(await paid(context(generator, one), plan['v1:image:s2']!)).toEqual({ ok: false, whole: true, reason: 'estimate-exceeded' });
    expect(await paid(context(generator, one), plan['v1:music']!)).toEqual({ ok: false, whole: true, reason: 'estimate-exceeded' });
    expect(await paid(context(generator, one), plan['v1:clip:s1']!)).toMatchObject({ ok: true });
    expect(await paid(context(generator, one), plan['v1:clip:s2']!)).toEqual({ ok: false, whole: true, reason: 'estimate-exceeded' });   // 4 + 4 seconds > 7
    expect(await paid(context(generator, null), plan['v1:image:s3']!)).toEqual({ ok: false, whole: true, reason: 'estimate-exceeded' });
    expect(operationsOf(db, runId).map((row) => row.key)).toEqual(['v1:clip:s1', 'v1:image:s1']);
    expect(paidCalls(generator)).toHaveLength(2);
  });

  it('a request the provider accepted uses up the approval whatever became of it; one that was never started does not', async () => {
    const generator = fake({ errors: { image: { 1: 'task-failed', 3: 'rejected' } } });
    const two = { ...ZERO, images: 2 };
    expect(await paid(context(generator, two), plan['v1:image:s1']!)).toMatchObject({ ok: false });   // accepted, then the task failed
    expect(await paid(context(generator, two), plan['v1:image:s2']!)).toMatchObject({ ok: true });
    expect(await paid(context(generator, two), plan['v1:image:s3']!)).toEqual({ ok: false, whole: true, reason: 'estimate-exceeded' });
    const three = { ...ZERO, images: 3 };
    expect(await paid(context(generator, three), plan['v1:image:s3']!)).toEqual({ ok: false, whole: true, reason: 'engine-error', code: 'provider-refused' });   // refused: nothing was started
    expect(operation(db, runId, 'v1:image:s3')).toMatchObject({ state: 'failed', externalId: null });
    expect(await paid(context(generator, three), plan['v1:image:s3']!)).toMatchObject({ ok: true });  // its second attempt fits the same approval
    expect(sent()).toEqual({ ...ZERO, images: 3 });
    expect(await paid(context(generator, three), plan['v1:image:s4']!)).toEqual({ ok: false, whole: true, reason: 'estimate-exceeded' });
  });
});

describe('paid: guards that stand between two workers and between the kinds', () => {
  it('a voice request is refused when no voice is approved, like every other kind', async () => {
    const generator = fake();
    const voice: Planned = { ...plan['v1:music']!, key: 'v1:voice', kind: 'voice', paid: { kind: 'voice', request: { text: 'Hello.', voiceId: 'v' } } };
    expect(await paid(context(generator, { images: 9, clips: 9, clipSeconds: 99, music: 9, voice: 0 }), voice)).toEqual({ ok: false, whole: true, reason: 'estimate-exceeded' });
    expect(operationsOf(db, runId)).toEqual([]);
    expect(generator.calls).toEqual([]);
  });

  it('a row that another worker wrote in the instant between the look and the write is its request: nothing is sent', async () => {
    beginOperation(db, runId, 'v1:image:s1', 'image', clock.now());                           // the other worker's row
    // this worker's first look at the key still answers "none"
    let lied = false;
    const stale = new Proxy(db, { get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (property !== 'prepare') return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      return (sql: string) => {
        const statement = target.prepare(sql);
        if (lied || !/FROM operations WHERE run_id = \? AND key = \?/.test(sql)) return statement;
        lied = true;
        return new Proxy(statement, { get: (inner, name) => (name === 'get' ? () => undefined : (Reflect.get(inner, name) as (...args: unknown[]) => unknown).bind(inner)) });
      };
    } });
    const generator = fake();
    expect(await paid({ ...context(generator), db: stale }, plan['v1:image:s1']!)).toEqual({ ok: false, whole: true, reason: 'engine-error' });
    expect(lied).toBe(true);
    expect(generator.calls).toEqual([]);
    expect(operation(db, runId, 'v1:image:s1')).toMatchObject({ state: 'pending', externalId: null });   // untouched: it is not ours
    expect(sent()).toEqual(ZERO);
  });
});

describe('paid: only while the run is running and this worker\'s', () => {
  it('a run that stopped, or that another worker took over: no row is written, nothing is sent, and the caller is told', async () => {
    const generator = fake();
    db.prepare(`UPDATE runs SET claimed_by = 'worker-2' WHERE id = ?`).run(runId);
    expect(await paid(context(generator), plan['v1:image:s1']!)).toEqual({ ok: false, whole: true, reason: 'engine-error' });
    db.prepare(`UPDATE runs SET claimed_by = 'worker-test', state = 'stopped' WHERE id = ?`).run(runId);
    expect(await paid(context(generator), plan['v1:image:s2']!)).toEqual({ ok: false, whole: true, reason: 'engine-error' });
    expect(operationsOf(db, runId)).toEqual([]);
    expect(generator.calls).toEqual([]);
    expect(lostRuns).toBe(2);
  });

  it('a run that stops while its request is in flight: the request finishes in its row, and the caller is told that it was not counted', async () => {
    const generator = fake({ onCall: () => { db.prepare(`UPDATE runs SET state = 'stopped' WHERE id = ?`).run(runId); } });
    expect(await paid(context(generator), plan['v1:image:s1']!)).toMatchObject({ ok: true, fresh: true });
    expect(operation(db, runId, 'v1:image:s1')).toMatchObject({ state: 'done', externalId: 'fake-ticket-image-1' });
    expect(lostRuns).toBe(1);
    expect(sent()).toEqual(ZERO);
  });
});

describe('paid: what a generator error does to the row and to the run', () => {
  it('submission-unknown: the row is unknown, the whole run stops, nothing is counted', async () => {
    const generator = fake({ errors: { image: { 1: 'submission-unknown' } } });
    expect(await paid(context(generator), plan['v1:image:s1']!)).toEqual({ ok: false, whole: true, reason: 'submission-unknown' });
    expect(operation(db, runId, 'v1:image:s1')).toMatchObject({ state: 'unknown', externalId: null });
    expect(sent()).toEqual(ZERO);
  });

  it('the ticket cannot be stored: the row is unknown with the ticket in its error, and the accepted request is counted', async () => {
    db.exec(`CREATE TRIGGER no_ticket BEFORE UPDATE ON operations WHEN NEW.external_id IS NOT NULL AND OLD.external_id IS NULL AND NEW.state = 'pending' BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
    // as the real clients do: the provider has accepted, the ticket could not be recorded
    const image: Generator['image'] = async (_request, _to, onSubmitted) => {
      try { onSubmitted('ticket-9'); } catch (error) { throw new GeneratorError('submission-unknown', `not recorded (${(error as Error).message})`, 'ticket-9'); }
      throw new Error('the ticket was stored');
    };
    const generator: Generator = Object.assign(fake(), { image });
    expect(await paid(context(generator), plan['v1:image:s1']!)).toEqual({ ok: false, whole: true, reason: 'submission-unknown' });
    // the ticket is in `error`, and in the row's own place too: the rows say what the provider accepted
    expect(operation(db, runId, 'v1:image:s1')).toMatchObject({ state: 'unknown', externalId: 'ticket-9', error: 'ticket-9' });
    expect(sent()).toEqual({ ...ZERO, images: 1 });
  });

  it('an unknown row that has its ticket is asked for by the ticket (a GET, never a second POST), and then it is done', async () => {
    // review T2-2: nothing could settle it (`has-ticket`) and nothing asked for it: the run stopped at it for good
    beginOperation(db, runId, 'v1:image:s1', 'image', clock.now());
    endOperation(db, runId, 'v1:image:s1', { state: 'unknown', externalId: 'ticket-9', error: 'ticket-9' }, clock.now());
    const generator = fake({ resumes: { 'ticket-9': {} } });
    expect(await paid(context(generator), plan['v1:image:s1']!)).toMatchObject({ ok: true, file: plan['v1:image:s1']!.file });
    expect(generator.calls.map((call) => call.kind)).toEqual(['resume']);
    expect(operation(db, runId, 'v1:image:s1')).toMatchObject({ state: 'done', externalId: 'ticket-9' });
  });

  it.each(['timeout', 'download-failed'] as const)('%s: the row stays pending with its ticket, only the variant stops', async (code) => {
    const generator = fake({ errors: { clip: { 1: code }, music: { 1: code } } });
    expect(await paid(context(generator), plan['v1:clip:s1']!)).toEqual({ ok: false, whole: false, reason: 'clips-failed' });
    expect(await paid(context(generator), plan['v1:music']!)).toEqual({ ok: false, whole: false, reason: 'audio-failed' });
    expect(operation(db, runId, 'v1:clip:s1')).toMatchObject({ state: 'pending', externalId: 'fake-ticket-clip-1', output: null });
    expect(sent()).toEqual({ ...ZERO, clips: 1, clipSeconds: 4, music: 1 });                 // both were accepted
  });

  it.each(['task-failed', 'empty-result'] as const)('%s: the row is failed, only the variant stops, and the next call sends it again under #2', async (code) => {
    const generator = fake({ errors: { image: { 1: code } } });
    expect(await paid(context(generator), plan['v1:image:s1']!)).toEqual({ ok: false, whole: false, reason: 'images-failed' });
    expect(operation(db, runId, 'v1:image:s1')).toMatchObject({ state: 'failed', externalId: 'fake-ticket-image-1' });
    const again = await paid(context(generator, { ...ZERO, images: 2 }), plan['v1:image:s1']!);
    expect(again).toEqual({ ok: true, file: plan['v1:image:s1']!.file, fresh: true });
    expect(operation(db, runId, 'v1:image:s1')).toMatchObject({ state: 'failed' });
    expect(operation(db, runId, 'v1:image:s1#2')).toMatchObject({ state: 'done', kind: 'image', externalId: 'fake-ticket-image-2', output: plan['v1:image:s1']!.file });
    expect(sent()).toEqual({ ...ZERO, images: 2 });
  });

  it('a request that failed twice goes under #3, and a done attempt ends the walk', async () => {
    const generator = fake({ errors: { music: { 1: 'task-failed', 2: 'empty-result' } } });
    const three = { ...ZERO, music: 3 };
    await paid(context(generator, three), plan['v1:music']!);
    await paid(context(generator, three), plan['v1:music']!);
    expect(await paid(context(generator, three), plan['v1:music']!)).toMatchObject({ ok: true, fresh: true });
    expect(await paid(context(generator, three), plan['v1:music']!)).toMatchObject({ ok: true, fresh: false });
    expect(operationsOf(db, runId).map((row) => [row.key, row.state])).toEqual([['v1:music', 'failed'], ['v1:music#2', 'failed'], ['v1:music#3', 'done']]);
    expect(paidCalls(generator)).toHaveLength(3);
    expect(sent()).toEqual({ ...ZERO, music: 3 });
  });

  it.each(['rejected', 'upload-failed', 'not-configured'] as const)('%s: nothing was started: the row is failed, the whole run stops with engine-error', async (code) => {
    const generator = fake({ errors: { clip: { 1: code } } });
    expect(await paid(context(generator), plan['v1:clip:s1']!)).toEqual({ ok: false, whole: true, reason: 'engine-error', code: ({ rejected: 'provider-refused', 'upload-failed': 'upload-failed', 'not-configured': 'provider-setup' } as const)[code] });
    expect(operation(db, runId, 'v1:clip:s1')).toMatchObject({ state: 'failed', externalId: null });
    expect(sent()).toEqual(ZERO);
  });

  it('an error that is not the generator\'s: before the acceptance the fate is unknown, after it the ticket is kept', async () => {
    const before = new FakeGenerator();                                                      // nothing scripted: it throws before any acceptance
    expect(await paid(context(before), plan['v1:image:s1']!)).toEqual({ ok: false, whole: true, reason: 'submission-unknown' });
    expect(operation(db, runId, 'v1:image:s1')).toMatchObject({ state: 'unknown' });
    const image: Generator['image'] = async (_request, _to, onSubmitted) => { onSubmitted('ticket-3'); throw new Error('broke'); };
    const after: Generator = Object.assign(fake(), { image });
    expect(await paid(context(after), plan['v1:image:s2']!)).toEqual({ ok: false, whole: true, reason: 'engine-error' });
    expect(operation(db, runId, 'v1:image:s2')).toMatchObject({ state: 'pending', externalId: 'ticket-3' });
  });
});

describe('paid: a file is named by what it is', () => {
  it('a JPEG delivered under a .png name is renamed, and the row holds the real path', async () => {
    const generator = fake({}, () => JPEG);
    const real = plan['v1:image:s1']!.file.replace(/\.png$/, '.jpg');
    expect(await paid(context(generator), plan['v1:image:s1']!)).toEqual({ ok: true, file: real, fresh: true });
    expect(operation(db, runId, 'v1:image:s1')).toMatchObject({ state: 'done', output: real });
    expect([existsSync(abs(real)), existsSync(abs(plan['v1:image:s1']!.file))]).toEqual([true, false]);
    expect(await paid(context(generator), plan['v1:image:s1']!)).toEqual({ ok: true, file: real, fresh: false });   // and is found again under it
  });

  it('a sound keeps its own name too: a WAV under .mp3 becomes .wav, also when it was asked for again by its ticket', async () => {
    const generator = fake({ resumes: { 'ticket-7': {} } }, () => WAV);
    expect(await paid(context(generator), plan['v1:music']!)).toMatchObject({ ok: true, file: plan['v1:music']!.file.replace(/\.mp3$/, '.wav') });
    beginOperation(db, runId, 'v1:clip:s1', 'clip', clock.now());
    endOperation(db, runId, 'v1:clip:s1', { externalId: 'ticket-7' }, clock.now());
    expect(await paid(context(fake({ resumes: { 'ticket-7': {} } })), plan['v1:clip:s1']!)).toMatchObject({ ok: true, file: plan['v1:clip:s1']!.file });
  });

  it('a file that is nothing the kind may be is an empty result: the row is failed, the variant stops, the next call sends it again', async () => {
    const generator = fake({}, (kind, n) => (kind === 'image' && n === 1 ? '<html>not found</html>' : kind === 'clip' ? JPEG : 'ID3 but short'));
    expect(await paid(context(generator), plan['v1:image:s1']!)).toEqual({ ok: false, whole: false, reason: 'images-failed' });
    expect(operation(db, runId, 'v1:image:s1')).toMatchObject({ state: 'failed', externalId: 'fake-ticket-image-1', output: null });
    expect(operation(db, runId, 'v1:image:s1')!.error).toMatch(/not a picture/);
    expect(await paid(context(generator), plan['v1:clip:s1']!)).toEqual({ ok: false, whole: false, reason: 'clips-failed' });   // a picture where a video was asked
    expect(sent()).toEqual({ ...ZERO, images: 1, clips: 1, clipSeconds: 4 });               // both were accepted and are paid
  });
});

describe('paid: a request that has a row already', () => {
  const begin = (key: string, patch: Parameters<typeof endOperation>[3] = {}) => {
    beginOperation(db, runId, key, 'image', clock.now());
    endOperation(db, runId, key, patch, clock.now());
  };

  it('pending with a ticket: asks for it again with resume, free, and never calls a paid method', async () => {
    begin('v1:image:s1', { externalId: 'ticket-7' });
    const generator = fake({ resumes: { 'ticket-7': {} } });
    expect(await paid(context(generator, ZERO), plan['v1:image:s1']!)).toEqual({ ok: true, file: plan['v1:image:s1']!.file, fresh: true });
    expect(generator.calls.map((call) => [call.kind, call.ticket, call.to])).toEqual([['resume', 'ticket-7', abs(plan['v1:image:s1']!.file)]]);
    expect(operation(db, runId, 'v1:image:s1')).toMatchObject({ state: 'done', externalId: 'ticket-7', output: plan['v1:image:s1']!.file });
    expect(sent()).toEqual(ZERO);
  });

  it('a resume that fails keeps the ticket unless the provider says the task itself failed', async () => {
    for (const key of ['v1:image:s1', 'v1:image:s2', 'v1:image:s3', 'v1:image:s4']) begin(key, { externalId: `ticket-${key}` });
    const generator = fake({ resumes: {
      'ticket-v1:image:s1': 'timeout', 'ticket-v1:image:s2': 'not-configured', 'ticket-v1:image:s3': 'task-failed', 'ticket-v1:image:s4': 'submission-unknown',
    } });
    expect(await paid(context(generator), plan['v1:image:s1']!)).toEqual({ ok: false, whole: false, reason: 'images-failed' });
    expect(await paid(context(generator), plan['v1:image:s2']!)).toEqual({ ok: false, whole: true, reason: 'engine-error', code: 'provider-setup' });
    expect(await paid(context(generator), plan['v1:image:s3']!)).toEqual({ ok: false, whole: false, reason: 'images-failed' });
    expect(await paid(context(generator), plan['v1:image:s4']!)).toEqual({ ok: false, whole: true, reason: 'submission-unknown' });
    expect(['v1:image:s1', 'v1:image:s2', 'v1:image:s3', 'v1:image:s4'].map((key) => operation(db, runId, key)!.state)).toEqual(['pending', 'pending', 'failed', 'unknown']);
    expect(operation(db, runId, 'v1:image:s2')!.externalId).toBe('ticket-v1:image:s2');
    expect(generator.calls.every((call) => call.kind === 'resume')).toBe(true);
  });

  it('pending without a ticket: becomes unknown, the whole run stops, nothing is asked', async () => {
    begin('v1:image:s1');
    const generator = fake();
    expect(await paid(context(generator), plan['v1:image:s1']!)).toEqual({ ok: false, whole: true, reason: 'submission-unknown' });
    expect(operation(db, runId, 'v1:image:s1')).toMatchObject({ state: 'unknown' });
    expect(await paid(context(generator), plan['v1:image:s1']!)).toEqual({ ok: false, whole: true, reason: 'submission-unknown' });   // and stays so
    expect(generator.calls).toEqual([]);
  });

  it('done: the file is reused; a file that is gone stops the whole run and is not paid for again', async () => {
    begin('v1:image:s1', { state: 'done', externalId: 't', output: plan['v1:image:s1']!.file });
    begin('v1:image:s2', { state: 'done', externalId: 't', output: plan['v1:image:s2']!.file });
    put(plan['v1:image:s1']!.file, 'an image');
    const generator = fake();
    expect(await paid(context(generator), plan['v1:image:s1']!)).toEqual({ ok: true, file: plan['v1:image:s1']!.file, fresh: false });
    expect(await paid(context(generator), plan['v1:image:s2']!)).toEqual({ ok: false, whole: true, reason: 'engine-error' });
    expect(operation(db, runId, 'v1:image:s2')).toMatchObject({ state: 'done' });
    expect(generator.calls).toEqual([]);
  });
});

describe('paid: the provider has no credits left (HTTP 402)', () => {
  const noCredits = () => new GeneratorError('rejected', 'POST /v1/ai/text-to-image/nano-banana-pro was refused: HTTP 402: Insufficient credits', null, 402);
  const refused = { ok: false, whole: true, reason: 'engine-error', code: 'provider-credits' };
  const retried = (generator: Generator): PaidContext => ({ ...context(generator), retried: true });

  it('the refusal puts the provider on hold: the run and the instant are written down', async () => {
    const generator = fake({ errors: { image: { 1: noCredits() } } });
    expect(creditsHold(db)).toBeNull();
    expect(await paid(context(generator), plan['v1:image:s1']!)).toEqual(refused);
    expect(creditsHold(db)).toEqual({ at: clock.now().toISOString(), runId, key: 'v1:image:s1' });
  });

  it('another refusal (a 4xx that is not 402) puts nothing on hold', async () => {
    const generator = fake({ errors: { image: { 1: new GeneratorError('rejected', 'POST was refused: HTTP 422: bad prompt', null, 422) } } });
    expect(await paid(context(generator), plan['v1:image:s1']!)).toMatchObject({ ok: false, code: 'provider-refused' });
    expect(creditsHold(db)).toBeNull();
  });

  it('while the hold stands a request is not sent and leaves no row: the answer is the refusal itself', async () => {
    holdCredits(db, 'another-run', 'v1:clip:s2', clock.now());
    const generator = fake();
    expect(await paid(context(generator), plan['v1:image:s1']!)).toEqual(refused);
    expect(paidCalls(generator)).toEqual([]);
    expect(operationsOf(db, runId)).toEqual([]);
    expect(sent()).toEqual(ZERO);
    expect(creditsHold(db)).toMatchObject({ runId: 'another-run' });
  });

  it('a run that stopped for it and is tried again is sent through the hold, and its first accepted request lifts it', async () => {
    holdCredits(db, runId, 'v1:image:s1', clock.now());
    const generator = fake();
    expect(await paid(retried(generator), plan['v1:image:s1']!)).toMatchObject({ ok: true });
    expect(paidCalls(generator)).toHaveLength(1);
    expect(creditsHold(db)).toBeNull();
  });

  it('tried again while the provider still refuses: one request, and the hold stands', async () => {
    holdCredits(db, runId, 'v1:image:s1', clock.now());
    const generator = fake({ errors: { image: { 1: noCredits() } } });
    expect(await paid(retried(generator), plan['v1:image:s1']!)).toEqual(refused);
    expect(paidCalls(generator)).toHaveLength(1);
    expect(creditsHold(db)).toMatchObject({ runId });
  });

  it('a request that was on its way when another run was refused does not lift the hold by being accepted', async () => {
    const generator = fake({ onCall: () => { holdCredits(db, 'another-run', 'v1:clip:s2', clock.now()); } });
    expect(await paid(context(generator), plan['v1:image:s1']!)).toMatchObject({ ok: true });
    expect(creditsHold(db)).toMatchObject({ runId: 'another-run' });
  });

  it('a refusal newer than the hold a tried-again request was sent under is not lifted by that request', async () => {
    holdCredits(db, runId, 'v1:image:s1', clock.now());
    const generator = fake({ onCall: () => { clock.advance(1000); holdCredits(db, 'another-run', 'v1:clip:s2', clock.now()); } });
    expect(await paid(retried(generator), plan['v1:image:s1']!)).toMatchObject({ ok: true });
    expect(creditsHold(db)).toMatchObject({ runId: 'another-run' });
  });

  it('a task the provider accepted before the hold is still asked for by its ticket: a question costs nothing', async () => {
    beginOperation(db, runId, 'v1:image:s1', 'image', clock.now());
    endOperation(db, runId, 'v1:image:s1', { externalId: 'ticket-7' }, clock.now());
    holdCredits(db, 'another-run', 'v1:clip:s2', clock.now());
    const generator = fake({ resumes: { 'ticket-7': {} } });
    expect(await paid(context(generator), plan['v1:image:s1']!)).toMatchObject({ ok: true });
    expect(generator.calls.map((call) => call.kind)).toEqual(['resume']);
    expect(creditsHold(db)).toMatchObject({ runId: 'another-run' });
  });
});
