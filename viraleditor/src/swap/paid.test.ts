// A part of a person-swap video goes through produce/paid.ts like every paid request: the same rows, the same counting, never sent twice.
import { writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../adapters/fakes.ts';
import type { Paid } from '../contracts.ts';
import { claim, enqueue, getRun, operation } from '../db/runs.ts';
import { abs, rel } from '../paths.ts';
import { GeneratorError } from '../ports.ts';
import type { PersonSwapper } from '../ports.ts';
import { paid } from '../produce/paid.ts';
import type { PaidContext, PaidItem } from '../produce/paid.ts';
import { MEDIA, workspace } from '../produce/testing.ts';
import { creditsHold, holdCredits } from '../robust/provider-credits.ts';

const APPROVED: Paid = { images: 0, clips: 3, clipSeconds: 27, music: 0, voice: 0 };
const KEY = 'v1:clip:p01';

/** A swapper that answers as told. `calls`: every method that was called, in order. */
function scripted(answer: { replace?: (ticket: (id: string) => void) => void; resume?: () => void } = {}): PersonSwapper & { calls: string[] } {
  const calls: string[] = [];
  const file = (to: string) => { writeFileSync(to, MEDIA.clip); return { taskId: 'swap-1', file: to }; };
  return {
    calls,
    refusal: () => null,
    async replace(_request, to, onSubmitted) { calls.push('replace'); if (answer.replace) answer.replace(onSubmitted); else onSubmitted('swap-1'); return file(to); },
    async resume(ticket, to) { calls.push(`resume ${ticket}`); answer.resume?.(); return file(to); },
    ready: async () => ({ ready: true, note: null }),
  };
}

let db: DatabaseSync, clock: FakeClock, runId: string, item: PaidItem;
beforeEach(() => {
  ({ db } = workspace());
  clock = new FakeClock();
  runId = enqueue(db, { kind: 'produce', templateId: 'swap-1', quality: 'fast', variants: 1, language: 'en', products: [], sample: false, swap: { people: [{ slot: 1, body: 'uploads/a/body.jpg', face: null }] } }, 'job-1', APPROVED, clock.now());
  claim(db, 'worker-test', clock.now());
  item = {
    n: 1, key: KEY, kind: 'clip', id: 'p01', seconds: 9, file: rel('jobs', runId, 'paid', 'v1', 'clip-p01.mp4'), needs: [],
    paid: { kind: 'swap', request: { video: '/templates/swap-1/parts/p01.mp4', people: [{ slot: 1, body: '/uploads/a/body.jpg', face: null, hint: 'the woman' }], seconds: 8.4, tier: { model: 'fake-swap', resolution: '720p' }, keepSound: false } },
  };
});
const context = (swapper?: PersonSwapper): PaidContext => ({ db, ...(swapper ? { swapper } : {}), clock, runId, approved: APPROVED, billed: () => 9, claimedBy: 'worker-test', lost: () => {} });
const thrower = (error: Error) => () => { throw error; };

describe('paid: a part of a person-swap video', () => {
  it('is sent to the swapper once: the row first, the ticket on acceptance, counted as a clip of its billed seconds, then the file', async () => {
    const seen: unknown[] = [];
    const swapper = scripted({ replace: (ticket) => { seen.push(operation(db, runId, KEY)?.state); ticket('swap-1'); } });
    const out = await paid(context(swapper), item);
    expect(out).toEqual({ ok: true, file: item.file, fresh: true });
    expect(seen).toEqual(['pending']);
    expect(operation(db, runId, KEY)).toMatchObject({ kind: 'clip', state: 'done', externalId: 'swap-1', output: item.file });
    expect(getRun(db, runId)!.sent).toEqual({ images: 0, clips: 1, clipSeconds: 9, music: 0, voice: 0 });
    expect(await paid(context(swapper), item)).toEqual({ ok: true, file: item.file, fresh: false });
    expect(swapper.calls).toEqual(['replace']);
  });

  it('is asked for again by its ticket, never sent again, when its answer did not arrive in time', async () => {
    const late = scripted({ replace: (ticket) => { ticket('swap-1'); throw new GeneratorError('timeout', 'not finished in time', 'swap-1'); } });
    expect(await paid(context(late), item)).toEqual({ ok: false, whole: false, reason: 'clips-failed' });
    const again = scripted();
    expect(await paid(context(again), item)).toMatchObject({ ok: true, fresh: true });
    expect(again.calls).toEqual(['resume swap-1']);
  });

  it('that fails stops only itself, and the next attempt is a new request under the next key', async () => {
    const failing = scripted({ replace: (ticket) => { ticket('swap-1'); throw new GeneratorError('task-failed', 'the task failed', 'swap-1'); } });
    expect(await paid(context(failing), item)).toEqual({ ok: false, whole: false, reason: 'clips-failed' });
    expect(operation(db, runId, KEY)).toMatchObject({ state: 'failed' });
    const next = scripted();
    await paid(context(next), item);
    expect(next.calls).toEqual(['replace']);
    expect(operation(db, runId, `${KEY}#2`)).toMatchObject({ state: 'done' });
  });

  it('whose answer is unknown stops the run and is never sent again; its row keeps the seconds it may have cost', async () => {
    const silent = scripted({ replace: thrower(new GeneratorError('submission-unknown', 'no answer')) });
    expect(await paid(context(silent), item)).toEqual({ ok: false, whole: true, reason: 'submission-unknown' });
    expect(operation(db, runId, KEY)).toMatchObject({ state: 'unknown', externalId: null, error: expect.stringContaining('9') });
    const next = scripted();
    expect(await paid(context(next), item)).toEqual({ ok: false, whole: true, reason: 'submission-unknown' });
    expect(next.calls).toEqual([]);
  });

  it.each(['photo-refused', 'person-missing'] as const)('the provider refuses for good (%s) stops the whole run under that code, at the submit or after it', async (code) => {
    const atSubmit = scripted({ replace: thrower(new GeneratorError('rejected', code, null, 422)) });
    expect(await paid(context(atSubmit), item)).toEqual({ ok: false, whole: true, reason: 'engine-error', code });
    const later = scripted({ replace: (ticket) => { ticket('swap-2'); throw new GeneratorError('task-failed', code, 'swap-2'); } });
    expect(await paid(context(later), item)).toEqual({ ok: false, whole: true, reason: 'engine-error', code });
    expect(operation(db, runId, `${KEY}#2`)).toMatchObject({ state: 'failed', externalId: 'swap-2' });
  });

  it('is not sent, and nothing is counted, by a run that has no swapper', async () => {
    expect(await paid(context(), item)).toEqual({ ok: false, whole: true, reason: 'engine-error', code: 'provider-setup' });
    expect(operation(db, runId, KEY)).toMatchObject({ state: 'failed', externalId: null });
    expect(getRun(db, runId)!.sent ?? null).toBeNull();
  });

  it('beyond what was approved is not sent', async () => {
    const swapper = scripted();
    expect(await paid({ ...context(swapper), approved: { ...APPROVED, clipSeconds: 8 } }, item)).toEqual({ ok: false, whole: true, reason: 'estimate-exceeded' });
    expect(swapper.calls).toEqual([]);
  });
});

// The hold for credits (robust/provider-credits.ts) is the generator's provider's. A part of a person swap goes to another provider.
describe('paid: a part of a person-swap video and the hold of the provider that has no credits left', () => {
  const HELD = { runId: 'another-run', key: 'v1:image:s1' };
  beforeEach(() => holdCredits(db, HELD.runId, HELD.key, clock.now()));

  it('is sent while the hold stands, and its acceptance does not lift the hold', async () => {
    const swapper = scripted();
    expect(await paid(context(swapper), item)).toEqual({ ok: true, file: item.file, fresh: true });
    expect(swapper.calls).toEqual(['replace']);
    expect(creditsHold(db)).toMatchObject(HELD);
  });

  it('of a run that is tried again does not lift the hold either: only a request of the provider on hold does', async () => {
    const swapper = scripted();
    expect(await paid({ ...context(swapper), retried: true }, item)).toMatchObject({ ok: true });
    expect(swapper.calls).toEqual(['replace']);
    expect(creditsHold(db)).toMatchObject(HELD);
  });

  it('that its own provider refuses with HTTP 402 stops the run and writes no hold, nor replaces the one that stands', async () => {
    const broke = () => scripted({ replace: thrower(new GeneratorError('rejected', 'POST was refused: HTTP 402', null, 402)) });
    expect(await paid(context(broke()), item)).toMatchObject({ ok: false, whole: true, reason: 'engine-error' });
    expect(creditsHold(db)).toMatchObject(HELD);
    db.prepare('DELETE FROM provider_hold').run();
    expect(await paid(context(broke()), item)).toMatchObject({ ok: false, whole: true, reason: 'engine-error' });
    expect(creditsHold(db)).toBeNull();
  });
});
