// The only place that calls the generator's paid methods (and `resume`). The "Paid counting" rule, per request:
// the row is written (`pending`) → the request is sent → the acceptance stores the ticket and counts the request in
// `sent` → the file path and `done`. A request is never sent when its key has a row that is not `failed`.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Paid, StopReason } from '../contracts.ts';
import { addSent, beginOwnOperation, endOperation, operation } from '../db/runs.ts';
import type { FailureCode } from '../db/runs.ts';
import { abs } from '../paths.ts';
import { creditsHold, holdCredits, liftCredits } from '../robust/provider-credits.ts';
import { unitsTag } from '../robust/settle-unknown.ts';
import { GeneratorError } from '../ports.ts';
import type { Clock, Generated, Generator, OnSubmitted, PaidRequest, PersonSwapper, SwapPaid } from '../ports.ts';
import { named } from './filetype.ts';
import type { Kind, Planned } from './plan.ts';
import { attemptOf, countRows, operationsOf } from './rows.ts';

/** A request of a plan as `paid` takes it: one of a product video, or a part of a person-swap video (a `clip` row; swap/plan.ts). */
export type PaidItem = Omit<Planned, 'paid'> & { paid: PaidRequest | SwapPaid };

export interface PaidContext {
  db: DatabaseSync;
  generator?: Generator;                    // who is asked for the requests of a product video
  swapper?: PersonSwapper;                  // who is asked for the parts of a person-swap video
  clock: Clock;
  runId: string;
  claimedBy: string | null;                 // the worker this call of the handler runs for: a request is sent only while the run is running and claimed by it
  lost: () => void;                         // called when the run turns out not to be running for this worker any more
  approved: Paid | null;                    // what the customer has confirmed so far
  billed: (key: string) => number;          // the seconds a clip row of this run bills, by its key
  retried?: boolean;                        // the run stopped because the provider had no credits and is tried again: its requests are sent while the hold stands, and the first one accepted lifts it
}

/**
 * `fresh`: the file was made in this call (false: a `done` row was reused).
 * `whole`: the whole run stops (a refusal or a missing key will hit every request; an unknown submission must not be
 * followed by more), otherwise only the variant of the request.
 */
export type PaidOutcome = { ok: true; file: string; fresh: boolean } | { ok: false; whole: boolean; reason: StopReason; code?: FailureCode };

const FAILED: Record<Kind, StopReason> = { image: 'images-failed', clip: 'clips-failed', music: 'audio-failed', voice: 'audio-failed' };
const countOf = (item: Pick<Planned, 'kind' | 'seconds'>): Partial<Paid> =>
  item.kind === 'image' ? { images: 1 } : item.kind === 'clip' ? { clips: 1, clipSeconds: item.seconds } : item.kind === 'music' ? { music: 1 } : { voice: 1 };

/**
 * What a person-swap provider refuses for good, whatever is sent again: the photograph, or a video it finds no person in.
 * Its adapter says so with the code as the error's only word (`rejected` at the submit, `task-failed` after it).
 */
const SWAP_REFUSALS: readonly FailureCode[] = ['photo-refused', 'person-missing'];
function swapRefusal(item: PaidItem, error: unknown): FailureCode | undefined {
  return item.paid.kind === 'swap' && error instanceof GeneratorError ? SWAP_REFUSALS.find((code) => code === error.message) : undefined;
}

/** The allowlisted code of a refusal that stops the run: never the provider's text. */
function refusalCode(item: PaidItem, error: unknown): FailureCode | undefined {
  if (!(error instanceof GeneratorError)) return undefined;
  if (error.code === 'rejected') return swapRefusal(item, error) ?? (error.status === 402 ? 'provider-credits' : error.message === 'provider-cap' ? 'provider-cap' : 'provider-refused');
  if (error.code === 'not-configured') return 'provider-setup';
  if (error.code === 'upload-failed') return 'upload-failed';
  return undefined;
}

/**
 * Why an answer was unknown, in one word for the worker's log: the HTTP status when the adapter named one, otherwise the error's code.
 * Never the adapter's words: they name the address and may quote the request.
 */
