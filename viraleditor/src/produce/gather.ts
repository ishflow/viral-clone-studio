// Sends every paid request of the variants through one pool, step by step over all variants, and says for each
// variant whether it has all its media. A request that fails for good stops its variant: what is in flight for it
// finishes, nothing new starts for it, the other variants go on. An outcome that stops the whole run starts nothing more at all.
import type { StepKey, StopReason } from '../contracts.ts';
import type { FailureCode } from '../db/runs.ts';
import { abs, rel } from '../paths.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';
import type { PaidOutcome } from './paid.ts';
import { withFiles } from './plan.ts';
import type { Kind, Planned } from './plan.ts';
import type { Pool } from './pool.ts';
import type { Board } from './steps.ts';
import type { Gathered, VariantMedia } from './types.ts';

export interface VariantPlan { n: number; fill: FillJson; items: Planned[] }
export interface GatherOptions {
  template: TemplateJson;
  runId: string;
  plans: VariantPlan[];                              // the variants that are not finished
  pool: Pool;
  paid: (item: Planned) => Promise<PaidOutcome>;     // paid.ts: the only way to the generator
  board: Pick<Board, 'begin' | 'end' | 'stopIn' | 'variant'>;
  stopping: Stopping;
}

/**
 * Why the whole run is stopping, or `reason: null` while it goes on. One for a call of the handler: whoever finds a
 * reason (a request's outcome, an error anywhere, a write that says the run is no longer this worker's) sets it,
 * and from then on no request that has not started is started.
 */
export interface Stopping { reason: StopReason | null; detail: string | null; code?: FailureCode }
export function halt(stopping: Stopping, reason: StopReason, detail: string, code?: FailureCode): void {
  if (stopping.reason === null) { stopping.reason = reason; stopping.detail = detail; if (code !== undefined) stopping.code = code; }
}

/**
 * The order of the requests. Each step covers all variants, so the steps go forward once. A talking clip is made from
 * the presenter still and the voice sample, so the voice (counted in the music step, together with the music) comes before the clips.
 */
const PHASES: Record<TemplateJson['mode'], Kind[][]> = { beats: [['image'], ['clip'], ['music']], speech: [['image'], ['voice', 'music'], ['clip']] };
export const STEP_OF: Record<Kind, StepKey> = { image: 'images', clip: 'clips', music: 'music', voice: 'music' };

/** Every variant of `plans` with all its media, or why not. When `stopping.reason` is set afterwards, the whole run stops and no variant is `ok`. Never rejects for one request: what is in flight always finishes first. */
export async function gather(options: GatherOptions): Promise<Gathered[]> {
  const { template, runId, plans, pool, paid, board, stopping } = options;
  const stopped = new Map<number, StopReason>();     // variant → why it stopped
  const files = new Map<string, string>();           // key → the file under data/
  const moved = new Map<string, string>();           // a file's planned place → where it is (it was renamed by what it is); absolute

  for (const { n } of plans) board.variant(n, { status: 'running', reason: null });

  for (const kinds of PHASES[template.mode]) {
    if (stopping.reason !== null) break;
    const items = plans.filter((plan) => !stopped.has(plan.n)).flatMap((plan) => plan.items.filter((item) => kinds.includes(item.kind)));
    for (const step of new Set(items.map((item) => STEP_OF[item.kind]))) board.begin(step, items.filter((item) => STEP_OF[item.kind] === step).length);

    const settled = new Map<string, Promise<boolean>>();
    for (const item of items) {
      const step = STEP_OF[item.kind];
      settled.set(item.key, (async (): Promise<boolean> => {
        // files of this very step that the request reads (a still made from another still, a first frame made from a still): wait for them
        const ready = await Promise.all(item.needs.map((key) => settled.get(key) ?? true));
        // Nothing in here may reject: an error of any kind (the request's own writes, the bookkeeping of the steps
        // and variants) stops the run, and the requests in flight beside this one still finish and are recorded.
        try {
          // asked again when its turn comes: nothing new starts for a stopped variant or a stopping run
          // and the files it reads are named as they are by then, not as they were planned
          const outcome = !ready.every(Boolean) ? null : await pool.run(async () => (stopping.reason !== null || stopped.has(item.n) ? null : paid(withFiles(item, moved))));
          if (outcome === null) { board.end(step, false); return false; }
          if (outcome.ok) {
            files.set(item.key, outcome.file);
            if (outcome.file !== item.file) moved.set(abs(item.file), abs(outcome.file));
            board.end(step, outcome.fresh);
            return true;
          }
          if (outcome.whole) halt(stopping, outcome.reason, `${item.key} stopped the run`, outcome.code);
          if (!stopped.has(item.n)) {
            stopped.set(item.n, outcome.reason);
            board.stopIn(step);
            board.variant(item.n, { status: 'stopped', reason: outcome.reason });
          }
          board.end(step, false);
        } catch (error) {
          halt(stopping, 'engine-error', `${item.key}: ${error instanceof Error ? error.message : String(error)}`);
        }
        return false;
      })());
    }
    await Promise.all(settled.values());             // none of them rejects: what is in flight finishes, whatever happened
  }

  return plans.map(({ n, fill, items }): Gathered => {
    const reason = stopped.get(n) ?? stopping.reason;
    if (reason !== null) return { n, ok: false, reason };
    const media: VariantMedia = { n, dir: rel('jobs', runId, `v${n}`), fill, images: {}, clips: {}, music: null, voice: null };
    for (const item of items) {
      const file = files.get(item.key)!;
      if (item.kind === 'music') media.music = file;
      else if (item.kind === 'voice') media.voice = file;
      else if (item.kind === 'image') media.images[item.id!] = file;
      else media.clips[template.mode === 'beats' ? item.id! : template.shots.find((shot) => shot.id === item.id)!.segment!] = file;
    }
    return { n, ok: true, media };
  });
}
