// What the site shows of a run while it goes on: the six steps, counted over all variants, and the state of each
// variant. Every change is written at once (`runs.steps`, `runs.variants`).
import type { DatabaseSync } from 'node:sqlite';
import type { Step, StepKey, StepStatus, StopReason, VariantState } from '../contracts.ts';
import type { Clock } from '../ports.ts';
import { ownSteps, ownVariants } from './rows.ts';

export const STEPS: StepKey[] = ['adaptation', 'images', 'clips', 'music', 'edit', 'render'];

export interface Board {
  /** `count` pieces of the step are under way (waiting for a place in the pool counts). */
  begin(step: StepKey, count?: number): void;
  /** `count` pieces of it ended; `finished`: they count as done. */
  end(step: StepKey, finished: boolean, count?: number): void;
  /** A finished piece of the step does not count after all (a paid file that was refused later): it is to do again. */
  lose(step: StepKey): void;
  /** A variant stopped in this step. */
  stopIn(step: StepKey): void;
  /**
   * The run stops: nothing is under way any more, and every variant that is not done is stopped (one that stopped on
   * its own keeps its reason). Writes the steps and the variants whatever was written before: a write that failed
   * earlier must not leave the database behind what this board knows.
   */
  close(reason: StopReason): void;
  variant(n: number, patch: Partial<Omit<VariantState, 'n'>>): void;
  variants(): VariantState[];
}

/**
 * `counts`: for each step, what it has to do over all variants and what is done already (an earlier call of the handler).
 * A step is `done` when all of it is done, `running` while any of it is under way, `stopped` when a variant stopped
 * in it and nothing of it is under way, else `waiting`. Every write is guarded: only the worker that holds the run changes it.
 */
export interface BoardOwner {
  db: DatabaseSync; runId: string; clock: Clock;
  claimedBy: string | null;                 // the worker this call of the handler runs for
  lost: () => void;                         // called when a write changed nothing: the run is not running for this worker any more
}

export function createBoard(owner: BoardOwner, counts: Record<StepKey, { total: number; done: number }>, variants: VariantState[]): Board {
  const { db, runId, clock, claimedBy, lost } = owner;
  const state = Object.fromEntries(STEPS.map((key) => [key, { ...counts[key], active: 0, stopped: false }])) as Record<StepKey, { total: number; done: number; active: number; stopped: boolean }>;
  const list = variants.map((variant) => ({ ...variant }));
  const statusOf = (key: StepKey): StepStatus => {
    const step = state[key];
    return step.done >= step.total ? 'done' : step.active > 0 ? 'running' : step.stopped ? 'stopped' : 'waiting';
  };
  const writeSteps = () => { if (!ownSteps(db, runId, claimedBy, STEPS.map((key): Step => ({ key, status: statusOf(key), done: state[key].done, total: state[key].total })), clock.now())) lost(); };
  const writeVariants = () => { if (!ownVariants(db, runId, claimedBy, list, clock.now())) lost(); };
  writeSteps();
  writeVariants();
  return {
    begin(step, count = 1) { state[step].active += count; writeSteps(); },
    end(step, finished, count = 1) { state[step].active -= count; if (finished) state[step].done += count; writeSteps(); },
    lose(step) { state[step].done -= 1; writeSteps(); },
    stopIn(step) { state[step].stopped = true; writeSteps(); },
    close(reason) {
      for (const key of STEPS) state[key].active = 0;
      list.forEach((variant, at) => { if (variant.status !== 'done' && variant.status !== 'stopped') list[at] = { ...variant, status: 'stopped', reason }; });
      writeSteps();
      writeVariants();
    },
    variant(n, patch) {
      const at = list.findIndex((variant) => variant.n === n);
      if (at < 0) return;
      list[at] = { ...list[at]!, ...patch };
      writeVariants();
    },
    variants: () => list.map((variant) => ({ ...variant })),
  };
}
