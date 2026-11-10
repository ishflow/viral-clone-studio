import type { DatabaseSync } from 'node:sqlite';

export type CandidateState = 'found' | 'scored' | 'unsupported' | 'rejected' | 'prepared';

export interface CandidateRow {
  id: string;
  scanId: string | null;
  source: 'topads' | 'shorts' | 'manual';
  url: string;
  title: string;
  views: number | null;
  likes: number | null;
  seconds: number;
  state: CandidateState;
  score: number | null;
  scoreNotes: string | null;
  image: string | null;
  video?: string | null;         // a direct video file to download instead of `url` (Top Ads); null or absent: none (always set on a row read)
  foundAt: string;
  updatedAt: string;
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

function toRow(r: Raw): CandidateRow {
  return {
    id: r.id as string, scanId: str(r.scan_id), source: r.source as CandidateRow['source'], url: r.url as string, title: r.title as string,
    views: num(r.views), likes: num(r.likes), seconds: r.seconds as number, state: r.state as CandidateState,
    score: num(r.score), scoreNotes: str(r.score_notes), image: str(r.image), video: str(r.video),
    foundAt: r.found_at as string, updatedAt: r.updated_at as string,
  };
}

export function get(db: DatabaseSync, id: string): CandidateRow | null {
  const r = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
  return r ? toRow(r) : null;
}

export function list(db: DatabaseSync, filter: { state?: CandidateState; scanId?: string } = {}): CandidateRow[] {
  const where: string[] = []; const args: string[] = [];
  if (filter.state !== undefined) { where.push('state = ?'); args.push(filter.state); }
  if (filter.scanId !== undefined) { where.push('scan_id = ?'); args.push(filter.scanId); }
  const sql = `SELECT * FROM candidates${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY found_at, id`;
  return db.prepare(sql).all(...args).map(toRow);
}

type NewRow = Omit<CandidateRow, 'foundAt' | 'updatedAt'>;
const COLUMNS = `INSERT INTO candidates (id, scan_id, source, url, title, views, likes, seconds, state, score, score_notes, image, video, found_at, updated_at)
     VALUES (@id, @scanId, @source, @url, @title, @views, @likes, @seconds, @state, @score, @scoreNotes, @image, @video, @t, @t)`;
const values = (row: NewRow, now: Date) => ({
  id: row.id, scanId: row.scanId, source: row.source, url: row.url, title: row.title, views: row.views, likes: row.likes,
  seconds: row.seconds, state: row.state, score: row.score, scoreNotes: row.scoreNotes, image: row.image, video: row.video ?? null, t: now.toISOString(),
});

/** Insert, or replace everything but `found_at`. */
export function upsert(db: DatabaseSync, row: NewRow, now: Date): void {
  db.prepare(
    `${COLUMNS}
     ON CONFLICT (id) DO UPDATE SET scan_id = excluded.scan_id, source = excluded.source, url = excluded.url, title = excluded.title,
       views = excluded.views, likes = excluded.likes, seconds = excluded.seconds, state = excluded.state, score = excluded.score,
       score_notes = excluded.score_notes, image = excluded.image, video = excluded.video, updated_at = excluded.updated_at`,
  ).run(values(row, now));
}

/** Insert a new candidate; false, and nothing changed, when its id or its URL is recorded already. */
export function insertNew(db: DatabaseSync, row: NewRow, now: Date): boolean {
  return db.prepare(`${COLUMNS} ON CONFLICT DO NOTHING`).run(values(row, now)).changes > 0;
}

export function setState(db: DatabaseSync, id: string, state: CandidateState, now: Date): void {
  db.prepare('UPDATE candidates SET state = ?, updated_at = ? WHERE id = ?').run(state, now.toISOString(), id);
}
