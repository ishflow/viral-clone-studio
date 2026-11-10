import type { DatabaseSync } from 'node:sqlite';
import type { Health, RunInput } from '../contracts.ts';
import type { Clock } from '../ports.ts';
import { asOwner, beat, claim, failureCode, getRun, release, stop } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import { writeHealth } from '../db/settings.ts';

export const BEAT_MS = 15_000;
export const HEALTH_MS = 30_000;

/** `size` runs of these `kinds` at once. Without `kinds`: of any kind. */
export interface Lane { kinds?: readonly RunInput['kind'][]; size: number }

export interface WorkerDeps {
  db: DatabaseSync;
  handlers: Record<RunInput['kind'], (run: RunRow) => Promise<void>>;
  clock: Clock;
  workerId: string;
  idleMs: number;
  health: () => Promise<Pick<Health, 'provider' | 'renderer' | 'note' | 'noCredits' | 'swap' | 'swapNote'>>;
  /** Without it: one run at a time, of any kind, claimed as `workerId`. */
  lanes?: readonly Lane[];
}

interface Slot { loop: Promise<void>; wake(): void; clearIdle(): void; handBack(): void; alive(): boolean }

/**
 * Claims one run at a time, runs its handler, beats every 15 s, writes `health` every 30 s. The handler runs `asOwner`: once the
 * run is not this worker's any more (taken over, handed back), its writes of the run change nothing.
 * With `lanes` it is one such loop per slot: a lane of size n has n slots, each claims only the lane's kinds and holds its run as
 * `<workerId>#<slot>`, so that two slots of one worker are two owners and a run one of them lost is not the other's to write.
 * - `stop()`: claims nothing more and waits for the running handlers.
 * - `handBack()`: claims nothing more and gives every running run back at once (unclaimed, claimable by the next worker without
 *   the 60 s wait); the handlers are left to unwind, and nothing they write after that reaches the runs. For a shutdown.
 */
export function runWorker(deps: WorkerDeps): { stop(): Promise<void>; handBack(): void } {
  const { db, handlers, clock, workerId, idleMs } = deps;
  let stopping = false;

  const writeHealthNow = async () => {
    try {
      const h = await deps.health();
      writeHealth(db, { workerAt: clock.now().toISOString(), provider: h.provider, renderer: h.renderer, note: h.note, noCredits: h.noCredits ?? null, ...(h.swap ? { swap: h.swap } : {}), ...(h.swapNote ? { swapNote: h.swapNote } : {}) });
    } catch { /* the next tick tries again */ }
  };

  const log = (what: string, e: unknown) => console.error(`${what}: ${e instanceof Error ? e.message : String(e)}`);

  const healthTimer = setInterval(() => { void writeHealthNow(); }, HEALTH_MS);
  healthTimer.unref?.();
  const healthWritten = writeHealthNow();

  const slots: Slot[] = [];

  /** One slot: the loop that claims as `owner`, of `kinds` only when given. */
  const startSlot = (owner: string, kinds: Lane['kinds']): Slot => {
    let wake: (() => void) | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let current: RunRow | null = null;
    let handedBack: string | null = null;
    let beatAt = 0;                                                                          // when the run this slot holds last got its beat (ms)

    /** The beat of `run`, remembered when it went through. */
    const beatNow = (run: RunRow) => { const at = clock.now(); beat(db, run.id, at); beatAt = at.getTime(); };

    const idle = () => new Promise<void>((resolve) => {
      wake = resolve;
      idleTimer = setTimeout(resolve, idleMs);
    });

    /** Still running AND still claimed by this slot: after a takeover the run is another worker's. */
    const ownRunning = (id: string) => { const r = getRun(db, id); return r?.state === 'running' && r.claimedBy === owner; };

    const execute = (run: RunRow) => asOwner({ runId: run.id, workerId: owner, refused: null }, async () => {
      const timer = setInterval(() => { try { beatNow(run); } catch (e) { log(`beat failed for run ${run.id}`, e); } }, BEAT_MS);
      try {
        await handlers[run.kind](run);
      } catch (e) {
        log(`handler failed for ${run.kind} run ${run.id}`, e);
        try { if (ownRunning(run.id)) stop(db, run.id, run.kind === 'scan' ? 'scan-failed' : 'engine-error', null, clock.now(), failureCode(e)); } catch (e2) { log(`stop failed for run ${run.id}`, e2); }
      } finally {
        clearInterval(timer);
      }
      // A handler that returned without finishing or stopping the run must not leave it to a takeover.
      try {
        if (ownRunning(run.id)) stop(db, run.id, run.kind === 'scan' ? 'scan-failed' : 'engine-error', null, clock.now(), 'handler-incomplete');
      } catch (e) { log(`stop failed for run ${run.id}`, e); }
      // Lost while the handler ran (taken over by another worker): say so, coded; what the handler wrote after that was refused.
      try {
        const now = getRun(db, run.id);
        if (handedBack !== run.id && now !== null && now.claimedBy !== owner) {
          console.error(`run ${run.id}: not-owner: ${now.claimedBy ?? 'nobody'} holds it now; this worker's writes after the takeover were refused`);
        }
      } catch (e) { log(`check failed for run ${run.id}`, e); }
    });

    const loop = (async () => {
      await healthWritten;
      while (!stopping) {
        let run: RunRow | null = null;
        try {
          // A slot that looks for work proves the worker alive: the runs of the other slots get their beat first, so that the whole
          // worker standing still for a minute (a sleep) is not taken for their death and a slot does not take over a run of its own worker.
          // A beat that could not be written means this turn does not know that the others are alive: it claims nothing.
          let allAlive = true;
          for (const slot of slots) if (!slot.alive()) allAlive = false;
          if (allAlive) {
            const at = clock.now();
            run = claim(db, owner, at, kinds);
            current = run;
            if (run) { beatAt = at.getTime(); await execute(run); }
          }
        } catch (e) {
          log(run ? `run ${run.id} failed` : 'claim failed', e);
          run = null;
        }
        current = null;
        if (run) continue;
        await idle();
        if (idleTimer) clearTimeout(idleTimer);
        wake = null;
      }
    })();

    return {
      loop,
      wake() { wake?.(); },
      clearIdle() { if (idleTimer) clearTimeout(idleTimer); },
      /** Whether the run this slot holds (if any) has a beat of the last 15 s: false when the write failed. */
      alive() {
        const run = current;
        if (run === null || clock.now().getTime() - beatAt < BEAT_MS) return true;          // a fresh beat is not written again
        try { asOwner({ runId: run.id, workerId: owner, refused: null }, () => beatNow(run)); return true; } catch (e) { log(`beat failed for run ${run.id}`, e); return false; }
      },
      handBack() {
        const run = current;
        if (run === null || handedBack === run.id) return;
        try {
          if (release(db, run.id, owner, clock.now())) { handedBack = run.id; console.error(`run ${run.id} handed back`); }
        } catch (e) { log(`hand-back failed for run ${run.id}`, e); }
      },
    };
  };

  if (deps.lanes === undefined) slots.push(startSlot(workerId, undefined));
  else for (const lane of deps.lanes) for (let n = 0; n < lane.size; n++) slots.push(startSlot(`${workerId}#${slots.length}`, lane.kinds));

  return {
    handBack() {
      stopping = true;
      for (const slot of slots) { slot.wake(); slot.handBack(); }
    },
    async stop() {
      stopping = true;
      for (const slot of slots) slot.wake();
      try {
        await Promise.all(slots.map((slot) => slot.loop));
      } finally {
        clearInterval(healthTimer);
        for (const slot of slots) slot.clearIdle();
      }
    },
  };
}
