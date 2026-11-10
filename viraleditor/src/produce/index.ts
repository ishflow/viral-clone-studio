// The worker's handler of a `produce` run: from a confirmed run to finished videos.
// This file is the order of things; the money rules are in paid.ts (one request), gather.ts (all of them),
// preflight.ts (what must hold before the first one) and missing.ts (what a resume pays for).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Paid, RunResult, StopReason, VariantState } from '../contracts.ts';
import { endOperation, getRun } from '../db/runs.ts';
import type { FailureCode, RunRow } from '../db/runs.ts';
import { releaseTerminal, releaseUnspent } from '../robust/provider-budget.ts';
import { creditsHold } from '../robust/provider-credits.ts';
import { readSettings } from '../db/settings.ts';
import { abs, rel } from '../paths.ts';
import type { FillNote } from '../resolve/index.ts';
import { paidFor } from '../template/estimate.ts';
import { Template } from '../template/schema.ts';
import type { TemplateJson } from '../template/schema.ts';
import { adapt, readFills, writeFills } from './adapt.ts';
import { assemble as assembleVariant } from './assemble.ts';
import type { PaidGate, ProduceDeps } from './deps.ts';
import { gather, halt, STEP_OF } from './gather.ts';
import type { Stopping, VariantPlan } from './gather.ts';
import { finishedOf, missingOf, unsentOf } from './missing.ts';
import { paid } from './paid.ts';
import { countOf, needOfFaulty, needsOf, planOf } from './plan.ts';
import type { Need } from './plan.ts';
import { createPool } from './pool.ts';
import type { Pool } from './pool.ts';
import { dryRun, plus, requestProblem, unreadablePhotograph, within } from './preflight.ts';
import { attemptOf, countRows, finishRun, firstKey, operationsOf, ownSent, ownVariants, stopWith } from './rows.ts';
import { writeSample } from './sample.ts';
import { createBoard } from './steps.ts';
import type { Assembled } from './types.ts';

export type { Assemble, AssembleDeps, ProduceDeps } from './deps.ts';

/** Paid requests in flight at one time, over all variants and kinds. */
const POOL = 3;
const ZERO: Paid = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };

/**
 * The run's own pool of 3 and, when the worker has one, behind the gate all its runs share. A request takes its place of the pool
 * first and of the gate last: what gather asks when a request's turn comes (is the run stopping, has its variant stopped) is asked
 * after both waits, and the request's row is written inside the gate, never while it waits. The answer is handed on before the place
 * of the gate is given up, as pool.ts does with its own places: the next in line asks only after the run has heard this answer.
 */
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

function write(file: string, value: unknown): void {
  mkdirSync(dirname(abs(file)), { recursive: true });
  writeFileSync(abs(file), JSON.stringify(value, null, 1));
}

/** jobs/<runId>/stop.json, for the admin: why the run stopped. Written after the stop is recorded; a failure to write it costs the run nothing. */
function writeStop(runId: string, reason: StopReason, detail: string, at: Date): void {
  try { write(rel('jobs', runId, 'stop.json'), { reason, detail, at: at.toISOString() }); } catch { /* the stop itself is in the database */ }
}

/** One more note in jobs/<runId>/notes.json (what the customer or the admin should know of a run that went on). Never throws. */
function addNote(runId: string, note: { code: string; message: string }): void {
  try {
    const file = rel('jobs', runId, 'notes.json');
    const kept: unknown = existsSync(abs(file)) ? JSON.parse(readFileSync(abs(file), 'utf8')) : [];
    write(file, [...(Array.isArray(kept) ? kept : []), note]);
  } catch { /* a note is not worth a run */ }
}

