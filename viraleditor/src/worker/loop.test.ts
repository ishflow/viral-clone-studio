import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { openDb } from '../db/open.ts';
import * as runs from '../db/runs.ts';
import { LlmError } from '../adapters/llm.ts';
import { runWorker } from './loop.ts';
import type { RunInput } from '../contracts.ts';
import type { Clock } from '../ports.ts';

const scan: RunInput = { kind: 'scan', source: 'topads', trigger: 'manual' };
const mem = () => openDb(join(mkdtempSync(join(tmpdir(), 'vc-loop-')), 'db.sqlite'));
function fakeClock(): Clock & { t: number } {
  const c = { t: Date.parse('2026-10-04T10:00:00.000Z'), now() { return new Date(c.t); } };
  return c;
}
const health = async () => ({ provider: 'fake' as const, renderer: 'ready' as const, note: null });
const ok = async () => {};
function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }

afterEach(() => { vi.useRealTimers(); });

describe('runWorker', () => {
  it('a throwing scan handler stops the run with scan-failed and the loop goes on', async () => {
    const db = mem(); const clock = fakeClock();
    const a = runs.enqueue(db, scan, 's1', null, clock.now());
    const b = runs.enqueue(db, { ...scan, source: 'shorts' }, 's2', null, new Date(clock.t + 1000));
    const second = deferred();
    const worker = runWorker({
      db, clock, workerId: 'w1', idleMs: 1_000_000, health,
      handlers: {
        scan: async (run) => { if (run.id === a) throw new Error('boom'); runs.finish(db, run.id, { kind: 'scan', checked: 0, aboveThreshold: 0, prepared: 0 }, clock.now()); second.resolve(); },
        produce: ok, prepare: ok, edit: ok,
      },
    });
    await second.promise;
    await worker.stop();
    expect(runs.getRun(db, a)).toMatchObject({ state: 'stopped', reason: 'scan-failed', detail: 'handler-error' });
    expect(runs.getRun(db, b)?.state).toBe('done');
  });

  it('SEC2 fix I4: a run stopped by a failing model call says why in the worker log: its kind, its id and the LlmError message', async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(' ')); });
    try {
      const db = mem(); const clock = fakeClock();
      const id = runs.enqueue(db, scan, 's1', null, clock.now());
      const done = deferred();
      const worker = runWorker({
        db, clock, workerId: 'w1', idleMs: 1_000_000, health,
        handlers: { scan: async () => { try { throw new LlmError('claude exited 1: auth failed for [token]'); } finally { done.resolve(); } }, produce: ok, prepare: ok, edit: ok },
      });
      await done.promise;
      await worker.stop();
      expect(runs.getRun(db, id)).toMatchObject({ state: 'stopped', reason: 'scan-failed' });
      expect(runs.getRun(db, id)?.detail).toBe('llm-error');
      expect(logged.some((l) => l.includes('scan') && l.includes(id) && l.includes('claude exited 1: auth failed for [token]'))).toBe(true);
    } finally { spy.mockRestore(); }
  });

  it('handBack() gives the running run back at once: a handler that fails after it neither stops nor finishes the run (C6b, F9)', async () => {
    const db = mem(); const clock = fakeClock();
    const id = runs.enqueue(db, scan, 's1', null, clock.now());
    const started = deferred(); const killed = deferred();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const worker = runWorker({
        db, clock, workerId: 'w1', idleMs: 1_000_000, health,
        handlers: {
          scan: async (run) => {
            started.resolve();
            await killed.promise;                                                          // the render dies with the signal
            runs.stop(db, run.id, 'engine-error', null, clock.now());                      // what a handler that catches it would write
            throw new Error('the render exited -1');
          },
          produce: ok, prepare: ok, edit: ok,
        },
      });
      await started.promise;
      worker.handBack();
      expect(runs.getRun(db, id)).toMatchObject({ state: 'running', claimedBy: null, heartbeat: null });
      killed.resolve();
      await worker.stop();
      expect(runs.getRun(db, id)).toMatchObject({ state: 'running', claimedBy: null, heartbeat: null });
      expect(runs.claim(db, 'w2', clock.now())).toMatchObject({ id, claimedBy: 'w2' });     // the next worker takes it at once
      expect(errors.mock.calls.flat().join('\n')).toContain(`run ${id} handed back`);
    } finally { errors.mockRestore(); }
  });

  it('handBack() while idle: the loop ends and claims nothing more', async () => {
    const db = mem(); const clock = fakeClock();
    const worker = runWorker({ db, clock, workerId: 'w1', idleMs: 1_000_000, health, handlers: { scan: ok, produce: ok, prepare: ok, edit: ok } });
    await new Promise((r) => setTimeout(r, 20));
    worker.handBack();
    await worker.stop();
    const id = runs.enqueue(db, scan, 's1', null, clock.now());
    await new Promise((r) => setTimeout(r, 20));
    expect(runs.getRun(db, id)?.state).toBe('queued');
  });

  it('a handler whose run was taken over: its late writes are refused and the loop logs not-owner (C6b, F8)', async () => {
    const db = mem(); const clock = fakeClock();
    const id = runs.enqueue(db, scan, 's1', null, clock.now());
    const started = deferred(); const late = deferred();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      let finished: boolean | null = null;
      const worker = runWorker({
        db, clock, workerId: 'w1', idleMs: 1_000_000, health,
        handlers: { scan: async (run) => { started.resolve(); await late.promise; finished = runs.finish(db, run.id, { kind: 'scan', checked: 1, aboveThreshold: 0, prepared: 0 }, clock.now()); }, produce: ok, prepare: ok, edit: ok },
      });
      await started.promise;
      runs.claim(db, 'w2', new Date(clock.t + runs.STALE_MS + 1000));                    // w1 stood still for more than 60 s
      late.resolve();
      await worker.stop();
      expect(finished).toBe(false);
      expect(runs.getRun(db, id)).toMatchObject({ state: 'running', claimedBy: 'w2' });
      expect(errors.mock.calls.flat().join('\n')).toContain(`run ${id}: not-owner`);
    } finally { errors.mockRestore(); }
  });

  it('stop() waits for the running handler', async () => {
    const db = mem(); const clock = fakeClock();
    const id = runs.enqueue(db, scan, 's1', null, clock.now());
    const started = deferred(); const release = deferred();
    const worker = runWorker({
      db, clock, workerId: 'w1', idleMs: 1_000_000, health,
      handlers: { scan: async (run) => { started.resolve(); await release.promise; runs.finish(db, run.id, { kind: 'scan', checked: 1, aboveThreshold: 0, prepared: 0 }, clock.now()); }, produce: ok, prepare: ok, edit: ok },
    });
    await started.promise;
    let stopped = false;
    const stopping = worker.stop().then(() => { stopped = true; });
    await new Promise((r) => setImmediate(r));
    expect(stopped).toBe(false);
    release.resolve();
    await stopping;
    expect(stopped).toBe(true);
    expect(runs.getRun(db, id)?.state).toBe('done');
  });

  it('the health row carries the credits hold in its own field: the words when the provider is on hold, null when health names none', async () => {
    const readHealth = (db: ReturnType<typeof mem>) => JSON.parse((db.prepare('SELECT value FROM health WHERE id = 1').get() as { value: string }).value);
    for (const [given, written] of [[{ noCredits: 'the provider has no credits left' }, 'the provider has no credits left'], [{ noCredits: null }, null], [{}, null]] as const) {
      const db = mem(); const clock = fakeClock();
      const worker = runWorker({ db, clock, workerId: 'w1', idleMs: 1_000_000, health: async () => ({ provider: 'magnific' as const, renderer: 'ready' as const, note: null, ...given }), handlers: { scan: ok, produce: ok, prepare: ok, edit: ok } });
      await worker.stop();
      expect(readHealth(db)).toEqual({ workerAt: new Date(clock.t).toISOString(), provider: 'magnific', renderer: 'ready', note: null, noCredits: written });
    }
  });

  it('the health row carries the person-swap provider when health names it, and no such field when it names none', async () => {
    const readHealth = (db: ReturnType<typeof mem>) => JSON.parse((db.prepare('SELECT value FROM health WHERE id = 1').get() as { value: string }).value);
    for (const given of [{ swap: 'fake' as const }, { swap: 'not-configured' as const }, { swap: 'ready' as const }, {}]) {
      const db = mem(); const clock = fakeClock();
      const worker = runWorker({ db, clock, workerId: 'w1', idleMs: 1_000_000, health: async () => ({ provider: 'magnific' as const, renderer: 'ready' as const, note: null, ...given }), handlers: { scan: ok, produce: ok, prepare: ok, edit: ok } });
      await worker.stop();
      expect(readHealth(db)).toEqual({ workerAt: new Date(clock.t).toISOString(), provider: 'magnific', renderer: 'ready', note: null, noCredits: null, ...given });
    }
  });

  it('the health row carries why there is no person-swap provider when health says it, and no such field when it has nothing to say', async () => {
    const readHealth = (db: ReturnType<typeof mem>) => JSON.parse((db.prepare('SELECT value FROM health WHERE id = 1').get() as { value: string }).value);
    const why = 'VC_SWAP_PROVIDER is not set: a worker that pays has no person-swap provider';
    for (const [given, written] of [[{ swapNote: why }, { swapNote: why }], [{ swapNote: null }, {}], [{}, {}]] as const) {
      const db = mem(); const clock = fakeClock();
      const worker = runWorker({ db, clock, workerId: 'w1', idleMs: 1_000_000, health: async () => ({ provider: 'magnific' as const, renderer: 'ready' as const, note: null, swap: 'not-configured' as const, ...given }), handlers: { scan: ok, produce: ok, prepare: ok, edit: ok } });
      await worker.stop();
      expect(readHealth(db)).toEqual({ workerAt: new Date(clock.t).toISOString(), provider: 'magnific', renderer: 'ready', note: null, noCredits: null, swap: 'not-configured', ...written });
    }
  });

  it('writes health at start, beats every 15 s and writes health every 30 s', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const db = mem(); const clock = fakeClock();
    const id = runs.enqueue(db, scan, 's1', null, clock.now());
    const started = deferred(); const release = deferred();
    const worker = runWorker({
      db, clock, workerId: 'w1', idleMs: 1_000_000, health,
      handlers: { scan: async (run) => { started.resolve(); await release.promise; runs.finish(db, run.id, { kind: 'scan', checked: 0, aboveThreshold: 0, prepared: 0 }, clock.now()); }, produce: ok, prepare: ok, edit: ok },
    });
    await started.promise;
    const hb0 = runs.getRun(db, id)!.heartbeat;
    const readHealth = () => JSON.parse((db.prepare('SELECT value FROM health WHERE id = 1').get() as { value: string }).value);
    expect(readHealth()).toMatchObject({ provider: 'fake', renderer: 'ready', note: null, workerAt: new Date(clock.t).toISOString() });
    clock.t += 15_000;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(runs.getRun(db, id)!.heartbeat).toBe(new Date(clock.t).toISOString());
    expect(runs.getRun(db, id)!.heartbeat).not.toBe(hb0);
    clock.t += 15_000;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(readHealth().workerAt).toBe(new Date(clock.t).toISOString());
    release.resolve();
    await worker.stop();
  });

  it('a handler that returns while the run is still running stops it with scan-failed', async () => {
    const db = mem(); const clock = fakeClock();
    const id = runs.enqueue(db, scan, 's1', null, clock.now());
    const returned = deferred();
    const worker = runWorker({ db, clock, workerId: 'w1', idleMs: 1_000_000, health, handlers: { scan: async () => { returned.resolve(); }, produce: ok, prepare: ok, edit: ok } });
    await returned.promise;
    await worker.stop();
    expect(runs.getRun(db, id)).toMatchObject({ state: 'stopped', reason: 'scan-failed' });
  });

  it('a claim that throws once is logged and the loop claims on the next tick', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const real = mem(); const clock = fakeClock();
    runs.enqueue(real, scan, 's1', null, clock.now());
    let thrown = false;
    const db = new Proxy(real, {
      get(target, prop) {
        const v = Reflect.get(target, prop, target);
        if (prop === 'exec') return (sql: string) => { if (!thrown && sql.startsWith('BEGIN')) { thrown = true; throw new Error('database is locked'); } return target.exec(sql); };
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const claimed = deferred();
    const worker = runWorker({ db, clock, workerId: 'w1', idleMs: 1000, health, handlers: { scan: async (run) => { runs.finish(real, run.id, { kind: 'scan', checked: 0, aboveThreshold: 0, prepared: 0 }, clock.now()); claimed.resolve(); }, produce: ok, prepare: ok, edit: ok } });
    await vi.advanceTimersByTimeAsync(1000);
    await claimed.promise;
    await worker.stop();
    expect(spy.mock.calls.flat().join(' ')).toContain('database is locked');
    spy.mockRestore();
  });

  it('logs the handler error with the run id', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = mem(); const clock = fakeClock();
    const id = runs.enqueue(db, scan, 's1', null, clock.now());
    const thrown = deferred();
    const worker = runWorker({ db, clock, workerId: 'w1', idleMs: 1_000_000, health, handlers: { scan: async () => { thrown.resolve(); throw new Error('kaboom'); }, produce: ok, prepare: ok, edit: ok } });
    await thrown.promise;
    await worker.stop();
    const out = spy.mock.calls.flat().join(' ');
    expect(out).toContain(id);
    expect(out).toContain('kaboom');
    spy.mockRestore();
  });

  it('stop() clears the timers even when every iteration fails', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = mem();
    const clock: Clock = { now() { throw new Error('clock broke'); } };
    const worker = runWorker({ db, clock, workerId: 'w1', idleMs: 1000, health, handlers: { scan: ok, produce: ok, prepare: ok, edit: ok } });
    await vi.advanceTimersByTimeAsync(2500);
    await worker.stop();
    expect(vi.getTimerCount()).toBe(0);
    spy.mockRestore();
  });
  describe('after a takeover the loop leaves the new owner\'s run alone', () => {
    const takeover = (db: ReturnType<typeof mem>, id: string, t: number) =>
      db.prepare(`UPDATE runs SET claimed_by = 'B', heartbeat = ?, updated_at = ? WHERE id = ?`).run(new Date(t).toISOString(), new Date(t).toISOString(), id);
    for (const how of ['returns', 'throws'] as const) {
      it(`A's handler ${how} after B took the run`, async () => {
        const db = mem(); const clock = fakeClock();
        const id = runs.enqueue(db, scan, 's1', null, clock.now());
        const inside = deferred(); const release = deferred();
        const worker = runWorker({
          db, clock, workerId: 'A', idleMs: 1_000_000, health,
          handlers: { scan: async () => { inside.resolve(); await release.promise; takeover(db, id, clock.t); if (how === 'throws') throw new Error('late'); }, produce: ok, prepare: ok, edit: ok },
        });
        await inside.promise;
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        release.resolve();
        await worker.stop();
        spy.mockRestore();
        expect(runs.getRun(db, id)).toMatchObject({ state: 'running', claimedBy: 'B' });
      });
    }
  });

  describe('lanes: several runs at once', () => {
    const prepare = (n: number): RunInput => ({ kind: 'prepare', templateId: `t${n}`, ownerId: null, from: { kind: 'candidate', candidateId: `c${n}`, force: false } });
    const produce: RunInput = { kind: 'produce', templateId: 't1', quality: 'fast', variants: 1, language: 'en', products: [], sample: false };
    const prepared = { kind: 'prepare', state: 'ready', note: null } as const;
    const settle = (check: () => boolean) => vi.waitFor(() => { if (!check()) throw new Error('not yet'); }, { timeout: 2000, interval: 5 });
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const stateOf = (db: ReturnType<typeof mem>, id: string) => runs.getRun(db, id)?.state;
    const none = { scan: ok, produce: ok, prepare: ok, edit: ok };

    it('a prepare lane of 4 with 10 prepare runs queued: at most 4 handlers run at once and all 10 finish', async () => {
      const db = mem(); const clock = fakeClock();
      const ids = Array.from({ length: 10 }, (_, n) => runs.enqueue(db, prepare(n), `t${n}`, null, new Date(clock.t + n)));
      let inside = 0, most = 0; const gate = deferred();
      const worker = runWorker({
        db, clock, workerId: 'w1', idleMs: 10, health, lanes: [{ kinds: ['prepare'], size: 4 }],
        handlers: { ...none, prepare: async (run) => {
          inside++; most = Math.max(most, inside);
          await gate.promise; await pause(2);
          runs.finish(db, run.id, prepared, clock.now()); inside--;
        } },
      });
      await settle(() => inside === 4);
      await pause(40);                                                                       // the four slots are busy: nothing more starts
      expect(inside).toBe(4);
      expect(ids.filter((id) => stateOf(db, id) === 'queued')).toHaveLength(6);
      gate.resolve();
      await settle(() => ids.every((id) => stateOf(db, id) === 'done'));
      await worker.stop();
      expect(most).toBe(4);
    });

    it('the produce lane is one wide: two produce runs never run at once, while the prepare lane works next to it', async () => {
      const db = mem(); const clock = fakeClock();
      const p1 = runs.enqueue(db, produce, 'job1', null, clock.now());
      const p2 = runs.enqueue(db, produce, 'job2', null, new Date(clock.t + 1));
      const others = [0, 1].map((n) => runs.enqueue(db, prepare(n), `t${n}`, null, new Date(clock.t + 2 + n)));
      let producing = 0, mostProducing = 0, preparing = 0; const gate = deferred();
      const worker = runWorker({
        db, clock, workerId: 'w1', idleMs: 10, health, lanes: [{ kinds: ['prepare'], size: 2 }, { kinds: ['produce'], size: 1 }],
        handlers: {
          ...none,
          produce: async (run) => {
            producing++; mostProducing = Math.max(mostProducing, producing);
            await gate.promise; await pause(2);
            runs.finish(db, run.id, { kind: 'produce', variants: [] }, clock.now()); producing--;
          },
          prepare: async (run) => { preparing++; await gate.promise; runs.finish(db, run.id, prepared, clock.now()); },
        },
      });
      await settle(() => producing === 1 && preparing === 2);
      await pause(40);
      expect(producing).toBe(1);
      expect([stateOf(db, p1), stateOf(db, p2)]).toEqual(['running', 'queued']);
      gate.resolve();
      await settle(() => [p1, p2, ...others].every((id) => stateOf(db, id) === 'done'));
      await worker.stop();
      expect(mostProducing).toBe(1);
    });

    it('a lane takes only its kinds: a run of a kind no lane has stays queued', async () => {
      const db = mem(); const clock = fakeClock();
      const s = runs.enqueue(db, scan, 's1', null, clock.now());
      const p = runs.enqueue(db, prepare(0), 't0', null, new Date(clock.t + 1));
      const worker = runWorker({
        db, clock, workerId: 'w1', idleMs: 10, health, lanes: [{ kinds: ['prepare'], size: 2 }],
        handlers: { ...none, prepare: async (run) => { runs.finish(db, run.id, prepared, clock.now()); } },
      });
      await settle(() => stateOf(db, p) === 'done');
      await pause(40);
      await worker.stop();
      expect(stateOf(db, s)).toBe('queued');
    });

    it('each slot is its own owner: when another slot takes over a run whose heartbeat went stale, the first slot\'s writes are refused', async () => {
      const db = mem(); const clock = fakeClock();
      const a = runs.enqueue(db, prepare(0), 't0', null, clock.now());
      const b = runs.enqueue(db, prepare(1), 't1', null, new Date(clock.t + 1));
      const owners = new Map<string, string | null>(); const late = deferred(); const free = deferred();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        let finished: boolean | null = null;
        const worker = runWorker({
          db, clock, workerId: 'w1', idleMs: 1_000_000, health, lanes: [{ kinds: ['prepare'], size: 2 }],
          handlers: { ...none, prepare: async (run) => {
            owners.set(run.id, run.claimedBy);
            if (run.id === b) { await free.promise; runs.finish(db, run.id, prepared, clock.now()); return; }
            await late.promise;
            finished = runs.finish(db, run.id, prepared, clock.now());
          } },
        });
        await settle(() => owners.size === 2);
        const slotA = owners.get(a)!, slotB = owners.get(b)!;
        expect(slotA).toMatch(/^w1#\d+$/);
        expect(slotB).toMatch(/^w1#\d+$/);
        expect(slotB).not.toBe(slotA);
        free.resolve();
        await settle(() => stateOf(db, b) === 'done');
        // A's slot stood still for more than 60 s and the other slot, free again, took its run over
        expect(runs.claim(db, slotB, new Date(clock.t + runs.STALE_MS + 1000), ['prepare'])).toMatchObject({ id: a, claimedBy: slotB, takeovers: 1 });
        late.resolve();
        await worker.stop();
        expect(finished).toBe(false);
        expect(runs.getRun(db, a)).toMatchObject({ state: 'running', claimedBy: slotB });
        expect(errors.mock.calls.flat().join('\n')).toContain(`run ${a}: not-owner`);
      } finally { errors.mockRestore(); }
    });

    it('an idle slot does not take over a run its own worker still runs: the whole worker standing still (a sleep) is not the death of a slot', async () => {
      const db = mem(); const clock = fakeClock();
      const a = runs.enqueue(db, prepare(0), 't0', null, clock.now());
      let calls = 0; const started = deferred(); const release = deferred();
      const worker = runWorker({
        db, clock, workerId: 'w1', idleMs: 10, health, lanes: [{ kinds: ['prepare'], size: 2 }],
        handlers: { ...none, prepare: async (run) => { calls++; started.resolve(); await release.promise; runs.finish(db, run.id, prepared, clock.now()); } },
      });
      await started.promise;
      const holder = runs.getRun(db, a)!.claimedBy;
      clock.t += runs.STALE_MS + 5000;                                                       // no beat for more than 60 s: the 15 s timer did not fire
      await settle(() => runs.getRun(db, a)!.heartbeat === new Date(clock.t).toISOString());  // the idle slot looked for work
      await pause(40);
      expect(calls).toBe(1);
      expect(runs.getRun(db, a)).toMatchObject({ state: 'running', claimedBy: holder, takeovers: 0 });
      release.resolve();
      await worker.stop();
      expect(stateOf(db, a)).toBe('done');
    });

    it('a beat for the runs of the other slots that fails: that turn claims nothing, so a run of its own worker is not taken over (K1)', async () => {
      const real = mem(); const clock = fakeClock();
      const a = runs.enqueue(real, prepare(0), 't0', null, clock.now());
      let armed = false, thrown = 0;
      const db = new Proxy(real, {
        get(target, prop) {
          const v = Reflect.get(target, prop, target);
          if (prop === 'prepare') return (sql: string) => {
            if (armed && thrown === 0 && sql.startsWith('UPDATE runs SET heartbeat')) return { run: () => { thrown++; throw new Error('database is locked'); } };
            return target.prepare(sql);
          };
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        let calls = 0; const started = deferred(); const release = deferred();
        const worker = runWorker({
          db, clock, workerId: 'w1', idleMs: 10, health, lanes: [{ kinds: ['prepare'], size: 2 }],
          handlers: { ...none, prepare: async (run) => { calls++; started.resolve(); await release.promise; runs.finish(real, run.id, prepared, clock.now()); } },
        });
        await started.promise;
        armed = true;
        clock.t += runs.STALE_MS + 5000;                                                     // the whole worker stood still, the 15 s timer did not fire
        await settle(() => thrown === 1);
        await settle(() => runs.getRun(real, a)!.heartbeat === new Date(clock.t).toISOString());   // the next turn's beat went through
        await pause(40);
        expect(calls).toBe(1);
        expect(runs.getRun(real, a)).toMatchObject({ state: 'running', takeovers: 0 });
        release.resolve();
        await worker.stop();
        expect(stateOf(real, a)).toBe('done');
      } finally { errors.mockRestore(); }
    });

    it('a lane of 8 with one run: the idle slots write that run\'s beat only when it is older than 15 s, not at every turn (K2)', async () => {
      const real = mem(); const clock = fakeClock();
      const a = runs.enqueue(real, prepare(0), 't0', null, clock.now());
      let beats = 0;
      const db = new Proxy(real, {
        get(target, prop) {
          const v = Reflect.get(target, prop, target);
          if (prop === 'prepare') return (sql: string) => { if (sql.startsWith('UPDATE runs SET heartbeat')) beats++; return target.prepare(sql); };
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
      const started = deferred(); const release = deferred();
      const worker = runWorker({
        db, clock, workerId: 'w1', idleMs: 5, health, lanes: [{ kinds: ['prepare'], size: 8 }],
        handlers: { ...none, prepare: async (run) => { started.resolve(); await release.promise; runs.finish(real, run.id, prepared, clock.now()); } },
      });
      await started.promise;
      await pause(100);                                                                      // some ten turns of the seven idle slots
      expect(beats).toBe(0);                                                                 // the clock stood at the claim: the beat is fresh
      clock.t += 16_000;
      await settle(() => beats > 0);
      await pause(100);
      expect(beats).toBeLessThanOrEqual(1);                                                  // one write refreshes it for every slot's next turns
      expect(runs.getRun(real, a)!.heartbeat).toBe(new Date(clock.t).toISOString());
      release.resolve();
      await worker.stop();
    });

    it('handBack() gives back every running run at once, one per busy slot, and claims nothing more', async () => {
      const db = mem(); const clock = fakeClock();
      const running = [
        runs.enqueue(db, prepare(0), 't0', null, clock.now()),
        runs.enqueue(db, prepare(1), 't1', null, new Date(clock.t + 1)),
        runs.enqueue(db, produce, 'job1', null, new Date(clock.t + 2)),
        runs.enqueue(db, scan, 's1', null, new Date(clock.t + 3)),
      ];
      const waiting = runs.enqueue(db, prepare(2), 't2', null, new Date(clock.t + 4));
      let started = 0; const killed = deferred();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const dies = async (run: runs.RunRow) => {
          started++;
          await killed.promise;                                                              // every child dies with the signal
          runs.stop(db, run.id, 'engine-error', null, clock.now());
          throw new Error('the child exited -1');
        };
        const worker = runWorker({
          db, clock, workerId: 'w1', idleMs: 10, health, handlers: { scan: dies, produce: dies, prepare: dies, edit: dies },
          lanes: [{ kinds: ['prepare'], size: 2 }, { kinds: ['produce'], size: 1 }, { kinds: ['scan', 'edit'], size: 1 }],
        });
        await settle(() => started === 4);
        worker.handBack();
        for (const id of running) expect(runs.getRun(db, id)).toMatchObject({ state: 'running', claimedBy: null, heartbeat: null });
        killed.resolve();
        await worker.stop();
        for (const id of running) {
          expect(runs.getRun(db, id)).toMatchObject({ state: 'running', claimedBy: null, heartbeat: null, takeovers: 0 });
          expect(errors.mock.calls.flat().join('\n')).toContain(`run ${id} handed back`);
        }
        expect(started).toBe(4);
        expect(stateOf(db, waiting)).toBe('queued');
      } finally { errors.mockRestore(); }
    });

    it('stop() waits for the handler of every busy slot', async () => {
      const db = mem(); const clock = fakeClock();
      const ids = [0, 1].map((n) => runs.enqueue(db, prepare(n), `t${n}`, null, new Date(clock.t + n)));
      let inside = 0; const gates = [deferred(), deferred()];
      const worker = runWorker({
        db, clock, workerId: 'w1', idleMs: 1_000_000, health, lanes: [{ kinds: ['prepare'], size: 2 }],
        handlers: { ...none, prepare: async (run) => { inside++; await gates[ids.indexOf(run.id)]!.promise; runs.finish(db, run.id, prepared, clock.now()); } },
      });
      await settle(() => inside === 2);
      let stopped = false;
      const stopping = worker.stop().then(() => { stopped = true; });
      gates[0]!.resolve();
      await settle(() => stateOf(db, ids[0]!) === 'done');
      await pause(20);
      expect(stopped).toBe(false);
      gates[1]!.resolve();
      await stopping;
      expect(ids.map((id) => stateOf(db, id))).toEqual(['done', 'done']);
    });

    it('a produce lane of 3: handBack() gives the three videos back at once, and the next worker takes all three over before a waiting video, without the 60 s wait and at no cost to their takeovers', async () => {
      const db = mem(); const clock = fakeClock();
      const of = (ownerId: string): RunInput => ({ ...produce, ownerId });
      const made = ['u1', 'u1', 'u2'].map((owner, n) => runs.enqueue(db, of(owner), `job${n}`, null, new Date(clock.t + n)));
      let started = 0; const killed = deferred();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const first = runWorker({
          db, clock, workerId: 'w1', idleMs: 10, health, lanes: [{ kinds: ['produce'], size: 3 }],
          handlers: { ...none, produce: async () => { started++; await killed.promise; throw new Error('the child exited -1'); } },
        });
        await settle(() => started === 3);
        const waiting = runs.enqueue(db, of('u3'), 'job3', null, new Date(clock.t - 1000));     // older than the three, of a customer with nothing running
        first.handBack();
        killed.resolve();
        await first.stop();
        for (const id of made) expect(runs.getRun(db, id)).toMatchObject({ state: 'running', claimedBy: null, heartbeat: null });

        clock.t += 1000;                                                                       // a second later, not a minute
        const taken = new Map<string, string | null>(); const open = deferred();
        const second = runWorker({
          db, clock, workerId: 'w2', idleMs: 10, health, lanes: [{ kinds: ['produce'], size: 3 }],
          handlers: { ...none, produce: async (run) => { taken.set(run.id, run.claimedBy); await open.promise; runs.finish(db, run.id, { kind: 'produce', variants: [] }, clock.now()); } },
        });
        await settle(() => taken.size === 3);
        await pause(40);
        expect([...taken.keys()].sort()).toEqual([...made].sort());
        expect(new Set(taken.values()).size).toBe(3);                                          // three slots, three owners: no video is made twice
        for (const id of made) expect(runs.getRun(db, id)).toMatchObject({ state: 'running', takeovers: 0 });
        expect(stateOf(db, waiting)).toBe('queued');
        open.resolve();
        await settle(() => [...made, waiting].every((id) => stateOf(db, id) === 'done'));
        await second.stop();
      } finally { errors.mockRestore(); }
    });

    it('a produce lane of 2 with one video: the idle slot does not take over the video its own worker still makes, also when the whole worker stood still for more than 60 s', async () => {
      const db = mem(); const clock = fakeClock();
      const a = runs.enqueue(db, { ...produce, ownerId: 'u1' }, 'job1', null, clock.now());
      let calls = 0; const started = deferred(); const release = deferred();
      const worker = runWorker({
        db, clock, workerId: 'w1', idleMs: 10, health, lanes: [{ kinds: ['produce'], size: 2 }],
        handlers: { ...none, produce: async (run) => { calls++; started.resolve(); await release.promise; runs.finish(db, run.id, { kind: 'produce', variants: [] }, clock.now()); } },
      });
      await started.promise;
      const holder = runs.getRun(db, a)!.claimedBy;
      clock.t += runs.STALE_MS + 5000;
      await settle(() => runs.getRun(db, a)!.heartbeat === new Date(clock.t).toISOString());
      await pause(40);
      expect(calls).toBe(1);
      expect(runs.getRun(db, a)).toMatchObject({ state: 'running', claimedBy: holder, takeovers: 0 });
      release.resolve();
      await worker.stop();
      expect(stateOf(db, a)).toBe('done');
    });

    it('without lanes it is one run at a time, of any kind, claimed under the worker id itself', async () => {
      const db = mem(); const clock = fakeClock();
      const ids = [
        runs.enqueue(db, produce, 'job1', null, clock.now()),
        runs.enqueue(db, prepare(0), 't0', null, new Date(clock.t + 1)),
        runs.enqueue(db, scan, 's1', null, new Date(clock.t + 2)),
      ];
      let inside = 0, most = 0; const owners: (string | null)[] = [];
      const one = async (run: runs.RunRow) => {
        inside++; most = Math.max(most, inside); owners.push(run.claimedBy);
        await pause(5);
        runs.stop(db, run.id, 'engine-error', null, clock.now()); inside--;
      };
      const worker = runWorker({ db, clock, workerId: 'w1', idleMs: 10, health, handlers: { scan: one, produce: one, prepare: one, edit: one } });
      await settle(() => ids.every((id) => stateOf(db, id) === 'stopped'));
      await worker.stop();
      expect(most).toBe(1);
      expect(owners).toEqual(['w1', 'w1', 'w1']);
    });
  });
});
