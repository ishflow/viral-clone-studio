// What a resume of stopped variants would have to approve.
import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { Paid } from '../contracts.ts';
import { abs } from '../paths.ts';
import { countOf } from './plan.ts';
import type { Need } from './plan.ts';
import { attemptOf, operationsOf } from './rows.ts';

const ZERO: Paid = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };
const FIELDS = ['images', 'clips', 'clipSeconds', 'music', 'voice'] as const;

/** The needs whose file is paid for and on the disk: a `done` row and its file. */
export function finishedOf(db: DatabaseSync, runId: string, needs: Need[]): Need[] {
  return needs.filter((need) => {
    const { row } = attemptOf(db, runId, need.key);
    return row?.state === 'done' && row.output !== null && existsSync(abs(row.output));
  });
}

/**
 * The needs that still have to be SENT: never sent, or every attempt so far failed (the next one is a new request).
 * Not a `done` row (also when its file is gone: it is never paid for again without a hand), not a `pending` one
 * (in flight, or asked for again by its ticket, free), not an `unknown` one (never sent again).
 */
export function unsentOf(db: DatabaseSync, runId: string, needs: Need[]): Need[] {
  return needs.filter((need) => attemptOf(db, runId, need.key).row === null);
}

/**
 * Per field: max(0, toSend − (approved − sent)), where `toSend` is what `needs` (the stopped variants') still have to
 * be sent. What was approved and never sent is not asked for again; once a resume approves `missing`,
 * approved ≥ sent + toSend holds exactly. All zero for a run with an `unknown` row: approving more cannot continue it.
 */
export function missingOf(db: DatabaseSync, runId: string, needs: Need[], approved: Paid | null, sent: Paid): Paid {
  if (operationsOf(db, runId).some((row) => row.state === 'unknown')) return { ...ZERO };
  const toSend = countOf(unsentOf(db, runId, needs));
  const room = approved ?? ZERO;
  return Object.fromEntries(FIELDS.map((field) => [field, Math.max(0, toSend[field] - (room[field] - sent[field]))])) as unknown as Paid;
}
