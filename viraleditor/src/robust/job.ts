// A job for the worker tests (C6 cases 2 and 6): one paid step that must never be sent twice, then a render, then the result.
import { appendFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { beginOwnOperation, endOperation, finish, holds } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import type { Clock, Renderer } from '../ports.ts';

export interface JobDeps { db: DatabaseSync; clock: Clock; renderer: Pick<Renderer, 'render'>; composition: string; out: string; log: string; who: string }

/**
 * The handler: `paid <who>` and `render <who> <run>` lines in `log` for every step that really ran. The video is rendered to
 * `<out>/<run id>.part.mp4` and moved to `<out>/<run id>.mp4` only while this worker still holds the run (FINDING 8): a worker that
 * lost the run publishes nothing.
 */
export function job(deps: JobDeps): (run: RunRow) => Promise<void> {
  const { db, clock, log, who } = deps;
  return async (run) => {
    const op = beginOwnOperation(db, run.id, 'paid-1', 'image', run.claimedBy, clock.now());
    if (op === null) return;                                                         // the run is no longer this worker's
    if (op.created) {                                                                // a row already there (done, or pending: maybe sent) is never sent again
      appendFileSync(log, `paid ${who} ${run.id}\n`);
      endOperation(db, run.id, 'paid-1', { state: 'done', output: 'paid.png' }, clock.now());
    }
    appendFileSync(log, `render ${who} ${run.id}\n`);
    const part = join(deps.out, `${run.id}.part.mp4`);
    await deps.renderer.render(deps.composition, part, () => {});
    if (!holds(db, run.id, run.claimedBy)) { rmSync(part, { force: true }); return; }  // taken over meanwhile: the new owner's file stays
    renameSync(part, join(deps.out, `${run.id}.mp4`));
    finish(db, run.id, { kind: 'scan', checked: 1, aboveThreshold: 0, prepared: 0 }, clock.now());
  };
}
