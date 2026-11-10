// A worker stops in the middle of a part of a person-swap video (the request is at the provider, the answer is not here) and
// another worker takes the run over. Two worker loops on one database file, the real person-swap handler, the pretend provider on
// real files. The provider's own record is the pretend provider's log: one line per request it accepted, so a part that is sent
// twice is two lines, as it would be two invoices.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { containerFacts } from '../adapters/encode.ts';
import { createFakeSwapper } from '../adapters/fake-swapper.ts';
import type { CardSwap, Paid } from '../contracts.ts';
import { openDb } from '../db/open.ts';
import { enqueue, getRun, operation, STALE_MS } from '../db/runs.ts';
import { abs } from '../paths.ts';
import { GeneratorError } from '../ports.ts';
import type { PersonSwapper } from '../ports.ts';
import { countOf } from '../produce/plan.ts';
import { workspace } from '../produce/testing.ts';
import { swapHandler } from '../swap/index.ts';
import { needsOf } from '../swap/plan.ts';
import { FFMPEG, FFPROBE, finalOf, hasFfmpeg, inputOf, seedSwap, tools } from '../swap/testing.ts';
import { runWorker } from '../worker/loop.ts';
import { settleUnknown } from './settle-unknown.ts';

const TIERS = { fast: { model: 'fake-swap', resolution: '720p' }, best: { model: 'fake-swap', resolution: '1080p' } };
const ZERO: Paid = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };
const SLOW = 120_000;
const T0 = Date.parse('2026-10-07T10:00:00.000Z');
const KEYS = ['v1:clip:p01', 'v1:clip:p02'];
const health = async () => ({ provider: 'fake' as const, renderer: 'ready' as const, note: null });
const ok = async () => {};
async function until(check: () => boolean, ms = 60_000): Promise<void> {
  for (const end = Date.now() + ms; Date.now() < end;) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  throw new Error('timed out waiting');
}

/**
 * The pretend provider for a worker that stops hearing: every request reaches the provider (a line of its log), and then the
 * worker stands still until `wake`. `heard`: what it had of the answer before it stood still. `ticket`: the acceptance, recorded.
 * `nothing`: not even that; it hears the acceptance only when it wakes, as a worker whose connection hung does.
 */
function standsStill(real: PersonSwapper, heard: 'ticket' | 'nothing') {
  let wake!: () => void;
  const woken = new Promise<void>((resolve) => { wake = resolve; });
  const sent: string[] = [];
  const swapper: PersonSwapper = {
    ...real,
    async replace(request, to, onSubmitted) {
      let ticket = '';
      const made = await real.replace(request, to, (accepted) => { ticket = accepted; if (heard === 'ticket') onSubmitted(accepted); });
      sent.push(request.video);
      await woken;
      if (heard === 'nothing') onSubmitted(ticket);
      return made;
    },
  };
  return { swapper, sent, wake };
}

/** The provider with every call of it written down; `resume` answers what `asked` gives instead, when it gives something. */
function listened(real: PersonSwapper, asked: (ticket: string) => Error | undefined = () => undefined) {
  const calls: string[] = [];
  const swapper: PersonSwapper = {
    ...real,
    replace(request, to, onSubmitted) { calls.push(`replace ${basename(request.video)}`); return real.replace(request, to, onSubmitted); },
    async resume(ticket, to) { calls.push(`resume ${ticket}`); const said = asked(ticket); if (said !== undefined) throw said; return real.resume(ticket, to); },
  };
  return { swapper, calls };
}

let db: DatabaseSync, dir: string, swap: CardSwap, runId: string, errors: ReturnType<typeof vi.spyOn>;
let stops: Array<() => Promise<void>>;
beforeEach(async () => {
  ({ db, dir } = workspace());
  stops = [];
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  if (!hasFfmpeg) return;
  swap = await seedSwap(12);                                                // two parts of 6 seconds
  runId = enqueue(db, inputOf(), 'job-1', countOf(needsOf(swap, 'any')), new Date(T0));
}, SLOW);
// the last one started is stopped first: worker A is let go before its loop is waited for
afterEach(async () => { for (const stop of stops.reverse()) await stop(); errors.mockRestore(); }, SLOW);

