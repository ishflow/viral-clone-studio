// The worker's handler of a person-swap run (a `produce` row whose input carries `swap`): the people of the template's own
// video are replaced by the people of the customer's photographs, part by part, and the parts are joined under the source's sound
// and the AI label. This file is the order of things. The money rules are the ones of every produce run: one request is
// produce/paid.ts, what a resume pays for is produce/missing.ts; the checks before the first request and of what came back are here
// and in check.ts. A video is delivered whole or not at all: a part that is missing is never filled with the source's picture.
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { MediaError } from '../adapters/media.ts';
import type { PartFitter, PartShape } from '../adapters/splice.ts';
import type { Paid, Quality, RunResult, StopReason, VariantState } from '../contracts.ts';
import { endOperation, getRun, holds } from '../db/runs.ts';
import type { FailureCode, RunRow } from '../db/runs.ts';
import { abs, rel } from '../paths.ts';
import type { Clock, Measure, Media, PersonSwapper, Splicer, Tier } from '../ports.ts';
import type { PaidGate } from '../produce/deps.ts';
import { halt } from '../produce/gather.ts';
import type { Stopping } from '../produce/gather.ts';
import { finishedOf, missingOf, unsentOf } from '../produce/missing.ts';
import { paid } from '../produce/paid.ts';
import type { PaidContext } from '../produce/paid.ts';
import { countOf } from '../produce/plan.ts';
import { createPool } from '../produce/pool.ts';
import type { Pool } from '../produce/pool.ts';
import { plus, within } from '../produce/preflight.ts';
import { attemptOf, countRows, finishRun, firstKey, operationsOf, ownSent, ownVariants, stopWith } from '../produce/rows.ts';
import { createBoard } from '../produce/steps.ts';
import { releaseTerminal, releaseUnspent } from '../robust/provider-budget.ts';
import { SwapPeople } from '../template/swap-schema.ts';
import { checkPart, finishedFault } from './check.ts';
import { loadSwap, needsOf, partOf, planOf, sourceOf } from './plan.ts';

export interface SwapDeps {
  db: DatabaseSync;
  swapper: PersonSwapper;
  splicer: Splicer & PartFitter;
  media: Media;
  measure: Measure;
  clock: Clock;
  tiers: Record<Quality, Tier>;          // what the swapper is asked for, by the quality of the run: the provider's own models
  paidGate?: PaidGate;                    // the gate all runs of the worker share; without it, a run's own pool of 3 is the only limit
  label?: string;                         // the picture drawn over every frame; without it, ./ai-label.png
}

/** The picture that says the video was made by AI. */
export const AI_LABEL = fileURLToPath(new URL('./ai-label.png', import.meta.url));
/** Paid requests in flight at one time for one run. */
const POOL = 3;
const ZERO: Paid = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };
const NONE = { total: 0, done: 0 };
const NOTHING: RunResult = { kind: 'produce', variants: [] };

/** The run's own pool of 3 behind the gate all runs of the worker share: the same order of waits as a product video's requests (produce/index.ts). */
function poolBehind(gate: PaidGate | undefined): Pool {
  const own = createPool(POOL);
  if (gate === undefined) return own;
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        own.run(() => gate(() => Promise.resolve().then(task).then(resolve, reject))).catch(reject);
      });
    },
  };
}

/** jobs/<runId>/stop.json, for the admin: why the run stopped. Written after the stop is recorded; a failure to write it costs the run nothing. */
function writeStop(runId: string, reason: StopReason, detail: string, at: Date): void {
  try {
    const file = abs(rel('jobs', runId, 'stop.json'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ reason, detail, at: at.toISOString() }, null, 1));
  } catch { /* the stop itself is in the database */ }
}

/** A photograph the run was given that is not a picture the tools can read, as a line for the admin; null when all are. A tool that does not run is thrown on. */
async function unreadablePhotograph(media: Media, files: string[]): Promise<string | null> {
  for (const file of files) {
    try {
      const facts = await media.probe(abs(file));
      if (!(facts.width > 0 && facts.height > 0)) return `${file} is not a picture with a width and a height`;
    } catch (error) {
      if (error instanceof MediaError && error.code !== 'tool-failed') return `${file} cannot be read as a picture: ${error.message}`;
      throw error;
    }
  }
  return null;
}

