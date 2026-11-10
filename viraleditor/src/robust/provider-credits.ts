// The provider said it has no credits left (HTTP 402 on a paid POST): from then on no run sends a new paid request, whichever
// lane it runs in. The hold is one row of the database, so every slot of the worker reads the same answer at the moment it would send.
// It is no lock for good. A run that stopped for it and is tried again (the admin's "retry" after topping up) is sent through,
// and the first request the provider then accepts lifts the hold; a refusal sets it again.
import type { DatabaseSync } from 'node:sqlite';

/** Who was refused, and when: the request `key` of run `runId`. */
export interface CreditsHold { at: string; runId: string; key: string }

/** The hold that stands now, or null. */
export function creditsHold(db: DatabaseSync): CreditsHold | null {
  const row = db.prepare('SELECT at, run_id AS runId, key FROM provider_hold WHERE id = 1').get() as CreditsHold | undefined;
  return row ? { at: row.at, runId: row.runId, key: row.key } : null;
}

/** Sets the hold, or replaces it with this newer refusal. */
export function holdCredits(db: DatabaseSync, runId: string, key: string, at: Date): void {
  db.prepare('INSERT INTO provider_hold (id, at, run_id, key) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, run_id = excluded.run_id, key = excluded.key')
    .run(at.toISOString(), runId, key);
}

/** Lifts the hold when it is still the one `held` (what the caller read before it sent its request): a refusal that came since is not lifted. */
export function liftCredits(db: DatabaseSync, held: CreditsHold | null): boolean {
  if (held === null) return false;
  return Number(db.prepare('DELETE FROM provider_hold WHERE id = 1 AND at = ? AND run_id = ? AND key = ?').run(held.at, held.runId, held.key).changes) > 0;
}
