import type { DatabaseSync } from 'node:sqlite';

/** Written at the end of the `error` of an `unknown` row that no ticket belongs to: the units its POST consumed (`produce/paid.ts`). */
export const UNITS_TAG = /\[units:(\d+)\]$/;
export const unitsTag = (units: number): string => `[units:${units}]`;

export interface Settled { keys: string[]; refunded: number }
/** Gives units back to a budget (`refundProvider` bound to the database and the caps); null when no budget is kept. Handed in so that this file has no import of its own (the site compiles it without `.ts` extensions). */
export type Refund = (budgetKey: string, units: number, at: Date) => void;

/**
 * The one way out of `submission-unknown` (task T2, R3). The operator has looked at the provider's task list and found no task for
 * the request: it never reached the provider. Each `unknown` row of the run (or of `keys`) becomes `failed`, so a resume sends it as a
 * new attempt; the row's `error` says who did it and when (the only record: nothing settles by itself, a 502/503/504 may well have
 * created a task, and sending again would pay twice). The units its POST consumed go back like those of a refused POST. The run stays `stopped` (the site's resume continues it); once no unknown row is left its reason reads `engine-error`.
 *
 * Throws, and changes nothing: `by-required`, `not-settleable` (not a stopped produce run with `submission-unknown`), `not-unknown`
 * (no unknown row, or a given key is not one), `has-ticket` (the provider took that request: it is asked for by its ticket, never settled).
 * Pure database work, so the site can call it too; it takes its own transaction.
 */
export function settleUnknown(db: DatabaseSync, refund: Refund | null, input: { runId: string; by: string; at: Date; keys?: string[] }): Settled {
  const by = input.by.trim();
  if (by === '') throw new Error('by-required');
  db.exec('BEGIN IMMEDIATE');
  try {
    const run = db.prepare('SELECT kind, ref, state, reason FROM runs WHERE id = ?').get(input.runId) as { kind: string; ref: string; state: string; reason: string | null } | undefined;
    if (!run || run.kind !== 'produce' || run.state !== 'stopped' || run.reason !== 'submission-unknown') throw new Error('not-settleable');
    const unknown = db.prepare("SELECT key, external_id AS ticket, error, created_at AS at FROM operations WHERE run_id = ? AND state = 'unknown' ORDER BY key")
      .all(input.runId) as { key: string; ticket: string | null; error: string | null; at: string }[];
    const chosen = [...new Set(input.keys ?? unknown.map((row) => row.key))];   // a key named twice is settled and refunded once
    const rows = chosen.map((key) => unknown.find((row) => row.key === key));
    if (rows.length === 0 || rows.some((row) => row === undefined)) throw new Error('not-unknown');
    const settling = rows as typeof unknown;
    if (settling.some((row) => row.ticket !== null)) throw new Error('has-ticket');
    const t = input.at.toISOString();
    let refunded = 0;
    for (const row of settling) {
      const note = `settled by ${by} at ${t}: the operator confirmed the request did not reach the provider${row.error ? ` (it said: ${row.error.replace(UNITS_TAG, '').trim()})` : ''}`;
      db.prepare("UPDATE operations SET state = 'failed', error = ?, updated_at = ? WHERE run_id = ? AND key = ? AND state = 'unknown'").run(note, t, input.runId, row.key);
      const units = Number(UNITS_TAG.exec(row.error ?? '')?.[1]);
      if (Number.isSafeInteger(units) && units > 0) { refund?.(run.ref, units, new Date(row.at)); refunded += refund ? units : 0; }
    }
    // nothing unknown is left: the run is still stopped, but no longer for that reason (the site shows a generic stop and a resume continues it)
    if (db.prepare("SELECT 1 FROM operations WHERE run_id = ? AND state = 'unknown'").get(input.runId) === undefined) {
      db.prepare("UPDATE runs SET reason = 'engine-error', detail = NULL, updated_at = ? WHERE id = ? AND state = 'stopped'").run(t, input.runId);
    }
    db.exec('COMMIT');
    return { keys: settling.map((row) => row.key), refunded };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