/** templates/<id>/template.json, or null when it is not there or is not a template. */
function loadTemplate(id: string): TemplateJson | null {
  try {
    const file = abs(rel('templates', id, 'template.json'));
    if (!existsSync(file)) return null;
    const parsed = Template.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

const resultOf = (variants: VariantState[]): RunResult => ({
  kind: 'produce',
  variants: variants.filter((variant) => variant.status === 'done').map((variant) => ({ video: variant.video!, image: variant.image! })),
});

export function produceHandler(deps: ProduceDeps): (run: RunRow) => Promise<void> {
  const { db, clock } = deps;
  const { assemble = assembleVariant, sample = writeSample, paidGate, ...parts } = deps;

  return async (claimed) => {
    const run = getRun(db, claimed.id);
    // a finished run is not touched, and neither is one that another worker has taken over since the claim
    if (run === null || run.state !== 'running' || run.claimedBy !== claimed.claimedBy || run.input.kind !== 'produce') return;
    const input = run.input, runId = run.id, claimedBy = run.claimedBy;
    const stopping: Stopping = { reason: null, detail: null };
    const lost = () => halt(stopping, 'engine-error', 'the run is not running for this worker any more');
    const numbers = Array.from({ length: input.variants }, (_, i) => i + 1);
    // a finished variant is kept as it is; every other one starts again from its rows
    const start = numbers.map((n): VariantState => {
      const was = run.variants.find((variant) => variant.n === n);
      return was?.status === 'done' ? was : { n, status: 'waiting', video: null, image: null, reason: null };
    });
    const open = start.filter((variant) => variant.status !== 'done').map((variant) => variant.n);

    const template = loadTemplate(input.templateId);
    if (template === null) {
      const variants = start.map((variant): VariantState => (variant.status === 'done' ? variant : { ...variant, status: 'stopped', reason: 'template-missing' }));
      ownVariants(db, runId, claimedBy, variants, clock.now());
      if (stopWith(db, runId, claimedBy, 'template-missing', null, resultOf(variants), clock.now())) {
        writeStop(runId, 'template-missing', `templates/${input.templateId}/template.json is not there or is not a template`, clock.now());
        releaseUnspent(db, run.ref);
      }
      return;
    }

    const needs = numbers.flatMap((n) => needsOf(template, runId, n));
    // the seconds a clip row bills, by the exact key of its first attempt
    const seconds = new Map(needs.map((need) => [need.key, need.seconds]));
    const billed = (key: string): number => seconds.get(firstKey(key)) ?? 0;
    const openNeeds = needs.filter((need) => open.includes(need.n));
    const total = paidFor(template, input.variants);
    const stored = readFills(runId, input.variants);
    const finished = countOf(finishedOf(db, runId, needs));
    const delivered = input.variants - open.length;
    const board = createBoard({ db, runId, clock, claimedBy, lost }, {
      adaptation: { total: input.variants, done: stored === null ? 0 : input.variants },
      images: { total: total.images, done: finished.images },
      clips: { total: total.clips, done: finished.clips },
      music: { total: total.music + total.voice, done: finished.music + finished.voice },
      edit: { total: input.variants, done: delivered },
      render: { total: input.variants, done: delivered },
    }, start);

    /** Stops the run: every variant that is not done is stopped (one that stopped on its own keeps its reason), `missing` is what a resume of those variants has to approve. */
    const stopRun = (reason: StopReason, detail: string, code: FailureCode | null = null): void => {
      board.close(reason);
      const variants = board.variants();
      const lacking = variants.filter((variant) => variant.status !== 'done').map((variant) => variant.n);
      const missing = missingOf(db, runId, needs.filter((need) => lacking.includes(need.n)), run.approved, getRun(db, runId)?.sent ?? ZERO);
      // the file only for a stop that is this worker's to write, and only after it is written
      if (stopWith(db, runId, claimedBy, reason, missing, resultOf(variants), clock.now(), code)) {
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
      for (const need of openNeeds) {
        const { key, row } = attemptOf(db, runId, need.key);
        if (row?.state === 'pending' && row.externalId === null) {
          endOperation(db, runId, key, { state: 'unknown', error: 'the worker stopped before the provider answered: the request may exist' }, clock.now());
          // the same line an unknown answer leaves in the worker's log (`paid`): the operator who settles it by hand looks for it there
          console.error(`produce-unknown: run ${runId} ${key} worker-stopped no-ticket`);
          orphaned.push(key);
        } else if (row?.state === 'done' && (row.output === null || !existsSync(abs(row.output)))) vanished.push(key);
      }
      if (orphaned.length > 0) return stopRun('submission-unknown', `no answer was recorded for ${orphaned.join(', ')}: the request may exist`);
      if (vanished.length > 0) return stopRun('engine-error', `the paid file of ${vanished.join(', ')} is gone: it is not paid for again`);

      // ── the count, before the model is asked: what the rows have used of the approval and what is sent now, together inside it ──
      const after = plus(countRows(rows, billed, 'spent'), countOf(unsentOf(db, runId, openNeeds)));
      if (!within(total, run.approved) || !within(after, run.approved)) {
        return stopRun('estimate-exceeded', `the run needs ${JSON.stringify(total)}; with what was sent before it comes to ${JSON.stringify(after)}; approved: ${JSON.stringify(run.approved)}`);
      }

      // ── the provider's credits: while it has none, a run that would send a request does not start. One that stopped for exactly
      // that and is tried again is the question to the provider: it goes on, and its first accepted request lifts the hold ──
      const retried = run.detail === 'provider-credits';
      const held = creditsHold(db);
      if (held !== null && !retried && unsentOf(db, runId, openNeeds).length > 0) {
        return stopRun('engine-error', `the provider has had no credits since ${held.at} (run ${held.runId}, ${held.key}): nothing was sent for this run`, 'provider-credits');
      }

      // ── adaptation: one question for all variants, or the fills an earlier call wrote ──
      let fills = stored;
      if (fills === null) {
        if (rows.length > 0) return stopRun('engine-error', 'requests were sent for fills that are no longer on the disk');
        board.begin('adaptation', input.variants);
        const adapted = await adapt(deps.llm, template, input);
        if (!adapted.ok) {
          board.stopIn('adaptation');
          return stopRun('adaptation-failed', adapted.detail, adapted.code);
        }
        fills = adapted.fills;
      }
      const notes: FillNote[] = [];
      for (const n of open) {
        const dry = dryRun(template, fills[n - 1]!);
        if (dry.problems.length > 0) {
          if (stored === null) board.stopIn('adaptation');
          return stopRun('adaptation-failed', `variant ${n}: ${dry.problems.join(' · ')}`, 'fill-invalid');
        }
        for (const note of dry.notes) if (!notes.some((kept) => kept.kind === note.kind && kept.element === note.element)) notes.push(note);
      }
      if (stored === null) {
        // only fills that can become a video are kept: a later call uses them without asking again
        writeFills(runId, fills);
        write(rel('jobs', runId, 'notes.json'), notes);
        board.end('adaptation', true, input.variants);
      }

      // ── the customer's photographs: every one the run uses is read before anything is paid ──
      const unreadable = await unreadablePhotograph(deps.media, template, fills[open[0]! - 1] ?? fills[0]!);
      if (unreadable !== null) {
        board.stopIn('images');
        return stopRun('images-failed', unreadable);
      }

      // ── the requests: the provider's own rules and the files they read ──
      const tier = readSettings(db).tiers[input.quality];
      const plans: VariantPlan[] = open.map((n) => ({ n, fill: fills[n - 1]!, items: planOf(template, fills[n - 1]!, runId, n, tier) }));
      const sending = new Set(unsentOf(db, runId, openNeeds).map((need) => need.key));       // never sent, or every attempt failed: it is sent now
      for (const plan of plans) {
        const problem = requestProblem(deps.generator, plan.items, (item) => sending.has(item.key));
        if (problem !== null) return stopRun('engine-error', problem);
      }

      // ── the paid requests, three at a time ──
      // gather does not reject for a request: whatever happens, what is in flight has finished when it returns
      const context = { db, generator: deps.generator, clock, runId, claimedBy, lost, approved: run.approved, billed, retried };
      const gathered = await gather({ template, runId, plans, pool: poolBehind(paidGate), paid: (item) => paid(context, item), board, stopping });
      if (stopping.reason !== null) return stopRun(stopping.reason, stopping.detail ?? 'a request stopped the run', stopping.code ?? null);

      // ── the picture side: one variant at a time ──
      const said = new Map<number, string>();              // what the picture side said about a variant it stopped
      for (const variant of gathered) {
        if (stopping.reason !== null) break;                                                 // the run was lost meanwhile: no further render
        if (!variant.ok) continue;
        board.begin('edit');
        let rendering = false;
        const onRender = () => {
          if (rendering) return;
          rendering = true;
          board.end('edit', true); board.begin('render');
        };
        let out: Assembled;
        try { out = await assemble({ ...parts, onRender }, run, template, variant.media); } catch (error) {
          out = { ok: false, reason: 'engine-error' };
          said.set(variant.n, error instanceof Error ? error.message : String(error));
        }
        if (!out.ok && out.detail !== undefined) said.set(variant.n, out.detail);
        if (out.ok) {
          onRender();
          board.end('render', true);
          board.variant(variant.n, { status: 'done', video: out.video, image: out.image, reason: null });
        } else {
          const step = rendering ? 'render' : 'edit';
          board.stopIn(step); board.end(step, false);
          board.variant(variant.n, { status: 'stopped', reason: out.reason });
          // a paid file the picture side refuses: its row is failed (the file stays), so a resume makes exactly that one again, under the next key
          for (const faulty of out.faulty ?? []) {
            const need = needOfFaulty(template, needs.filter((each) => each.n === variant.n), faulty);
            const made = need === undefined ? null : attemptOf(db, runId, need.key);
            if (need === undefined || made === null || made.row?.state !== 'done') {
              addNote(runId, { code: 'faulty-unknown', message: `the picture side refused the ${faulty.kind}${faulty.id === undefined ? '' : ` "${faulty.id}"`} of variant ${variant.n}, and the variant has no finished request for it` });
              continue;
            }
            endOperation(db, runId, made.key, { state: 'failed', error: `refused-by-assemble: ${out.detail ?? out.reason}` }, clock.now());
            board.lose(STEP_OF[need.kind]);
          }
        }
      }

      if (stopping.reason !== null) return stopRun(stopping.reason, stopping.detail ?? 'the run stopped');
      const variants = board.variants();

      // ── a sample run: its first variant, finished by this call, becomes the template's own video. Never the run's fate. ──
      const one = variants.find((variant) => variant.n === 1);
      if (input.sample && open.includes(1) && one?.status === 'done') {
        try { sample({ db, clock }, run, { video: one.video!, image: one.image! }); } catch (error) {
          addNote(runId, { code: 'sample-failed', message: error instanceof Error ? error.message : String(error) });
        }
      }

      const first = variants.find((variant) => variant.status !== 'done');
      if (first === undefined) { if (finishRun(db, runId, claimedBy, resultOf(variants), clock.now())) releaseTerminal(db); }
      else {
        const stopped = variants.filter((variant) => variant.status !== 'done');
        stopRun(first.reason ?? 'engine-error', stopped.map((variant) => `variant ${variant.n}: ${variant.reason}${said.has(variant.n) ? ` (${said.get(variant.n)})` : ''}`).join(' · '));
      }
    } catch (error) {
      stopRun('engine-error', error instanceof Error ? error.message : String(error));
    }
  };
}
