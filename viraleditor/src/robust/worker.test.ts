// C6 case 2 with fakes: a worker stops beating mid-job and another takes the run over (heartbeat older than 60 s).
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/open.ts';
import * as runs from '../db/runs.ts';
import { runWorker } from '../worker/loop.ts';
import { job } from './job.ts';

const health = async () => ({ provider: 'fake' as const, renderer: 'ready' as const, note: null });
const ok = async () => {};
function gate() { let open!: () => void; const shut = new Promise<void>((r) => { open = r; }); return { shut, open }; }
async function until(check: () => boolean, ms = 5000): Promise<void> {
  for (const end = Date.now() + ms; Date.now() < end;) { if (check()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('timed out waiting');
}

/** Two workers on one database file; B's clock is 61 s ahead, so A's heartbeat is stale to it. Renders are fakes that write `who` to the target, A's held until released. */
function world() {
  const base = mkdtempSync(join(tmpdir(), 've-robust-worker-'));
  const file = join(base, 'db.sqlite');
  const db = openDb(file);
  const log = join(base, 'log');
  writeFileSync(log, '');
  const t0 = Date.parse('2026-10-05T10:00:00.000Z');
  const clocks = { A: { now: () => new Date(t0) }, B: { now: () => new Date(t0 + runs.STALE_MS + 1000) } };
  const held = { A: gate(), B: gate() };
  const rendered: string[] = [];
  const start = (who: 'A' | 'B') => {
    const own = who === 'A' ? db : openDb(file);
    const renderer = { render: async (_dir: string, to: string) => { rendered.push(who); await held[who].shut; writeFileSync(to, who); return { width: 0, height: 0, fps: 0, frames: 0, seconds: 0, audio: false }; } };
    return runWorker({ db: own, clock: clocks[who], workerId: `worker-${who}`, idleMs: 50, health, handlers: { scan: job({ db: own, clock: clocks[who], renderer, composition: base, out: base, log, who }), produce: ok, prepare: ok, edit: ok } });
  };
  const id = runs.enqueue(db, { kind: 'scan', source: 'topads', trigger: 'manual' }, 'r1', null, new Date(t0));
  const lines = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  return { base, db, id, start, held, rendered, lines, video: () => readFileSync(join(base, `${id}.mp4`), 'utf8') };
}

describe('a worker stops beating mid-job and another takes over (C6 case 2, fakes)', () => {
  it('B takes the run; the paid step is not sent again; B\'s render is the result; A, when it wakes, changes nothing', { timeout: 20_000 }, async () => {
    const w = world();
    const a = w.start('A');
    await until(() => w.rendered.includes('A'));                                       // A paid and is rendering; it beats no more (its clock stands still)
    const b = w.start('B');
    await until(() => w.rendered.includes('B'));
    expect(runs.getRun(w.db, w.id)).toMatchObject({ state: 'running', claimedBy: 'worker-B' });
    w.held.B.open();
    await until(() => runs.getRun(w.db, w.id)?.state === 'done');
    w.held.A.open();                                                                    // A wakes up late
    await Promise.all([a.stop(), b.stop()]);
    expect(w.lines()).toEqual([`paid A ${w.id}`, `render A ${w.id}`, `render B ${w.id}`]);
    expect(runs.getRun(w.db, w.id)).toMatchObject({ state: 'done', claimedBy: 'worker-B' });
    expect(w.video()).toBe('B');                                                        // FINDING 8, fixed: A's late render does not reach the target
  });

  // FINDING 8 (fixed in C6b): a worker that lost its run (heartbeat stale, run taken over) and wakes before the new owner finishes
  // used to end the run with its own result while the new owner was still rendering. Its writes are now refused (coded not-owner).
  it('FINDING 8: a worker that lost the run cannot finish it while the new owner works; its refusal is coded not-owner', { timeout: 20_000 }, async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = world();
    const a = w.start('A');
    try {
      await until(() => w.rendered.includes('A'));
      const b = w.start('B');
      try {
        await until(() => w.rendered.includes('B'));
        w.held.A.open();                                                                // A wakes first
        await until(() => errors.mock.calls.flat().join('\n').includes(`run ${w.id}: not-owner`));
        expect(runs.getRun(w.db, w.id)).toMatchObject({ state: 'running', claimedBy: 'worker-B' });   // still B's
        expect(existsSync(join(w.base, `${w.id}.mp4`))).toBe(false);                    // A published nothing
        w.held.B.open();
        await until(() => runs.getRun(w.db, w.id)?.state === 'done');
      } finally { w.held.B.open(); await b.stop(); }
      expect(runs.getRun(w.db, w.id)).toMatchObject({ state: 'done', claimedBy: 'worker-B' });
      expect(w.video()).toBe('B');
    } finally { w.held.A.open(); await a.stop(); errors.mockRestore(); }
  });
});
