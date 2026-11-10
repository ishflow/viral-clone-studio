// @vitest-environment node
import { rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobRecord } from '../mock/store';
import { closeSqliteEngines, sqliteEngine } from './sqlite-engine';
import { jobRecord, makeDataDir, putTemplate } from './testing';

// A job the site holds as running whose run the worker has not begun (held, queued): how many videos are in front of it, and how long
// until it starts. The worker's lanes are the number `VC_WORKER_PRODUCE` says (1 when it says nothing sensible).

let dir: string;
let db: DatabaseSync;
const engine = () => sqliteEngine(dir);
const PAID = { images: 2, clips: 2, clipSeconds: 8, music: 1, voice: 0 };

beforeEach(() => {
  ({ dir, db } = makeDataDir());
  putTemplate(db, { id: 't1', state: 'published', minutes: 7 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  closeSqliteEngines();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A job handed to the engine and released (its run is `queued`); runs are made one second apart, in the order the jobs are made. */
let made = 0;
function job(variants: 1 | 2 | 3 = 1): JobRecord {
  const record = jobRecord({}, { variants });
  engine().start(record, PAID, false);
  engine().committed();
  const at = new Date(Date.UTC(2026, 9, 7, 10, 0, made++)).toISOString();
  db.prepare('UPDATE runs SET created_at = ? WHERE ref = ?').run(at, record.id);
  return record;
}
const state = (record: JobRecord, to: string, steps: unknown[] = []) =>
  db.prepare('UPDATE runs SET state = ?, steps = ? WHERE ref = ?').run(to, JSON.stringify(steps), record.id);
const queueOf = (record: JobRecord) => engine().refresh(record).engineQueue;

describe('the engine line of a job that waits', () => {
  it('a job behind a video that is being made has 1 ahead and waits for what is left of it; the video being made has no line', () => {
    const first = job();
    const second = job();
    state(first, 'running', [{ key: 'images', status: 'running', done: 1, total: 2 }, { key: 'clips', status: 'waiting', done: 0, total: 2 }]);
    expect(queueOf(first)).toBeNull();
    // left = ((1 - 1/2) + (1 - 0/2)) / 2 = 0.75 of 7 minutes = 5.25 → 6
    expect(queueOf(second)).toEqual({ ahead: 1, waitMinutes: 6 });
  });

  it('every video in front counts, a held one too; each waiting one is a whole estimate; a longer job (variants) is longer', () => {
    const first = job();
    const second = job(2);
    const third = job();
    const mine = job();
    state(first, 'running');
    db.prepare("UPDATE runs SET state = 'held' WHERE ref = ?").run(third.id);
    expect(queueOf(mine)).toEqual({ ahead: 3, waitMinutes: 7 + 14 + 7 });
    expect(queueOf(second)).toEqual({ ahead: 1, waitMinutes: 7 });
  });

  it('a video created after this one is not in front of it', () => {
    const mine = job();
    job();
    expect(queueOf(mine)).toEqual({ ahead: 0, waitMinutes: 0 });
  });

  it('with two lanes the second video starts at once and the third waits for the first lane to free', () => {
    vi.stubEnv('VC_WORKER_PRODUCE', '2');
    const first = job();
    const second = job();
    const third = job();
    state(first, 'running');
    expect(queueOf(second)).toEqual({ ahead: 1, waitMinutes: 0 });
    state(second, 'running');
    expect(queueOf(third)).toEqual({ ahead: 2, waitMinutes: 7 });
  });

  it.each(['', '0', '7', 'two', '1.5', '-1'])('a lane count of "%s" is read as one lane', (value) => {
    vi.stubEnv('VC_WORKER_PRODUCE', value);
    const first = job();
    const second = job();
    state(first, 'running');
    expect(queueOf(second)).toEqual({ ahead: 1, waitMinutes: 7 });
  });

  it('when its run is being made, done or stopped, the job has no line any more', () => {
    const first = job();
    const second = job();
    state(first, 'running');
    expect(queueOf(second)).not.toBeNull();
    state(second, 'running');
    expect(queueOf(second)).toBeNull();
    state(first, 'done');
    expect(queueOf(first)).toBeNull();
  });

  it('a job the site no longer holds as running is left as it is', () => {
    const first = job();
    const second = job();
    state(first, 'running');
    second.status = 'done';
    expect(engine().refresh(second).engineQueue).toBeUndefined();
  });
});
