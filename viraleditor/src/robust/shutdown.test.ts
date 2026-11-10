// C6: what a plain SIGTERM (a service stop or restart) does to the job a worker is running.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db/open.ts';
import * as runs from '../db/runs.ts';
import { runWorker } from '../worker/loop.ts';
import { until } from './harness.ts';

/** Starts `shutdown-child.ts` on a fresh database with one queued run, sends SIGTERM once its job runs, and returns how it ended and the run.
 *  The child polls forever by itself: it is killed in `finally` whatever happens before. */
async function sigtermMidJob() {
  const file = join(mkdtempSync(join(tmpdir(), 've-robust-sigterm-')), 'db.sqlite');
  const db = openDb(file);
  const id = runs.enqueue(db, { kind: 'scan', source: 'topads', trigger: 'manual' }, 'r1', null, new Date());
  const child = spawn(process.execPath, [join(import.meta.dirname, 'shutdown-child.ts'), file], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    let out = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; });
    const exited = new Promise<{ code: number | null; signal: string | null }>((r) => child.on('exit', (code, signal) => r({ code, signal })));
    expect(await until(() => out.includes('started'), 30_000, 20)).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    child.kill('SIGTERM');
    const how = await exited;
    return { how, run: runs.getRun(db, id), db };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

describe('SIGTERM to a worker in the middle of a job (C6)', () => {
  // FINDING 9 (fixed in C6b): exec.ts's own SIGTERM hook kills every killGroup child at once, so the render dies with the signal and the
  // loop used to stop the run as engine-error: a restart of the service ended the user's run for good. Now the worker hands the run back
  // at the signal (unclaimed, no heartbeat), its late writes are refused, it exits 0 within its grace, and the next worker takes it at once.
  it('FINDING 9: the worker hands the run back and exits 0; a restarted worker takes the run at once and finishes it', { timeout: 60_000 }, async () => {
    const from = Date.now();
    const { how, run, db } = await sigtermMidJob();
    expect(how).toEqual({ code: 0, signal: null });
    expect(Date.now() - from).toBeLessThan(30_000);
    expect(run).toMatchObject({ state: 'running', claimedBy: null, heartbeat: null, reason: null });
    const clock = { now: () => new Date() };
    const ok = async () => {};
    const worker = runWorker({
      db, clock, workerId: 'worker-R', idleMs: 50, health: async () => ({ provider: 'fake', renderer: 'ready', note: null }),
      handlers: { scan: async (r) => { runs.finish(db, r.id, { kind: 'scan', checked: 1, aboveThreshold: 0, prepared: 0 }, clock.now()); }, produce: ok, prepare: ok, edit: ok },
    });
    try {
      expect(await until(() => runs.getRun(db, run!.id)?.state === 'done', 5000, 20)).toBe(true);
    } finally { await worker.stop(); }
    expect(runs.getRun(db, run!.id)).toMatchObject({ state: 'done', claimedBy: 'worker-R' });
  });
});
