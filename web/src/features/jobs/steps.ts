import type { Job, JobShot, JobStep, StepKey } from '@/data/ports';
import type { Translate } from '@/core/i18n/types';

/** The stages in the order the page shows them. The fake works in another order (music before clips): never read status from position. */
export const DISPLAY_ORDER: StepKey[] = ['adaptation', 'images', 'clips', 'music', 'edit', 'render'];

/** The stages of a person swap: the parts, the join, the sound and the label. The engine writes the others as done with nothing in them; they are not shown. */
export const SWAP_ORDER: StepKey[] = ['clips', 'edit', 'render'];

/** Where the name and the note of a stage are: a person swap has its own words for its three. */
export const stepText = (key: StepKey, swap: boolean): string => (swap ? `jobs.swap.step.${key}` : `jobs.step.${key}`);

export function inDisplayOrder(steps: JobStep[], swap = false): JobStep[] {
  return (swap ? SWAP_ORDER : DISPLAY_ORDER).flatMap((key) => steps.filter((step) => step.key === key));
}

export function stepOf(job: Job, key: StepKey): JobStep {
  return job.steps.find((step) => step.key === key) ?? { key, status: 'waiting', done: 0, total: 1 };
}

/** "done", "done · 5 / 5", "running · 3 / 5": a count only where the stage has more than one part. */
export function stateText(step: JobStep, t: Translate): string {
  const state = t(`jobs.state.${step.status}`);
  return step.total > 1 && step.status !== 'waiting' ? t('jobs.state.count', { state, done: step.done, total: step.total }) : state;
}

export type ShotPhase = 'waiting' | 'picture' | 'pictureReady' | 'clip' | 'ready';

/** The engine's word on box `index` (0-based; the boxes are the clips of all variants, one variant after the other), or undefined when it has none. */
export function shotOf(job: Job, index: number): JobShot | undefined {
  const perVariant = Math.max(1, Math.ceil(stepOf(job, 'clips').total / job.input.variants));
  return job.shots?.find((shot) => shot.variant === Math.floor(index / perVariant) + 1 && shot.n === (index % perVariant) + 1);
}

/**
 * Where shot `index` (0-based) is, in the words of the stage list beside it. When the job tells what each shot has (`job.shots`), that is
 * the answer: a made clip makes its own shot ready, a made picture its own shot's picture. Without it the job reports counts per stage
 * only: the clips that are ready are the first `clips.done`; until the Images stage is done every shot is at that stage, after it every shot that is not ready.
 */
export function shotPhase(job: Job, index: number): ShotPhase {
  const images = stepOf(job, 'images');
  const clips = stepOf(job, 'clips');
  const shot = shotOf(job, index);
  if (shot ? shot.clip : job.shots === undefined && index < clips.done) return 'ready';
  if (shot !== undefined || images.status === 'done') return clips.status === 'running' ? 'clip' : 'pictureReady';
  return images.status === 'running' ? 'picture' : 'waiting';
}

/** Pictures every shot uses (a still, the person who speaks) are made by the Images stage besides the one picture of each box: how many. */
export function sharedImages(steps: JobStep[]): number {
  const images = steps.find((step) => step.key === 'images');
  const clips = steps.find((step) => step.key === 'clips');
  return images && clips ? Math.max(0, images.total - clips.total) : 0;
}

/** The variant with this id; no or an unknown id gives the first. */
export function pickVariant<T extends { id: string }>(variants: T[], id: string | undefined): T | undefined {
  return variants.find((v) => v.id === id) ?? variants[0];
}

export function secondsSince(iso: string): number {
  return Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
}

/** Named counts ("Two clips…") exist for 1–8; beyond that the plain "{count}" text is used. */
export function counted(t: Translate, base: string, count: number): string {
  return count >= 1 && count <= 8 ? t(`${base}.n${count}`, { count }) : t(`${base}.other`, { count });
}

/** The line under the title of a job: a person swap says what it is and how long its video is (when that is known), never "0 products". */
export function leadOf(t: Translate, job: Job, seconds = 0): string {
  if (job.swap) return seconds > 0 ? t('jobs.swap.leadLength', { seconds: Math.round(seconds) }) : t('jobs.swap.lead');
  return t('jobs.running.lead', {
    products: t('jobs.unit.product', { count: job.input.products.length }),
    quality: t(`common.quality.${job.input.quality}`),
    variants: t('jobs.unit.variant', { count: job.input.variants }),
  });
}
