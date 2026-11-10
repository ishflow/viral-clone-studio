// @vitest-environment node
import { rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settleUnknown } from '../../../../viraleditor/src/robust/settle-unknown';
import { closeSqliteEngines, sqliteEngine } from '../real/sqlite-engine';
import { jobRecord, makeDataDir, PAID, putTemplate } from '../real/testing';
import { restart } from './jobs';
import { getStore, resetStore } from './store';

// The site's `restart` on the real sqlite engine: the reason in the site's record is what the engine said when the job stopped
// (a stopped job is not read again), so it is not what decides whether the admin may retry.

let dir: string;
let db: DatabaseSync;
const engine = () => sqliteEngine(dir);
const ZERO = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };

beforeEach(() => {
  resetStore();
  ({ dir, db } = makeDataDir());
  putTemplate(db, { id: 't1', state: 'published' });
  process.env.VC_ENGINE = 'sqlite';
  process.env.VC_DATA_DIR = dir;
});
afterEach(() => {
  closeSqliteEngines();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.VC_ENGINE;
  delete process.env.VC_DATA_DIR;
});

/** A job whose run the worker stopped on an unknown request, read by the site as every page read does. With a ticket the provider took the request. */
function stuck(ticket: string | null) {
  const job = jobRecord();
  engine().start(job, PAID, false);
  engine().committed();
  const run = db.prepare('SELECT id FROM runs WHERE ref = ?').get(job.id) as { id: string };
  db.prepare("UPDATE runs SET state = 'stopped', reason = 'submission-unknown', steps = '[]', missing = ? WHERE id = ?").run(JSON.stringify(ZERO), run.id);
  db.prepare("INSERT INTO operations (run_id, key, kind, state, external_id, error, created_at, updated_at) VALUES (?, 'v1:image:s2', 'image', 'unknown', ?, ?, '2026-10-04T12:00:01.000Z', '2026-10-04T12:00:02.000Z')")
    .run(run.id, ticket, ticket ?? 'POST answered HTTP 503 without a task [units:1]');
  engine().refresh(job);
  return { job, runId: run.id };
}
const runOf = (id: string) => db.prepare('SELECT state, reason FROM runs WHERE id = ?').get(id) as { state: string; reason: string | null };
const requestsOf = (id: string) => db.prepare('SELECT key, state, external_id FROM operations WHERE run_id = ? ORDER BY key').all(id);

describe('a job stopped with submission-unknown, on the real engine', () => {
  it('settled with the settle-unknown command: the site still reads the old reason, the customer cannot continue, and the retry by the admin continues the job', () => {
    const { job, runId } = stuck(null);
    expect(job).toMatchObject({ status: 'stopped', stoppedReason: 'submission-unknown' });
    settleUnknown(db, null, { runId, by: 'op', at: new Date() });   // what `viraleditor settle-unknown <run> --by op` calls
    expect(runOf(runId)).toEqual({ state: 'stopped', reason: 'engine-error' });
    engine().refresh(job);
    expect(job.stoppedReason).toBe('submission-unknown');
    const before = getStore().ledger.length;

    expect(() => restart(job, true, 0)).toThrow('not-resumable');
    expect(runOf(runId).state).toBe('stopped');

    expect(restart(job, false)).toMatchObject({ status: 'running', stoppedReason: null, stoppedAt: null });
    expect(runOf(runId).state).toBe('held');
    expect(getStore().ledger).toHaveLength(before);
  });

  it('a request the provider took (it has its ticket): the customer cannot continue, the retry by the admin continues the job and the request is not sent again', () => {
    const { job, runId } = stuck('/v1/ai/x/t-9');
    expect(job).toMatchObject({ status: 'stopped', stoppedReason: 'submission-unknown' });
    expect(() => engine().settleUnknown!(job, 'admin')).toThrow('has-ticket');   // nothing to settle: the request exists
    const asked = requestsOf(runId);
    const before = getStore().ledger.length;

    expect(() => restart(job, true, 0)).toThrow('not-resumable');
    expect(runOf(runId)).toEqual({ state: 'stopped', reason: 'submission-unknown' });

    expect(restart(job, false)).toMatchObject({ status: 'running', stoppedReason: null });
    engine().committed();
    expect(runOf(runId).state).toBe('queued');
    // The row is as the worker left it, ticket and all, and there is no second one: the worker asks for the result by the ticket
    // (a GET) and POSTs nothing (viraleditor/src/produce/index.test.ts, "an unknown request that has its ticket is not a lock").
    expect(requestsOf(runId)).toEqual(asked);
    expect(asked).toEqual([{ key: 'v1:image:s2', state: 'unknown', external_id: '/v1/ai/x/t-9' }]);
    expect(getStore().ledger).toHaveLength(before);
  });
});
