import type { DatabaseSync } from 'node:sqlite';
import type { Card, Paid } from '../contracts.ts';

export type TemplateState = 'preparing' | 'ready' | 'failed' | 'published' | 'hidden';

export interface TemplateRow {
  id: string;
  state: TemplateState;
  owner: string | null;
  sourceKind: 'topads' | 'shorts' | 'link' | 'upload' | 'seed';
  sourceUrl: string | null;
  note: string | null;
  card: Card;
  estimate: Paid | null;
  minutes: number | null;
  timesGenerated: number;
  createdAt: string;
  updatedAt: string;
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function toRow(r: Raw): TemplateRow {
  return {
    id: r.id as string, state: r.state as TemplateState, owner: str(r.owner),
    sourceKind: r.source_kind as TemplateRow['sourceKind'], sourceUrl: str(r.source_url), note: str(r.note),
    card: JSON.parse(r.card as string) as Card,
    estimate: typeof r.estimate === 'string' ? (JSON.parse(r.estimate) as Paid) : null,
    minutes: typeof r.minutes === 'number' ? r.minutes : null,
    timesGenerated: r.times_generated as number,
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

export function get(db: DatabaseSync, id: string): TemplateRow | null {
  const r = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  return r ? toRow(r) : null;
}

export function list(db: DatabaseSync, filter: { state?: TemplateState; owner?: string | null } = {}): TemplateRow[] {
  const where: string[] = []; const args: string[] = [];
  if (filter.state !== undefined) { where.push('state = ?'); args.push(filter.state); }
  if (filter.owner === null) where.push('owner IS NULL');
  else if (filter.owner !== undefined) { where.push('owner = ?'); args.push(filter.owner); }
  const sql = `SELECT * FROM templates${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at, id`;
  return db.prepare(sql).all(...args).map(toRow);
}

/** Insert, or replace everything but `created_at` and (unless given) `times_generated`. */
export function upsert(
  db: DatabaseSync,
  row: Omit<TemplateRow, 'createdAt' | 'updatedAt' | 'timesGenerated'> & { timesGenerated?: number },
  now: Date,
): void {
  const t = now.toISOString();
  db.prepare(
    `INSERT INTO templates (id, state, owner, source_kind, source_url, note, card, estimate, minutes, times_generated, created_at, updated_at)
     VALUES (@id, @state, @owner, @sourceKind, @sourceUrl, @note, @card, @estimate, @minutes, @times, @t, @t)
     ON CONFLICT (id) DO UPDATE SET state = excluded.state, owner = excluded.owner, source_kind = excluded.source_kind,
       source_url = excluded.source_url, note = excluded.note, card = excluded.card, estimate = excluded.estimate,
       minutes = excluded.minutes, times_generated = CASE WHEN @hasTimes THEN excluded.times_generated ELSE templates.times_generated END,
       updated_at = excluded.updated_at`,
  ).run({
    id: row.id, state: row.state, owner: row.owner, sourceKind: row.sourceKind, sourceUrl: row.sourceUrl, note: row.note,
    card: JSON.stringify(row.card), estimate: row.estimate ? JSON.stringify(row.estimate) : null, minutes: row.minutes,
    times: row.timesGenerated ?? 0, hasTimes: row.timesGenerated !== undefined ? 1 : 0, t,
  });
}

export function setState(db: DatabaseSync, id: string, state: TemplateState, note: string | null = null, now: Date): void {
  db.prepare('UPDATE templates SET state = ?, note = ?, updated_at = ? WHERE id = ?').run(state, note, now.toISOString(), id);
}

/** Writes what a row says of its template's content, and nothing else (state, owner and counters stay). False when the row is gone. */
export function setCard(db: DatabaseSync, id: string, value: Pick<TemplateRow, 'card' | 'estimate' | 'minutes' | 'note'>, now: Date): boolean {
  return db.prepare('UPDATE templates SET card = ?, estimate = ?, minutes = ?, note = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(value.card), value.estimate ? JSON.stringify(value.estimate) : null, value.minutes, value.note, now.toISOString(), id).changes > 0;
}
