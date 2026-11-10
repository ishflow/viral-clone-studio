// The provider budget of runs that can spend nothing more (done, closed) is given back while the worker is up: the site closes a job
// without touching the budget, and a closed job's unused reservation would hold its day's cap for nothing.
import type { DatabaseSync } from 'node:sqlite';
import { releaseTerminal } from '../robust/provider-budget.ts';

export function startBudgetSweep(deps: { db: DatabaseSync; everyMs: number }): { stop(): void } {
  const tick = () => {
    try { releaseTerminal(deps.db); } catch (e) { console.error(`budget sweep failed: ${e instanceof Error ? e.message : String(e)}`); }
  };
  tick();
  const timer = setInterval(tick, deps.everyMs);
  timer.unref?.();
  return { stop() { clearInterval(timer); } };
}
