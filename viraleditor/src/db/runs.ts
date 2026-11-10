import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Paid, PrepareNote, RunInput, RunResult, ScanReason, Step, StopReason, VariantState } from '../contracts.ts';

export interface RunRow {
  id: string;
  kind: RunInput['kind'];
  ref: string;
  state: 'held' | 'queued' | 'running' | 'done' | 'stopped' | 'closed';
  input: RunInput;
  approved: Paid | null;
  sent: Paid | null;
  missing: Paid | null;
  steps: Step[];
  variants: VariantState[];
  result: RunResult | null;
  reason: string | null;
  detail: string | null;
  takeovers: number;
  claimedBy: string | null;
  heartbeat: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OperationRow {
  runId: string;
  key: string;
  kind: 'image' | 'clip' | 'music' | 'voice';
  state: 'pending' | 'done' | 'failed' | 'unknown';
  externalId: string | null;
  output: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

type Raw = Record<string, unknown>;

/** A heartbeat older than this belongs to a dead worker. */
export const STALE_MS = 60_000;
export const MAX_TAKEOVERS = 3;
export const FAIR_WAIT_MS = 300_000;

const json = <T>(v: unknown): T | null => (typeof v === 'string' ? (JSON.parse(v) as T) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const iso = (d: Date) => d.toISOString();
const ZERO: Paid = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };

function toRun(r: Raw): RunRow {
  return {
    id: r.id as string, kind: r.kind as RunRow['kind'], ref: r.ref as string, state: r.state as RunRow['state'],
    input: JSON.parse(r.input as string) as RunInput,
    approved: json<Paid>(r.approved), sent: json<Paid>(r.sent), missing: json<Paid>(r.missing),
    steps: JSON.parse(r.steps as string) as Step[],
    variants: JSON.parse(r.variants as string) as VariantState[],
    result: json<RunResult>(r.result), reason: str(r.reason), detail: str(r.detail), takeovers: Number(r.takeovers ?? 0), claimedBy: str(r.claimed_by), heartbeat: str(r.heartbeat),
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

function toOperation(r: Raw): OperationRow {
  return {
    runId: r.run_id as string, key: r.key as string, kind: r.kind as OperationRow['kind'], state: r.state as OperationRow['state'],
    externalId: str(r.external_id), output: str(r.output), error: str(r.error),
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

/** One BEGIN IMMEDIATE transaction. */
function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getRun(db: DatabaseSync, id: string): RunRow | null {
  const r = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
  return r ? toRun(r) : null;
}

/**
 * SQL: the customer a produce run of table `t` is of (`input.ownerId`); the runs written before there was one are one customer,
 * and so is a run whose JSON cannot be read (it must not break the claim of the others).
 */
const customerOf = (t: string) => `COALESCE(CASE WHEN json_valid(${t}.input) THEN json_extract(${t}.input, '$.ownerId') END, '')`;

/** SQL: whether a run of table `t` is batch work: a scan, or the preparation a scan asked for (no `ownerId`). Nobody waits for it; everything else is for a customer or the staff. */
const batchWork = (t: string) => `(${t}.kind = 'scan' OR (${t}.kind = 'prepare' AND CASE WHEN json_valid(${t}.input) THEN json_extract(${t}.input, '$.ownerId') IS NULL ELSE 0 END))`;

/** `now` is for the timestamps; callers with a Clock pass `clock.now()`. */
export function enqueue(db: DatabaseSync, input: RunInput, ref: string, approved: Paid | null, now: Date): string {
  const id = randomUUID();
  const t = iso(now);
  db.prepare(
    `INSERT INTO runs (id, kind, ref, state, input, approved, steps, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?, '[]', ?, ?)`,
  ).run(id, input.kind, ref, JSON.stringify(input), approved ? JSON.stringify(approved) : null, t, t);
  return id;
}

/**
 * Claims one run: the oldest `queued` one, or a `running` one whose heartbeat is older than 60 s (takeover).
 * Work somebody waits for (a video, a customer's own preparation, an edit) goes before batch work (a scan and the preparations it asked for), so a
 * long batch queue never holds a customer back; work of its own kind that has waited five minutes goes first. Batch work is not left waiting forever:
 * a batch job that has waited five minutes goes first, but once per five minutes of the batch having been idle. Three stale-owner takeovers are allowed;
 * the next one quarantines the run as stopped/engine-error + takeover-limit (compatible terminal state).
 * `kinds` (a lane of the worker): only a run of one of these kinds is claimed, queued or taken over; the quarantine is for every kind.
 * The produce lane (`kinds` is produce alone) has its own order, so that one customer's jobs do not keep another's waiting: a run to
 * take over first, then the run of the customer with the fewest produce runs running, then the oldest. It never leaves a run waiting
 * for a free slot.
 */
export function claim(db: DatabaseSync, workerId: string, now: Date, kinds?: readonly RunRow['kind'][]): RunRow | null {
  const cutoff = iso(new Date(now.getTime() - STALE_MS));
  const produceLane = kinds?.length === 1 && kinds[0] === 'produce';
  const ofKinds = kinds === undefined ? '' : ` AND kind IN (${kinds.map((_, i) => `@kind${i}`).join(', ')})`;
  const claimable = `(state = 'queued' OR (state = 'running' AND (heartbeat IS NULL OR heartbeat < @cutoff)))${ofKinds}`;
  return tx(db, () => {
    const quarantined = db.prepare(`UPDATE runs SET state = 'stopped', reason = 'engine-error', detail = 'takeover-limit', updated_at = @now
      WHERE state = 'running' AND claimed_by IS NOT NULL AND (heartbeat IS NULL OR heartbeat < @cutoff) AND takeovers >= @max RETURNING id, kind, ref`)
      .all({ now: iso(now), cutoff, max: MAX_TAKEOVERS }) as { id: string; kind: string; ref: string }[];
    for (const run of quarantined) {
      if (run.kind === 'prepare') db.prepare(`UPDATE templates SET state = 'failed', note = 'engine-error', updated_at = ?
        WHERE id = ? AND state = 'preparing' AND NOT EXISTS (SELECT 1 FROM runs WHERE kind = 'prepare' AND ref = ? AND state IN ('held','queued','running'))`)
        .run(iso(now), run.ref, run.ref);
      if (run.kind === 'scan') db.prepare(`UPDATE scans SET status = 'stopped', reason = 'engine-error', finished_at = ? WHERE id = ? AND status = 'running'`)
        .run(iso(now), run.ref);
    }
    const fair = iso(new Date(now.getTime() - FAIR_WAIT_MS));
    const order = produceLane
      ? `CASE WHEN state = 'running' THEN 0 ELSE 1 END,
         (SELECT COUNT(*) FROM runs AS busy WHERE busy.kind = 'produce' AND busy.state = 'running' AND ${customerOf('busy')} = ${customerOf('runs')})`
      : `CASE WHEN ${batchWork('runs')} AND created_at <= @fair AND NOT @batchAtWork THEN 0
              WHEN NOT ${batchWork('runs')} AND created_at <= @fair THEN 1
              WHEN kind = 'produce' THEN 2
              WHEN NOT ${batchWork('runs')} THEN 3 ELSE 4 END`;
    // the batch worked within the last five minutes (a live run, or one that has finished): its aged jobs do not go first again yet
    const batchAtWork = produceLane ? 0 : Number(db.prepare(`SELECT 1 FROM runs WHERE ${batchWork('runs')} AND heartbeat >= @fair AND state IN ('running', 'done', 'stopped')
      AND NOT (state = 'running' AND heartbeat < @cutoff) LIMIT 1`).get({ fair, cutoff }) !== undefined);
    const aged: Record<string, string | number> = produceLane ? {} : { fair, batchAtWork };
    for (;;) {
      const row = db.prepare(`SELECT * FROM runs WHERE ${claimable} ORDER BY ${order}, created_at, rowid LIMIT 1`)
        .get({ cutoff, ...aged, ...Object.fromEntries((kinds ?? []).map((kind, i) => [`kind${i}`, kind])) });
      if (!row) return null;
      const t = iso(now);
      try {
        toRun(row);
      } catch {
        // unreadable JSON: this run can never work, so it must not block the ones behind it
        db.prepare(`UPDATE runs SET state = 'stopped', reason = 'engine-error', detail = 'invalid-run-json', updated_at = ? WHERE id = ?`).run(t, row.id as string);
        continue;
      }
      const claimed = db.prepare(
        `UPDATE runs SET takeovers = takeovers + CASE WHEN state = 'running' AND claimed_by IS NOT NULL THEN 1 ELSE 0 END, state = 'running', claimed_by = ?, heartbeat = ?, updated_at = ? WHERE id = ? RETURNING *`,
      ).get(workerId, t, t, row.id as string);
      return claimed ? toRun(claimed) : null;
    }
  });
}

/** Why a write of a run changed nothing: the run is not `running` any more, or (inside `asOwner`) another worker holds it, or nobody after a hand-back. */
export type Refusal = 'not-running' | 'not-owner';
/** The worker a handler runs for. `refused` is set when one of its writes of `runId` changed nothing (the last refusal wins). */
export interface Owner { runId: string; workerId: string; refused: Refusal | null }
const owner = new AsyncLocalStorage<Owner>();

/**
 * Runs `fn` as `own.workerId`: inside it (and in everything it awaits or starts), `beat`, `setSteps`, `setVariants`, `addSent`, `finish` and `stop`
 * of run `own.runId` change the run only while that worker still holds it (`claimed_by`), so a worker that lost the run (taken over,
 * handed back) changes nothing. Writes of other runs, and writes outside `asOwner`, are as before.
 */
export function asOwner<T>(own: Owner, fn: () => T): T {
  return owner.run(own, fn);
}

/** Privileged setup/CLI writers intentionally have no scope; all worker handlers must enter asOwner before writing.
 * The owner scope of a write of run `id`, when there is one: the extra condition on `claimed_by`, its value, and the scope itself. */
function scope(id: string): { sql: string; params: SQLInputValue[]; own: Owner | undefined } {
  const own = owner.getStore();
  return own !== undefined && own.runId === id ? { sql: ' AND claimed_by IS ?', params: [own.workerId], own } : { sql: '', params: [], own: undefined };
}
/** A write of run `id` changed nothing inside an owner scope: record why (another worker holds the run, or it is not running any more). */
function refuse(db: DatabaseSync, id: string, own: Owner | undefined): void {
  if (own === undefined) return;
  const r = db.prepare('SELECT claimed_by FROM runs WHERE id = ?').get(id) as { claimed_by: string | null } | undefined;
  own.refused = r !== undefined && r.claimed_by !== own.workerId ? 'not-owner' : 'not-running';
}

/** UPDATE runs SET `set` for a `running` run; inside `asOwner` for that run, only while its worker holds it. Whether a row changed. */
function write(db: DatabaseSync, id: string, set: string, values: SQLInputValue[]): boolean {
  const { sql, params, own } = scope(id);
  const changed = db.prepare(`UPDATE runs SET ${set} WHERE id = ? AND state = 'running'${sql}`).run(...values, id, ...params).changes > 0;
  if (!changed) refuse(db, id, own);
  return changed;
}

/** The writes below change a run only while it is `running` (and, inside `asOwner`, held by its worker); they return whether a row changed. */
export function beat(db: DatabaseSync, id: string, now: Date): boolean {
  const t = iso(now);
  return write(db, id, 'heartbeat = ?, updated_at = ?', [t, t]);
}

export function setSteps(db: DatabaseSync, id: string, steps: Step[], now: Date): boolean {
  return write(db, id, 'steps = ?, updated_at = ?', [JSON.stringify(steps), iso(now)]);
}

export function setVariants(db: DatabaseSync, id: string, variants: VariantState[], now: Date): boolean {
  return write(db, id, 'variants = ?, updated_at = ?', [JSON.stringify(variants), iso(now)]);
}

/** Whether `workerId` still holds the run: it is `running` and claimed by that worker. */
export function holds(db: DatabaseSync, id: string, workerId: string | null): boolean {
  if (workerId === null) return false; // Hand-back grants no ownership capability to an unclaimed caller.
  return db.prepare(`SELECT 1 FROM runs WHERE id = ? AND state = 'running' AND claimed_by IS ?`).get(id, workerId) !== undefined;
}

/** Hands a running run back (a worker that shuts down): unclaimed and without a heartbeat, so the next claim takes it at once. Only by its holder. */
export function release(db: DatabaseSync, id: string, workerId: string, now: Date): boolean {
  return db.prepare(`UPDATE runs SET claimed_by = NULL, heartbeat = NULL, updated_at = ? WHERE id = ? AND state = 'running' AND claimed_by = ?`)
    .run(iso(now), id, workerId).changes > 0;
}

/** Adds the given numbers to `sent` (a missing column counts as all zero). */
export function addSent(db: DatabaseSync, id: string, paid: Partial<Paid>, now: Date): boolean {
  return tx(db, () => {
    const { sql, params, own } = scope(id);
    const r = db.prepare(`SELECT sent FROM runs WHERE id = ? AND state = 'running'${sql}`).get(id, ...params) as { sent: string | null } | undefined;
    if (!r) { refuse(db, id, own); return false; }
    const cur = { ...ZERO, ...(json<Paid>(r.sent) ?? {}) };
    const next: Paid = {
      images: cur.images + (paid.images ?? 0), clips: cur.clips + (paid.clips ?? 0), clipSeconds: cur.clipSeconds + (paid.clipSeconds ?? 0),
      music: cur.music + (paid.music ?? 0), voice: cur.voice + (paid.voice ?? 0),
    };
    db.prepare(`UPDATE runs SET sent = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(next), iso(now), id);
    return true;
  });
}

/** `detail`: a closed diagnostic code (`LlmInvalid.code`: letters, `_`, `-`, `:` and `,` only); anything else is not stored. */
export function finish(db: DatabaseSync, id: string, result: RunResult, now: Date, detail: string | null = null): boolean {
  const code = detail !== null && /^[A-Za-z_:,-]{1,120}$/.test(detail) ? detail : null;
  return write(db, id, `state = 'done', result = ?, updated_at = ?, detail = ?`, [JSON.stringify(result), iso(now), code]);
}

export type FailureCode = 'handler-error' | 'handler-incomplete' | 'llm-error' | 'tool-timeout' | 'tool-failed' | 'database-error' | 'no-products' | 'fill-invalid'
  | 'provider-credits' | 'provider-cap' | 'provider-refused' | 'provider-setup' | 'upload-failed'
  | 'photo-refused' | 'person-missing';   // a person swap: the provider will not take this photograph · it finds no person to replace in the video

/** Stable, short diagnostics: no message, path, token or arbitrary error code is persisted. */
export function failureCode(error: unknown): FailureCode {
  if (error instanceof Error) {
    if (error.name === 'LlmError') return 'llm-error';
    if ('code' in error && error.code === 'timeout') return 'tool-timeout';
    if ('code' in error && typeof error.code === 'string' && error.code.startsWith('SQLITE_')) return 'database-error';
    if (['ExecError', 'RenderError', 'TranscribeError', 'MediaError'].includes(error.name)) return 'tool-failed';
  }
  return 'handler-error';
}

export function stop(db: DatabaseSync, id: string, reason: StopReason | PrepareNote | ScanReason, missing: Paid | null, now: Date, detail: FailureCode | null = null): boolean {
  return write(db, id, `state = 'stopped', reason = ?, missing = ?, updated_at = ?, detail = ?`, [reason, missing ? JSON.stringify(missing) : null, iso(now), detail]);
}

export function operation(db: DatabaseSync, runId: string, key: string): OperationRow | null {
  const r = db.prepare('SELECT * FROM operations WHERE run_id = ? AND key = ?').get(runId, key);
  return r ? toOperation(r) : null;
}

/**
 * Writes the `pending` row before a paid request is sent; when the key is already there, returns that row. Inside `asOwner` for this run: only
 * while that worker holds it, else nothing is written and the answer is null (coded in the owner scope).
 */
export function beginOperation(
  db: DatabaseSync, runId: string, key: string, kind: OperationRow['kind'], now: Date,
): { row: OperationRow; created: boolean } | null {
  return tx(db, () => {
    const { sql, params, own } = scope(runId);
    if (own !== undefined && !db.prepare(`SELECT 1 FROM runs WHERE id = ? AND state = 'running'${sql}`).get(runId, ...params)) { refuse(db, runId, own); return null; }
    const existing = operation(db, runId, key);
    if (existing) return { row: existing, created: false };
    const t = iso(now);
    db.prepare(`INSERT INTO operations (run_id, key, kind, state, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)`).run(runId, key, kind, t, t);
    return { row: operation(db, runId, key)!, created: true };
  });
}

/**
 * `beginOperation` for a worker that must still own the run. In one transaction: the run is `running` and claimed by
 * `claimedBy`, then the `pending` row is written. null, and nothing written, when the run is no longer that worker's.
 */
export function beginOwnOperation(
  db: DatabaseSync, runId: string, key: string, kind: OperationRow['kind'], claimedBy: string | null, now: Date,
): { row: OperationRow; created: boolean } | null {
  return tx(db, () => {
    if (!db.prepare(`SELECT 1 FROM runs WHERE id = ? AND state = 'running' AND claimed_by IS ?`).get(runId, claimedBy)) { refuse(db, runId, scope(runId).own); return null; }
    const existing = operation(db, runId, key);
    if (existing) return { row: existing, created: false };
    const t = iso(now);
    db.prepare(`INSERT INTO operations (run_id, key, kind, state, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)`).run(runId, key, kind, t, t);
    return { row: operation(db, runId, key)!, created: true };
  });
}

/**
 * Updates only the fields given in `patch`. Inside `asOwner` for this run the row changes only while the run is `running` and held by that
 * worker; otherwise nothing changes and the owner scope records why. One exception: a ticket (`externalId` alone) for a row that has none is
 * always written, since it says what the provider accepted and a lost worker's request is the one thing that must not be forgotten.
 */
export function endOperation(
  db: DatabaseSync, runId: string, key: string,
  patch: { state?: OperationRow['state']; externalId?: string | null; output?: string | null; error?: string | null },
  now: Date,
): boolean {
  const { own } = scope(runId);
  const ticketOnly = patch.state === undefined && patch.output === undefined && patch.error === undefined && typeof patch.externalId === 'string';
  const guarded = own !== undefined;
  const changed = db.prepare(
    `UPDATE operations SET
       state = COALESCE(@state, state),
       external_id = CASE WHEN @hasExternal THEN @externalId ELSE external_id END,
       output = CASE WHEN @hasOutput THEN @output ELSE output END,
       error = CASE WHEN @hasError THEN @error ELSE error END,
       updated_at = @t
     WHERE run_id = @runId AND key = @key${guarded ? (ticketOnly ? ' AND (external_id IS NULL OR EXISTS (SELECT 1 FROM runs WHERE id = @runId AND state = \'running\' AND claimed_by IS @worker))'
       : ' AND EXISTS (SELECT 1 FROM runs WHERE id = @runId AND state = \'running\' AND claimed_by IS @worker)') : ''}`,
  ).run({
    state: patch.state ?? null,
    hasExternal: patch.externalId !== undefined ? 1 : 0, externalId: patch.externalId ?? null,
    hasOutput: patch.output !== undefined ? 1 : 0, output: patch.output ?? null,
    hasError: patch.error !== undefined ? 1 : 0, error: patch.error ?? null,
    t: iso(now), runId, key,
    ...(guarded ? { worker: own.workerId } : {}),
  }).changes > 0;
  if (!changed) refuse(db, runId, own);
  return changed;
}