const provider = () => createFakeSwapper({ log: join(dir, 'fake-swapper.log'), ffmpeg: FFMPEG, ffprobe: FFPROBE });
/** What the provider accepted, in order: the part of each request. A part named twice was sent twice. */
const accepted = () => (existsSync(join(dir, 'fake-swapper.log')) ? readFileSync(join(dir, 'fake-swapper.log'), 'utf8').trim().split('\n').map((row) => basename((JSON.parse(row) as { video: string }).video)) : []);
const rows = () => KEYS.map((key) => { const row = operation(db, runId, key)!; return [row.state, row.externalId]; });
const said = (): string[] => (errors.mock.calls as unknown[][]).map((call) => String(call[0]));
const hashOf = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
/** The run is queued again, as the site queues a job its customer continues. */
const queueAgain = () => { db.prepare("UPDATE runs SET state = 'queued', claimed_by = NULL, heartbeat = NULL WHERE id = ?").run(runId); };

/** Worker A on the test's connection, its clock standing still: it beats no more. Worker B on a connection of its own, 61 s later. */
function start(who: 'A' | 'B', swapper: PersonSwapper) {
  const own = who === 'A' ? db : openDb(join(dir, 'db.sqlite'));
  const clock = { now: () => new Date(T0 + (who === 'A' ? 0 : STALE_MS + 1000)) };
  const worker = runWorker({ db: own, clock, workerId: `worker-${who}`, idleMs: 20, health, handlers: { produce: swapHandler({ db: own, swapper, ...tools(), clock, tiers: TIERS }), scan: ok, prepare: ok, edit: ok } });
  stops.push(() => worker.stop());
  return worker;
}
/** Worker A has sent both parts and stands still; B is started and takes the run over. */
async function takenOver(heard: 'ticket' | 'nothing', asked?: (ticket: string) => Error | undefined) {
  const a = standsStill(provider(), heard);
  start('A', a.swapper);
  await until(() => a.sent.length === 2);
  stops.push(async () => { a.wake(); });
  const b = listened(provider(), asked);
  start('B', b.swapper);
  return { a, b };
}

