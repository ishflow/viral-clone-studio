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

const ops = (runId: string) => Object.fromEntries((db.prepare('SELECT key, state FROM operations WHERE run_id = ? ORDER BY key').all(runId) as { key: string; state: string }[]).map((r) => [r.key, r.state]));

/** A job whose run the worker stopped with an unknown request (a POST that got a 5xx). */
function stuckJob(reason = 'submission-unknown') {
  const job = jobRecord();
  engine().start(job, PAID, false);
  engine().committed();
  const run = db.prepare('SELECT id FROM runs WHERE ref = ?').get(job.id) as { id: string };
  db.prepare("UPDATE runs SET state = 'stopped', reason = ?, steps = '[]', missing = ? WHERE id = ?").run(reason, JSON.stringify({ images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 }), run.id);
  db.prepare("INSERT INTO operations (run_id, key, kind, state, error, created_at, updated_at) VALUES (?, 'v1:image:s2', 'image', 'unknown', 'POST answered HTTP 503 without a task [units:1]', '2026-10-04T12:00:01.000Z', '2026-10-04T12:00:02.000Z')").run(run.id);
  engine().refresh(job);
  job.status = 'stopped';
  job.stoppedReason = 'submission-unknown';
  return { job, runId: run.id };
}

describe('settleUnknown: the admin says the request never reached the provider', () => {
  it('turns the unknown request into failed with the admin named, and the job can be resumed without paying more than before', () => {
    const { job, runId } = stuckJob();
    expect(engine().missing(job)).toEqual({ images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 });
    engine().settleUnknown!(job, 'Ayşe (admin)');
    expect(ops(runId)).toEqual({ 'v1:image:s2': 'failed' });
    expect((db.prepare("SELECT error FROM operations WHERE run_id = ?").get(runId) as { error: string }).error).toContain('Ayşe (admin)');
    expect(job.stoppedReason).toBe('engine-error');                      // the record no longer says the request is unknown
    engine().resume(job, engine().missing(job));
    expect(job.status).toBe('running');
    expect((db.prepare('SELECT state FROM runs WHERE id = ?').get(runId) as { state: string }).state).toBe('held');
  });

  it('refuses a job whose run is not stuck on an unknown request, and changes nothing', () => {
    const { job, runId } = stuckJob('engine-error');
    expect(() => engine().settleUnknown!(job, 'Ayşe')).toThrow('not-settleable');
    expect(ops(runId)).toEqual({ 'v1:image:s2': 'unknown' });
    expect(job.stoppedReason).toBe('submission-unknown');                // untouched
  });

  it('a second settle finds nothing to settle', () => {
    const { job } = stuckJob();
    engine().settleUnknown!(job, 'Ayşe');
    expect(() => engine().settleUnknown!(job, 'Ayşe')).toThrow('not-settleable');
  });
});