export function swapHandler(deps: SwapDeps): (run: RunRow) => Promise<void> {
  const { db, clock, media, measure, splicer } = deps;

  return async (claimed) => {
    const run = getRun(db, claimed.id);
    // a finished run is not touched, and neither is one that another worker has taken over since the claim
    if (run === null || run.state !== 'running' || run.claimedBy !== claimed.claimedBy || run.input.kind !== 'produce' || run.input.swap === undefined) return;
    const input = run.input, runId = run.id, claimedBy = run.claimedBy;
    const stopping: Stopping = { reason: null, detail: null };
    const lost = () => halt(stopping, 'engine-error', 'the run is not running for this worker any more');
    const waiting: VariantState = { n: 1, status: 'waiting', video: null, image: null, reason: null };

    const swap = loadSwap(input.templateId);
    if (swap === null) {
      ownVariants(db, runId, claimedBy, [{ ...waiting, status: 'stopped', reason: 'template-missing' }], clock.now());
      if (stopWith(db, runId, claimedBy, 'template-missing', null, NOTHING, clock.now())) {
        writeStop(runId, 'template-missing', `templates/${input.templateId}/swap.json is not there or is not a person-swap template`, clock.now());
        releaseUnspent(db, run.ref);
      }
      return;
    }

    const needs = needsOf(swap, runId);
    // the seconds a part's row bills, by the exact key of its first attempt
    const seconds = new Map(needs.map((need) => [need.key, need.seconds]));
    const billed = (key: string): number => seconds.get(firstKey(key)) ?? 0;
    const total = countOf(needs);
    const board = createBoard({ db, runId, clock, claimedBy, lost }, {
      adaptation: NONE, images: NONE, music: NONE,
      clips: { total: needs.length, done: finishedOf(db, runId, needs).length },
      edit: { total: 1, done: 0 }, render: { total: 1, done: 0 },
    }, [waiting]);

    /** Stops the run: nothing is delivered, and `missing` is what a resume has to approve (the parts that still have to be sent). */
    const stopRun = (reason: StopReason, detail: string, code: FailureCode | null = null): void => {
      board.close(reason);
      const missing = missingOf(db, runId, needs, run.approved, getRun(db, runId)?.sent ?? ZERO);
      if (stopWith(db, runId, claimedBy, reason, missing, NOTHING, clock.now(), code)) {
        writeStop(runId, reason, detail, clock.now());
        releaseUnspent(db, run.ref);
      }
    };

    try {
      // ── rows an earlier call left behind: what stops the run at once ──
      const rows = operationsOf(db, runId);
      if (rows.length > 0) {
        // `sent` follows the rows: a worker that died between storing a ticket and counting it left `sent` short
        const accepted = countRows(rows, billed, 'accepted');
        if (JSON.stringify(accepted) !== JSON.stringify({ ...ZERO, ...run.sent }) && !ownSent(db, runId, claimedBy, accepted, clock.now())) lost();
      }
      if (rows.some((row) => row.state === 'unknown' && row.externalId === null)) return stopRun('submission-unknown', 'a request of this run may or may not exist at the provider: it is settled by hand, never sent again');
      const orphaned: string[] = [], vanished: string[] = [];
      for (const need of needs) {
        const { key, row } = attemptOf(db, runId, need.key);
        if (row?.state === 'pending' && row.externalId === null) {
          endOperation(db, runId, key, { state: 'unknown', error: 'the worker stopped before the provider answered: the request may exist' }, clock.now());
          console.error(`produce-unknown: run ${runId} ${key} worker-stopped no-ticket`);   // the line the operator who settles it by hand looks for (produce/paid.ts)
          orphaned.push(key);
        } else if (row?.state === 'done' && (row.output === null || !existsSync(abs(row.output)))) vanished.push(key);
      }
      if (orphaned.length > 0) return stopRun('submission-unknown', `no answer was recorded for ${orphaned.join(', ')}: the request may exist`);
      if (vanished.length > 0) return stopRun('engine-error', `the paid file of ${vanished.join(', ')} is gone: it is not paid for again`);

      // ── the count: what the rows have used of the approval and what is sent now, together inside it ──
      const after = plus(countRows(rows, billed, 'spent'), countOf(unsentOf(db, runId, needs)));
      if (!within(total, run.approved) || !within(after, run.approved)) {
        return stopRun('estimate-exceeded', `the run needs ${JSON.stringify(total)}; with what was sent before it comes to ${JSON.stringify(after)}; approved: ${JSON.stringify(run.approved)}`);
      }

      // ── the people: a photograph under uploads/ for every person of the template, each one read before anything is paid ──
      const given = SwapPeople.safeParse(input.swap);
      if (!given.success) return stopRun('engine-error', `the photographs of the run are not what a person swap takes: ${given.error.issues[0]?.message ?? ''}`);
      const { people, outfit } = given.data;
      if (people.length !== swap.persons.length) return stopRun('engine-error', `the template has ${swap.persons.length} people, the run has photographs for ${people.length}`);
      const unreadable = await unreadablePhotograph(media, people.flatMap((person) => [person.body, ...(person.face === null ? [] : [person.face]), ...(person.side === undefined ? [] : [person.side])]));
      if (unreadable !== null) return stopRun('images-failed', unreadable);

      // ── the template's own files: its video and the parts of it, which together are every frame of it ──
      const sourceFile = abs(sourceOf(input.templateId));
      const parts = swap.parts.map((part) => abs(partOf(input.templateId, part.n)));
      const lacking = [sourceFile, ...parts].find((file) => !existsSync(file));
      if (lacking !== undefined) return stopRun('template-missing', `${lacking} is not there`);
      const source = await media.probe(sourceFile);
      const shapes: PartShape[] = [];
      for (const part of parts) shapes.push(await media.probe(part));
      const framesOfParts = shapes.reduce((sum, shape) => sum + shape.frames, 0);
      if (framesOfParts !== source.frames) return stopRun('template-missing', `the parts of the template have ${framesOfParts} frames, its video ${source.frames}`);
      if (swap.sound && !source.audio) return stopRun('template-missing', 'the template says its video has sound, and it has none');

      // ── the requests: the provider's own rules, asked for every part that is sent now ──
      const items = planOf(swap, input.templateId, people, runId, deps.tiers[input.quality], outfit);
      const sending = new Set(unsentOf(db, runId, needs).map((need) => need.key));
      for (const item of items) {
        const refused = sending.has(item.key) ? deps.swapper.refusal(item.paid.request) : null;
        if (refused !== null) return stopRun('engine-error', `${item.key}: ${refused}`);
      }

      // ── the paid requests, three at a time. Whatever happens, what is in flight has finished before the run goes on or stops. ──
      const context: PaidContext = { db, swapper: deps.swapper, clock, runId, claimedBy, lost, approved: run.approved, billed };
      const pool = poolBehind(deps.paidGate);
      let failed: StopReason | null = null;
      board.variant(1, { status: 'running', reason: null });
      board.begin('clips', items.length);
      const files = await Promise.all(items.map((item) => pool.run(async (): Promise<string | null> => {
        try {
          // asked when its turn comes: nothing new starts once a part has failed or the run is stopping
          const outcome = stopping.reason !== null || failed !== null ? null : await paid(context, item);
          if (outcome?.ok) { board.end('clips', outcome.fresh); return outcome.file; }
          if (outcome !== null) {
            if (outcome.whole) halt(stopping, outcome.reason, `${item.key} stopped the run`, outcome.code);
            failed ??= outcome.reason;
            board.stopIn('clips');
          }
          board.end('clips', false);
        } catch (error) {
          halt(stopping, 'engine-error', `${item.key}: ${error instanceof Error ? error.message : String(error)}`);
        }
        return null;
      })));
      if (stopping.reason !== null) return stopRun(stopping.reason, stopping.detail ?? 'a request stopped the run', stopping.code ?? null);
      if (failed !== null) return stopRun(failed, 'a part could not be made');

      // ── every part against the part of the source it was made from; one that differs a little is brought to its shape ──
      board.begin('edit');
      const fitted: string[] = [], faulty: string[] = [];
      for (const [index, item] of items.entries()) {
        const made = abs(files[index]!), shape = shapes[index]!;
        const checked = await checkPart({ media, measure }, made, { file: parts[index]!, shape });
        if ('fault' in checked) {
          // the row is failed (the file stays): a resume makes exactly this part again, under the next key
          endOperation(db, runId, attemptOf(db, runId, item.key).key, { state: 'failed', error: `refused-by-check: ${checked.fault}` }, clock.now());
          board.lose('clips');
          faulty.push(`${item.key}: ${checked.fault}`);
        } else if (checked.fits) fitted.push(made);
        else {
          const to = abs(rel('jobs', runId, 'v1', 'parts', `${item.id}.mp4`));
          await splicer.fit(made, to, { width: shape.width, height: shape.height, fps: shape.fps, frames: shape.frames });
          fitted.push(to);
        }
      }
      if (faulty.length > 0) {
        board.stopIn('edit'); board.end('edit', false);
        return stopRun('clips-failed', faulty.join(' · '));
      }
      board.end('edit', true);

      // ── joined under the source's own sound and the label, checked, and only then given its name ──
      board.begin('render');
      const own = (claimedBy ?? 'none').replace(/[^A-Za-z0-9_-]/g, '');     // each worker has temporary names of its own
      const dir = rel('jobs', runId, 'v1');
      const video = rel(dir, 'final.mp4'), image = rel(dir, 'poster.jpg');
      const joinedAt = abs(rel(dir, `render.part-${own}.mp4`)), stillAt = abs(rel(dir, `poster.part-${own}.jpg`));
      const label = deps.label ?? AI_LABEL;
      const joined = await splicer.join(fitted, swap.sound ? sourceFile : null, label, joinedAt);
      const fault = await finishedFault(measure, joinedAt, joined, { frames: source.frames, sound: swap.sound, label });
      if (fault !== null) {
        board.stopIn('render'); board.end('render', false);
        return stopRun('render-failed', `the joined video is not delivered: ${fault}`);
      }
      await media.still(joinedAt, joined.seconds / 2, stillAt);
      // only the worker that still holds the run gives the files their names
      if (!holds(db, runId, claimedBy)) return stopRun('engine-error', 'the run is not running for this worker any more');
      renameSync(joinedAt, abs(video));
      renameSync(stillAt, abs(image));
      board.end('render', true);
      board.variant(1, { status: 'done', video, image, reason: null });
      if (stopping.reason !== null) return stopRun(stopping.reason, stopping.detail ?? 'the run stopped');
      if (finishRun(db, runId, claimedBy, { kind: 'produce', variants: [{ video, image }] }, clock.now())) releaseTerminal(db);
    } catch (error) {
      stopRun('engine-error', error instanceof Error ? error.message : String(error));
    }
  };
}