function unknownCause(code: string | null, said: string): string {
  const status = /\bHTTP (\d{3})\b/.exec(said)?.[1];
  return status !== undefined ? `http-${status}` : code ?? 'no-code';
}

/** Is one more request of this kind inside the approval? What counts against it: `countRows(…, 'spent')`. */
function approvedFor(ctx: PaidContext, item: PaidItem): boolean {
  if (ctx.approved === null) return false;
  const spent = countRows(operationsOf(ctx.db, ctx.runId), ctx.billed, 'spent');
  const field = ({ image: 'images', clip: 'clips', music: 'music', voice: 'voice' } as const)[item.kind];
  if (spent[field] + 1 > ctx.approved[field]) return false;
  return item.kind !== 'clip' || spent.clipSeconds + item.seconds <= ctx.approved.clipSeconds;
}

/** The provider a request needs. A run that was not given it sends nothing: the request is refused as one without a key is. */
function need<T>(provider: T | undefined): T {
  if (provider === undefined) throw new GeneratorError('not-configured', 'the run has no provider for this request');
  return provider;
}

function send(ctx: PaidContext, paid: PaidItem['paid'], to: string, onSubmitted: OnSubmitted): Promise<Generated> {
  if (paid.kind === 'swap') return need(ctx.swapper).replace(paid.request, to, onSubmitted);
  const generator = need(ctx.generator);
  switch (paid.kind) {
    case 'image': return generator.image(paid.request, to, onSubmitted);
    case 'clip': return generator.clip(paid.request, to, onSubmitted);
    case 'music': return generator.music(paid.request, to, onSubmitted);
    case 'voice': return generator.voice(paid.request, to, onSubmitted);
  }
}