describe.skipIf(!hasFfmpeg)('a worker stops in the middle of a part of a person-swap video and another takes the run over', () => {
  it('the acceptance was recorded: the new worker asks for each part by its ticket and sends nothing; the old one, when it wakes, changes nothing', async () => {
    const { a, b } = await takenOver('ticket');
    expect(rows()).toEqual([['pending', 'fake-swap-1'], ['pending', 'fake-swap-2']]);
    await until(() => getRun(db, runId)!.state === 'done');
    expect([...b.calls].sort()).toEqual(['resume fake-swap-1', 'resume fake-swap-2']);
    expect(accepted()).toEqual(['p01.mp4', 'p02.mp4']);                     // the provider was sent each part once
    const done = getRun(db, runId)!;
    expect(done).toMatchObject({ state: 'done', claimedBy: 'worker-B', sent: { ...ZERO, clips: 2, clipSeconds: 12 }, result: { kind: 'produce', variants: [{ video: `jobs/${runId}/v1/final.mp4` }] } });
    expect((await containerFacts(FFPROBE, finalOf(runId), 10_000)).frames).toBe(360);
    const delivered = hashOf(finalOf(runId));

    a.wake();
    await until(() => said().some((line) => line.includes(`run ${runId}: not-owner`)));
    expect(getRun(db, runId)).toEqual(done);
    expect(rows()).toEqual([['done', 'fake-swap-1'], ['done', 'fake-swap-2']]);
    expect(accepted()).toHaveLength(2);
    expect(hashOf(finalOf(runId))).toBe(delivered);
    expect(readdirSync(abs(`jobs/${runId}/v1`)).filter((name) => name.includes('.part-'))).toEqual([]);   // the worker that lost the run left no file of its own beside the video
  }, SLOW);

  it('no acceptance was recorded: the run stops as submission-unknown with every such part named for the operator; nothing is sent again, by the takeover or by a resume', async () => {
    const { b } = await takenOver('nothing');
    expect(accepted()).toEqual(['p01.mp4', 'p02.mp4']);                     // both requests exist at the provider, and the engine has no ticket of either
    await until(() => getRun(db, runId)!.state === 'stopped');
    expect(getRun(db, runId)).toMatchObject({ state: 'stopped', reason: 'submission-unknown', claimedBy: 'worker-B', missing: ZERO, result: { kind: 'produce', variants: [] } });
    expect(rows()).toEqual([['unknown', null], ['unknown', null]]);
    expect(getRun(db, runId)!.sent ?? ZERO).toEqual(ZERO);                  // nothing is on record as accepted
    expect(said().filter((line) => line.startsWith('produce-unknown:'))).toEqual(KEYS.map((key) => `produce-unknown: run ${runId} ${key} worker-stopped no-ticket`));
    expect(JSON.parse(readFileSync(abs(`jobs/${runId}/stop.json`), 'utf8'))).toMatchObject({ reason: 'submission-unknown', detail: `no answer was recorded for ${KEYS.join(', ')}: the request may exist` });
    expect(existsSync(finalOf(runId))).toBe(false);

    queueAgain();                                                           // the customer continues the job: approving again cannot send what may exist
    await until(() => getRun(db, runId)!.state === 'stopped');
    expect(getRun(db, runId)).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
    expect(b.calls).toEqual([]);
    expect(accepted()).toHaveLength(2);
  }, SLOW);

  it('no acceptance was recorded, and the operator finds no such request at the provider: settled by hand, a resume sends exactly those parts as new requests', async () => {
    const { b } = await takenOver('nothing');
    await until(() => getRun(db, runId)!.state === 'stopped');
    expect(settleUnknown(db, null, { runId, by: 'operator', at: new Date(T0) })).toEqual({ keys: KEYS, refunded: 0 });
    expect(getRun(db, runId)).toMatchObject({ state: 'stopped', reason: 'engine-error' });
    expect(b.calls).toEqual([]);                                            // settling sends nothing by itself
    queueAgain();
    await until(() => getRun(db, runId)!.state === 'done');
    expect([...b.calls].sort()).toEqual(['replace p01.mp4', 'replace p02.mp4']);
    expect(KEYS.map((key) => [operation(db, runId, key)!.state, operation(db, runId, `${key}#2`)!.state])).toEqual([['failed', 'done'], ['failed', 'done']]);
    expect(getRun(db, runId)!.sent).toEqual({ ...ZERO, clips: 2, clipSeconds: 12 });
  }, SLOW);

  it('no acceptance was recorded, and the old worker hears it after all: the ticket is kept although the run is not its own, and a resume asks for the parts by it instead of sending them', async () => {
    const { a, b } = await takenOver('nothing');
    await until(() => getRun(db, runId)!.state === 'stopped');
    a.wake();
    await until(() => rows().every(([, ticket]) => ticket !== null));
    expect(rows()).toEqual([['unknown', 'fake-swap-1'], ['unknown', 'fake-swap-2']]);
    expect(getRun(db, runId)).toMatchObject({ state: 'stopped', reason: 'submission-unknown', claimedBy: 'worker-B' });
    expect(() => settleUnknown(db, null, { runId, by: 'operator', at: new Date(T0) })).toThrow('has-ticket');   // the provider took them: nobody may call them unsent
    queueAgain();
    await until(() => getRun(db, runId)!.state !== 'queued' && getRun(db, runId)!.state !== 'running');
    expect(getRun(db, runId)).toMatchObject({ state: 'done', sent: { ...ZERO, clips: 2, clipSeconds: 12 } });
    expect([...b.calls].sort()).toEqual(['resume fake-swap-1', 'resume fake-swap-2']);
    expect(accepted()).toEqual(['p01.mp4', 'p02.mp4']);
  }, SLOW);

  it('the acceptance was recorded but the provider does not know the ticket: the run stops as submission-unknown, the tickets and the count stay, nothing is sent again, and it goes on once the provider answers for them', async () => {
    let known = false;
    const { b } = await takenOver('ticket', () => (known ? undefined : new GeneratorError('submission-unknown', 'the provider has no such task')));
    await until(() => getRun(db, runId)!.state === 'stopped');
    expect(getRun(db, runId)).toMatchObject({ state: 'stopped', reason: 'submission-unknown', missing: ZERO, sent: { ...ZERO, clips: 2, clipSeconds: 12 }, result: { kind: 'produce', variants: [] } });
    expect(rows().map(([, ticket]) => ticket)).toEqual(['fake-swap-1', 'fake-swap-2']);
    expect(rows().map(([state]) => state)).toContain('unknown');
    expect(() => settleUnknown(db, null, { runId, by: 'operator', at: new Date(T0) })).toThrow('has-ticket');   // not the operator's to settle: the provider took the request
    expect(existsSync(finalOf(runId))).toBe(false);

    queueAgain();                                                           // still unknown at the provider: asked again by the ticket, stopped again
    await until(() => getRun(db, runId)!.state === 'stopped');
    expect(getRun(db, runId)).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
    known = true;
    queueAgain();
    await until(() => getRun(db, runId)!.state !== 'queued' && getRun(db, runId)!.state !== 'running');
    expect(getRun(db, runId)).toMatchObject({ state: 'done', sent: { ...ZERO, clips: 2, clipSeconds: 12 } });
    expect(b.calls.filter((call) => call.startsWith('replace'))).toEqual([]);
    expect(accepted()).toEqual(['p01.mp4', 'p02.mp4']);
  }, SLOW);
});
