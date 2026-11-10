// What produce reads and writes in the database beyond db/runs.ts: every operation of a run, the attempt of a
// request that counts, and the writes only the worker that holds the run may make (its steps, its variants, its end).
// One statement each. A write of a run answers false, and changes nothing, when the run is not `running` or is
// claimed by another worker: the caller has lost the run and stops.
import type { DatabaseSync } from 'node:sqlite';
import type { Paid, RunResult, Step, StopReason, VariantState } from '../contracts.ts';
import { operation } from '../db/runs.ts';
import type { FailureCode, OperationRow } from '../db/runs.ts';

export type Row = Pick<OperationRow, 'key' | 'kind' | 'state' | 'externalId'>;

/** Every operation of a run: its key, kind, state and ticket. */
export function operationsOf(db: DatabaseSync, runId: string): Row[] {
  return db.prepare('SELECT key, kind, state, external_id AS externalId FROM operations WHERE run_id = ? ORDER BY key').all(runId) as unknown as Row[];
}

/**
 * The rows of a run as paid numbers; `billed` gives the seconds of a clip row by its key.
 * - `accepted`: the provider took the request (the row has a ticket), whatever became of it: what `runs.sent` must say.
 * - `spent`: what counts against the approval: every row but a `failed` one without a ticket (refused before anything
 *   was started). A `pending` row without a ticket is in flight, an `unknown` one may exist: both count.
 */
export function countRows(rows: Row[], billed: (key: string) => number, which: 'accepted' | 'spent'): Paid {
  const counted = rows.filter((row) => (which === 'accepted' ? row.externalId !== null : !(row.state === 'failed' && row.externalId === null)));
  const of = (kind: Row['kind']) => counted.filter((row) => row.kind === kind);
  return {
    images: of('image').length, clips: of('clip').length, clipSeconds: of('clip').reduce((sum, row) => sum + billed(row.key), 0),
    music: of('music').length, voice: of('voice').length,
  };
}

/**
 * The key a resend after a failed row goes under: 'v1:clip:s1' → 'v1:clip:s1#2' → 'v1:clip:s1#3'.
 * No id holds a '#' (ids are lower-case letters, digits and hyphens), so a shot named r2 is never read as a retry.
 */
export const attemptKey = (key: string, attempt: number): string => (attempt === 1 ? key : `${key}#${attempt}`);
/** The key of the first attempt: the key itself unless it ends in '#<n>'. */
export const firstKey = (key: string): string => key.replace(/#\d+$/, '');

/**
 * The attempt of a request that counts: the first one whose row is not `failed`. `row: null`: it was never sent,
 * or every attempt so far failed, and the next one goes under `key`.
 */
export function attemptOf(db: DatabaseSync, runId: string, key: string): { key: string; row: OperationRow | null } {
  for (let attempt = 1; ; attempt += 1) {
    const row = operation(db, runId, attemptKey(key, attempt));
    if (row === null || row.state !== 'failed') return { key: attemptKey(key, attempt), row };
  }
}

const MINE = `id = ? AND state = 'running' AND claimed_by IS ?`;

export function ownSteps(db: DatabaseSync, id: string, claimedBy: string | null, steps: Step[], now: Date): boolean {
  return db.prepare(`UPDATE runs SET steps = ?, updated_at = ? WHERE ${MINE}`).run(JSON.stringify(steps), now.toISOString(), id, claimedBy).changes > 0;
}

export function ownVariants(db: DatabaseSync, id: string, claimedBy: string | null, variants: VariantState[], now: Date): boolean {
  return db.prepare(`UPDATE runs SET variants = ?, updated_at = ? WHERE ${MINE}`).run(JSON.stringify(variants), now.toISOString(), id, claimedBy).changes > 0;
}

/** Puts `runs.sent` right: what the rows say the provider accepted (`countRows(…, 'accepted')`). */
export function ownSent(db: DatabaseSync, id: string, claimedBy: string | null, sent: Paid, now: Date): boolean {
  return db.prepare(`UPDATE runs SET sent = ?, updated_at = ? WHERE ${MINE}`).run(JSON.stringify(sent), now.toISOString(), id, claimedBy).changes > 0;
}

/** Stops the run and records the variants that are finished: they are delivered although the run stopped. */
export function stopWith(db: DatabaseSync, id: string, claimedBy: string | null, reason: StopReason, missing: Paid | null, result: RunResult, now: Date, detail: FailureCode | null = null): boolean {
  return db.prepare(`UPDATE runs SET state = 'stopped', reason = ?, missing = ?, result = ?, updated_at = ?, detail = ? WHERE ${MINE}`)
    .run(reason, missing ? JSON.stringify(missing) : null, JSON.stringify(result), now.toISOString(), detail, id, claimedBy).changes > 0;
}

/** Ends the run as done. A run that was stopped and resumed loses its old `reason`, `detail` and `missing`: nothing is missing any more. */
export function finishRun(db: DatabaseSync, id: string, claimedBy: string | null, result: RunResult, now: Date): boolean {
  return db.prepare(`UPDATE runs SET state = 'done', result = ?, reason = NULL, detail = NULL, missing = NULL, updated_at = ? WHERE ${MINE}`)
    .run(JSON.stringify(result), now.toISOString(), id, claimedBy).changes > 0;
}
