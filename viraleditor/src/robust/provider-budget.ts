import type { DatabaseSync } from 'node:sqlite';
import type { ProviderCaps } from './provider-policy.ts';
/** Ruling: conservative reservation units, not a verified Magnific tariff. One image/music/voice = 1; clip = seconds. Only a definitive provider refusal, or a request that failed before its POST (`upload-failed`), gives units back (`refundProvider`). */
export function providerUnits(paid: { images: number; clipSeconds: number; music: number; voice: number }): number {
  return paid.images + paid.clipSeconds + paid.music + paid.voice;
}
export function budgetSchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS provider_budget (run_id TEXT NOT NULL, day TEXT NOT NULL, reserved INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(run_id, day))`);
}
/** Caller owns BEGIN IMMEDIATE. Reservations are durable even if the user is later refunded. */
export function reserveProvider(db: DatabaseSync, caps: ProviderCaps | null, runId: string, units: number, at: Date): void {
  if (!caps) return;
  if (!Number.isSafeInteger(units) || units < 0) throw new Error('provider-cap');
  releaseTerminal(db);
  const day = at.toISOString().slice(0, 10);
  const total = (db.prepare('SELECT COALESCE(SUM(reserved), 0) AS n FROM provider_budget WHERE day = ?').get(day) as { n: number }).n;
  // an earlier day counts for what it consumed: its unused reservation was for a run that stopped, and a resume reserves again today
  const job = (db.prepare('SELECT COALESCE(SUM(CASE WHEN day = ? THEN reserved ELSE consumed END), 0) AS n FROM provider_budget WHERE run_id = ?').get(day, runId) as { n: number }).n;
  if (job + units > caps.job || total + units > caps.daily) throw new Error('provider-cap');
  db.prepare(`INSERT INTO provider_budget(run_id, day, reserved) VALUES (?, ?, ?) ON CONFLICT(run_id,day) DO UPDATE SET reserved = reserved + excluded.reserved`).run(runId, day, units);
}
/**
 * A run that stopped without one paid POST (`consumed` = 0) gives its reservation back, so it no longer eats the day's cap. A run
 * that paid keeps its reservation. The cap is still held where money moves: every POST goes through `consumeProvider`, and a
 * resume reserves again what it has to pay for.
 */
export function releaseUnspent(db: DatabaseSync, runId: string): void {
  budgetSchema(db);
  db.prepare('UPDATE provider_budget SET reserved = 0 WHERE run_id = ? AND consumed = 0 AND reserved > 0').run(runId);
}
/**
 * A run that cannot spend any more (`done`, or `closed` by the customer, by the 30 days, or by hand) keeps only what it consumed:
 * its unused reservation (a closed job with 43 reserved and 10 consumed held 33 units of its day for nothing) is given back.
 * A `stopped` run may be resumed and keeps its reservation. Rows are found by the budget key: the job (`ref`) of a produce run, the run's own id otherwise.
 * Returns how many rows it changed. The site and the worker both call it; without a `runs` table (a bare budget database) there is nothing to do.
 */
export function releaseTerminal(db: DatabaseSync): number {
  budgetSchema(db);
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get() === undefined) return 0;
  return Number(db.prepare(`UPDATE provider_budget SET reserved = consumed WHERE reserved > consumed AND run_id IN (
    SELECT CASE WHEN kind = 'produce' THEN ref ELSE id END FROM runs WHERE state IN ('done', 'closed'))`).run().changes);
}
/** Every actual paid POST consumes its reservation, including unknown requests and retries; a definitive refusal, and a request whose upload failed before the POST, is given back by `refundProvider`. */
export function consumeProvider(db: DatabaseSync, caps: ProviderCaps | null, runId: string, units: number, at: Date): void {
  if (!caps) return;
  budgetSchema(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    const day = at.toISOString().slice(0, 10);
    const row = db.prepare('SELECT reserved, consumed FROM provider_budget WHERE run_id = ? AND day = ?').get(runId, day) as { reserved: number; consumed: number } | undefined;
    const missing = Math.max(0, (row?.consumed ?? 0) + units - (row?.reserved ?? 0));
    if (missing) reserveProvider(db, caps, runId, missing, at);
    db.prepare('UPDATE provider_budget SET consumed = consumed + ? WHERE run_id = ? AND day = ?').run(units, runId, day);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
/**
 * The provider refused a request for good (HTTP 4xx: no task made, nothing paid), or the request never got to its POST (`upload-failed`): its units go back to `consumed`, so the cap bounds real
 * money risk and a provider without credits cannot use up a job's cap by being asked again. The reservation stays. Never for a 5xx, no
 * answer or an answer without a task (those may have cost money). Never below 0; a request whose day has no row (a POST across UTC midnight) gives back nothing.
 */
export function refundProvider(db: DatabaseSync, caps: ProviderCaps | null, runId: string, units: number, at: Date): void {
  if (!caps) return;
  budgetSchema(db);
  db.prepare('UPDATE provider_budget SET consumed = MAX(0, consumed - ?) WHERE run_id = ? AND day = ?').run(units, runId, at.toISOString().slice(0, 10));
}