/** The file of one request of the plan: reused, asked for again, or paid for. Never throws for what the generator answers. */
export async function paid(ctx: PaidContext, item: PaidItem): Promise<PaidOutcome> {
  const { db, clock, runId } = ctx;
  const { key, row } = attemptOf(db, runId, item.key);
  const unknown: PaidOutcome = { ok: false, whole: true, reason: 'submission-unknown' };

  if (row?.state === 'done') {
    // a paid file that vanished is not silently paid for again
    return row.output !== null && existsSync(abs(row.output)) ? { ok: true, file: row.output, fresh: false } : { ok: false, whole: true, reason: 'engine-error' };
  }
  if (row?.state === 'unknown' && row.externalId === null) return unknown;   // with a ticket the provider took it: it is asked for by the ticket below (a GET), never settled, never sent again
  if (row !== null && row.externalId === null) {
    // a worker died between writing the row and hearing the acceptance: the request may exist
    endOperation(db, runId, key, { state: 'unknown', error: 'the worker stopped before the provider answered: the request may exist' }, clock.now());
    return unknown;
  }

  const to = abs(item.file);
  mkdirSync(dirname(to), { recursive: true });
  const resumed = row !== null;
  let counted = resumed;                                            // a request asked for again was counted when it was sent
  try {
    if (row !== null) await (item.paid.kind === 'swap' ? need(ctx.swapper) : need(ctx.generator)).resume(row.externalId!, to);
    else {
      if (!approvedFor(ctx, item)) return { ok: false, whole: true, reason: 'estimate-exceeded' };
      // the provider has no credits left: nothing written, nothing sent. Asked here, at the request's turn, so every run of the worker gets the same answer.
      // The hold is the generator's: a part of a person swap goes to another provider, so it neither waits for the hold nor lifts or sets it
      const held = item.paid.kind === 'swap' ? null : creditsHold(db);
      if (held !== null && !ctx.retried) return { ok: false, whole: true, reason: 'engine-error', code: 'provider-credits' };
      // one transaction: the run is still running and this worker's, then the row. From here on the key is taken.
      const begun = beginOwnOperation(db, runId, key, item.kind, ctx.claimedBy, clock.now());
      if (begun === null) { ctx.lost(); return { ok: false, whole: true, reason: 'engine-error' }; }       // nothing written, nothing sent
      if (!begun.created) return { ok: false, whole: true, reason: 'engine-error' };                       // a row another worker wrote in this instant is its request, not ours
      await send(ctx, item.paid, to, (ticket) => {
        endOperation(db, runId, key, { externalId: ticket }, clock.now());
        const running = addSent(db, runId, countOf(item), clock.now());
        counted = true;
        if (!running) ctx.lost();                                                                          // the run is not running any more: `sent` is put right from the rows by the next call
        // only the hold this request was sent under: one that was on its way before a refusal lifts nothing. A hold that cannot be lifted stands, and never costs the accepted request its ticket
        try { if (liftCredits(db, held)) console.error(`provider-credits: run ${runId} ${key} was accepted, the hold is lifted`); } catch { /* the next accepted request of a retried run lifts it */ }
      });
    }
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    const stored = operation(db, runId, key)?.externalId ?? null;
    const code = error instanceof GeneratorError ? error.code : null;
    const ticket = error instanceof GeneratorError ? error.ticket : null;
    if (code === 'submission-unknown' || (code === null && stored === null)) {
      // with a ticket the provider accepted it: the ticket goes into `error` and into its own place, so the rows say what was accepted
      // no ticket: the POST consumed units that `settleUnknown` can give back if the operator finds that it never reached the provider
      const units = item.paid.kind === 'clip' ? item.paid.request.seconds : item.paid.kind === 'swap' ? item.seconds : 1;   // a part of a person swap: the whole seconds it bills
      endOperation(db, runId, key, { state: 'unknown', error: ticket ?? (code === 'submission-unknown' ? `${said} ${unitsTag(units)}` : said), ...(ticket !== null ? { externalId: ticket } : {}) }, clock.now());
      if (ticket !== null && !counted && !addSent(db, runId, countOf(item), clock.now())) ctx.lost();
      // the one trace outside the database: the operator who has to settle it by hand finds the run and the request in the worker's log
      console.error(`produce-unknown: run ${runId} ${key} ${unknownCause(code, said)} ${ticket !== null ? 'ticket' : 'no-ticket'}`);
      return unknown;
    }
    if (code === 'task-failed' || code === 'empty-result') {
      endOperation(db, runId, key, { state: 'failed', error: said }, clock.now());
      const refused = swapRefusal(item, error);
      // the same photograph, the same video: every other part would be refused too, and so would this one sent again
      return refused !== undefined ? { ok: false, whole: true, reason: 'engine-error', code: refused } : { ok: false, whole: false, reason: FAILED[item.kind] };
    }
    if (code === 'timeout' || code === 'download-failed') {
      // the task lives on: the ticket stays, a later run asks for it again
      endOperation(db, runId, key, { error: said, ...(stored === null && ticket !== null ? { externalId: ticket } : {}) }, clock.now());
      return { ok: false, whole: false, reason: FAILED[item.kind] };
    }
    // rejected, upload-failed, not-configured: nothing was started, unless this was a question about a task that exists.
    // Anything else after an acceptance: the ticket is kept.
    const nothingStarted = code !== null && !resumed && stored === null;
    endOperation(db, runId, key, nothingStarted ? { state: 'failed', error: said } : { error: said }, clock.now());
    const refusal = refusalCode(item, error);
    if (refusal === 'provider-credits' && item.paid.kind !== 'swap') {
      // a hold that cannot be written costs the run nothing: it stops for the refusal as it always did
      try { holdCredits(db, runId, key, clock.now()); console.error(`provider-credits: run ${runId} ${key} was refused, no new paid request is sent`); }
      catch { console.error(`provider-credits: run ${runId} ${key} was refused, and the hold could not be written`); }
    }
    return { ok: false, whole: true, reason: 'engine-error', code: refusal };
  }
  // the file is named by what it is; one that is nothing this kind may be is an empty result: paid, and of no use
  const arrived = named(item.kind, item.file);
  if (!arrived.ok) {
    endOperation(db, runId, key, { state: 'failed', error: arrived.why }, clock.now());
    return { ok: false, whole: false, reason: FAILED[item.kind] };
  }
  endOperation(db, runId, key, { state: 'done', output: arrived.file, error: null }, clock.now());
  return { ok: true, file: arrived.file, fresh: true };
}
