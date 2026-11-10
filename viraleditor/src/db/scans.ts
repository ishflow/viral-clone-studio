import type { DatabaseSync } from 'node:sqlite';

export interface ScanRow {
  id: string;
  source: 'topads' | 'shorts';
  startedAt: string;
  finishedAt: string | null;
  checked: number;
  queued: number;               // sent on to scoring: the prepare runs this scan queued, re-queues included
  aboveThreshold: number;
  prepared: number;
  status: 'running' | 'done' | 'stopped';
  reason: string | null;
}

type Raw = Record<string, unknown>;

function toRow(r: Raw): ScanRow {
  return {
    id: r.id as string, source: r.source as ScanRow['source'], startedAt: r.started_at as string,
    finishedAt: typeof r.finished_at === 'string' ? r.finished_at : null,
    checked: r.checked as number, queued: r.queued as number, aboveThreshold: r.above_threshold as number, prepared: r.prepared as number,
    status: r.status as ScanRow['status'], reason: typeof r.reason === 'string' ? r.reason : null,
  };
}

export function get(db: DatabaseSync, id: string): ScanRow | null {
  const r = db.prepare('SELECT * FROM scans WHERE id = ?').get(id);
  return r ? toRow(r) : null;
}

/** Newest first. */
export function list(db: DatabaseSync): ScanRow[] {
  return db.prepare('SELECT * FROM scans ORDER BY started_at DESC, id').all().map(toRow);
}

/** A running row; the same id again (a run taken over from a dead worker) starts it afresh. */
export function begin(db: DatabaseSync, id: string, source: ScanRow['source'], now: Date): void {
  db.prepare(
    `INSERT INTO scans (id, source, started_at, status) VALUES (?, ?, ?, 'running')
     ON CONFLICT (id) DO UPDATE SET source = excluded.source, started_at = excluded.started_at, finished_at = NULL,
       checked = 0, queued = 0, above_threshold = 0, prepared = 0, status = 'running', reason = NULL`,
  ).run(id, source, now.toISOString());
}

export function setChecked(db: DatabaseSync, id: string, checked: number): void {
  db.prepare('UPDATE scans SET checked = ? WHERE id = ?').run(checked, id);
}

export function addQueued(db: DatabaseSync, id: string): void {
  db.prepare('UPDATE scans SET queued = queued + 1 WHERE id = ?').run(id);
}

export function end(db: DatabaseSync, id: string, status: 'done' | 'stopped', reason: string | null, now: Date): void {
  db.prepare('UPDATE scans SET status = ?, reason = ?, finished_at = ? WHERE id = ?').run(status, reason, now.toISOString(), id);
}

export function addAboveThreshold(db: DatabaseSync, id: string): void {
  db.prepare('UPDATE scans SET above_threshold = above_threshold + 1 WHERE id = ?').run(id);
}

export function addPrepared(db: DatabaseSync, id: string): void {
  db.prepare('UPDATE scans SET prepared = prepared + 1 WHERE id = ?').run(id);
}
