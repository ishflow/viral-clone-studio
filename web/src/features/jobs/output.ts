import type { Job } from '@/data/ports';
import { stepOf } from './steps';

/** The stages whose output the page can show beside the stage list. The others (Adaptation, Edit, Render) have nothing to open. */
export type OutputView = 'images' | 'clips' | 'music';
export const OUTPUT_VIEWS: readonly OutputView[] = ['images', 'clips', 'music'];

/** What can be looked at now, by stage: a stage opens as soon as one file of it can be shown. */
export function viewsOf(job: Job): Record<OutputView, boolean> {
  return {
    images: Boolean(job.shots?.some((shot) => shot.image) || job.made?.shared.length),
    clips: Boolean(job.shots?.some((shot) => shot.clipUrl)),
    music: Boolean(job.made?.music.length),
  };
}

/** What the panel shows while nobody has pressed a stage: the pictures as they come, the clips once the first one is made. */
export function autoView(job: Job): OutputView {
  return job.shots?.some((shot) => shot.clip) || stepOf(job, 'clips').done > 0 ? 'clips' : 'images';
}
