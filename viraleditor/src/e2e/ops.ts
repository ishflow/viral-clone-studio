import type { DatabaseSync } from 'node:sqlite';
import type { OperationRow } from '../db/runs.ts';

export function operationsOf(db: DatabaseSync, runId: string): OperationRow[] {
  return db.prepare('SELECT * FROM operations WHERE run_id = ?').all(runId).map((r) => ({ state: r.state as OperationRow['state'], key: r.key as string, kind: r.kind as OperationRow['kind'] })) as unknown as OperationRow[];
}
