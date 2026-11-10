import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { RunInput } from '../contracts.ts';
import type { Clock } from '../ports.ts';
import { openDb } from '../db/open.ts';
import type { RunRow } from '../db/runs.ts';
import { editHandler, prepareHandler } from '../prepare/index.ts';
import { produceHandler } from '../produce/index.ts';
import { scanHandler } from '../scan/index.ts';
import { swapEditHandler } from '../swap/edit.ts';
import { swapHandler } from '../swap/index.ts';
import { swapPrepareHandler } from '../swap/prepare.ts';
import { startBudgetSweep } from './budget-sweep.ts';
import { runWorker } from './loop.ts';
import type { Lane } from './loop.ts';
import { buildParts } from './parts.ts';
import type { Parts } from './parts.ts';
import { startSchedule } from './schedule.ts';

const systemClock: Clock = { now: () => new Date() };
const SCHEDULE_EVERY_MS = 30_000;
/** After SIGINT / SIGTERM, how long the loop gets to unwind before the process exits anyway. */
export const GRACE_MS = 10_000;
/** The most inspections one worker runs at once. */
export const PREPARE_LANE_MAX = 16;
/** The most videos (produce runs) one worker makes at once. */
export const PRODUCE_LANE_MAX = 6;

type Handlers = Record<RunInput['kind'], (run: RunRow) => Promise<void>>;

/**
 * The four real handlers over the parts. Produce is rebuilt per run so a late-ready aligner is picked up. A produce run that carries
 * the photographs of people is a person swap: the same row, queue and money, made by a handler of its own. A prepare run that says
 * `mode: 'swap'` makes the template of one, by a handler of its own too; so does an edit run that carries the people of one.
 */
export function realHandlers(parts: Parts): Handlers {
  const prepare = prepareHandler(parts.prepareDeps);
  const edit = editHandler(parts.editDeps);
  const scan = scanHandler(parts.scanDeps);
  const swap = swapHandler(parts.swapDeps);
  const swapPrepare = swapPrepareHandler(parts.prepareDeps);
  const swapEdit = swapEditHandler(parts.editDeps);
  return {
    produce: (run) => (run.input.kind === 'produce' && run.input.swap !== undefined ? swap(run) : produceHandler(parts.produceDeps())(run)),
    prepare: (run) => (run.input.kind === 'prepare' && run.input.mode === 'swap' ? swapPrepare(run) : prepare(run)),
    edit: (run) => (run.input.kind === 'edit' && run.input.swap !== undefined ? swapEdit(run) : edit(run)),
    scan,
  };
}

/** How wide a lane is: `name` from the environment, a plain whole number from 1 to `max`. Unset or empty: 1. Any other value is an error. */
function laneSize(env: NodeJS.ProcessEnv, name: string, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return 1;
  const size = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || size > max) throw new Error(`${name} must be a whole number from 1 to ${max}, got "${raw}"`);
  return size;
}

/**
 * The lanes of the worker, from `VC_WORKER_PREPARE` (how many inspections, prepare runs, it runs at once) and `VC_WORKER_PRODUCE`
 * (how many videos, produce runs, it makes at once). Both unset or 1: no lanes, one run at a time of any kind, as before. One of
 * them from 2 on: that many inspections, next to that many produce runs and one scan or edit. Any other value is an error at start.
 */
export function lanesFrom(env: NodeJS.ProcessEnv): Lane[] | undefined {
  const prepare = laneSize(env, 'VC_WORKER_PREPARE', PREPARE_LANE_MAX);
  const produce = laneSize(env, 'VC_WORKER_PRODUCE', PRODUCE_LANE_MAX);
  if (prepare === 1 && produce === 1) return undefined;
  return [{ kinds: ['prepare'], size: prepare }, { kinds: ['produce'], size: produce }, { kinds: ['scan', 'edit'], size: 1 }];
}

/** `overrides` is for tests: ready-made parts or handlers in place of the ones built from the environment. */
export function start(db: DatabaseSync = openDb(), overrides: { parts?: Parts; handlers?: Handlers; idleMs?: number } = {}): { stop(): Promise<void>; handBack(): void } {
  const lanes = lanesFrom(process.env);
  const parts = overrides.parts ?? buildParts(process.env, db, systemClock);
  const schedule = startSchedule({ db, clock: systemClock, everyMs: SCHEDULE_EVERY_MS });
  const sweep = startBudgetSweep({ db, everyMs: SCHEDULE_EVERY_MS });
  const worker = runWorker({
    db, handlers: overrides.handlers ?? realHandlers(parts), clock: systemClock, idleMs: overrides.idleMs ?? 2000,
    workerId: `worker-${process.pid}-${randomBytes(4).toString('hex')}`,   // two containers can share a pid
    health: () => parts.health(),
    lanes,
  });
  return { async stop() { schedule.stop(); sweep.stop(); await worker.stop(); }, handBack() { schedule.stop(); sweep.stop(); worker.handBack(); } };
}

/**
 * SIGINT / SIGTERM (a service stop or restart): every running run is handed back at once, then the process exits 0 when the loop
 * has unwound, or after `graceMs` at the latest. exec.ts ends every killGroup child (a render) on the same signal, so the job could
 * not finish anyway; handed back, the next worker takes the run at once instead of stopping it as engine-error. SIGKILL: unchanged,
 * the run is taken over once its heartbeat is 60 s old.
 */
export function exitOnSignals(worker: { stop(): Promise<void>; handBack(): void }, graceMs = GRACE_MS): void {
  const shutdown = () => {
    worker.handBack();
    const grace = new Promise<void>((resolve) => { setTimeout(resolve, graceMs).unref(); });
    void Promise.race([worker.stop(), grace]).then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (import.meta.main) exitOnSignals(start());
