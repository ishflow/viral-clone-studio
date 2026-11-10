// @vitest-environment node
import { rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeSqliteEngines, sqliteEngine } from './sqlite-engine';
import { jobRecord, makeDataDir, PAID, putTemplate } from './testing';

let dir: string;
let db: DatabaseSync;
const engine = () => sqliteEngine(dir);

beforeEach(() => {
  ({ dir, db } = makeDataDir());
  putTemplate(db, { id: 't1', state: 'published' });
});
afterEach(() => {
  closeSqliteEngines();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** What the worker writes when it stops a run with a detail code. */
function stopWith(jobId: string, reason: string, detail: string | null): void {
  db.prepare(`UPDATE runs SET state = 'stopped', reason = ?, detail = ?, steps = '[]' WHERE ref = ?`).run(reason, detail, jobId);
}

describe('the stop detail of a run reaches the job', () => {
  it('a listed detail code is passed on, with the reason', () => {
    const job = jobRecord();
    engine().start(job, PAID, false);
    engine().committed();
    stopWith(job.id, 'engine-error', 'provider-credits');
    expect(engine().refresh(job)).toMatchObject({ status: 'stopped', stoppedReason: 'engine-error', stoppedDetail: 'provider-credits' });
  });

  it('an unknown detail code, or none, is null: raw engine text never reaches a screen', () => {
    const odd = jobRecord();
    engine().start(odd, PAID, false);
    engine().committed();
    stopWith(odd.id, 'engine-error', 'database-error');
    expect(engine().refresh(odd).stoppedDetail).toBeNull();
    const none = jobRecord();
    engine().start(none, PAID, false);
    engine().committed();
    stopWith(none.id, 'engine-error', null);
    expect(engine().refresh(none).stoppedDetail).toBeNull();
  });

  it('a resume clears it', () => {
    const job = jobRecord();
    engine().start(job, PAID, false);
    engine().committed();
    stopWith(job.id, 'engine-error', 'provider-credits');
    engine().refresh(job);
    engine().resume(job, engine().missing(job));
    expect(job.stoppedDetail ?? null).toBeNull();
    expect(job.status).toBe('running');
  });
});
