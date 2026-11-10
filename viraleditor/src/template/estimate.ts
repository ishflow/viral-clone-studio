import type { Paid } from '../contracts.ts';
import { cardOf } from './card.ts';
import { clipShots } from './clips.ts';
import { billedSeconds } from './limits.ts';
import type { TemplateJson } from './schema.ts';

/**
 * The paid requests of a clean run: what the customer is shown before a job starts and what the pipeline may send at most.
 * Beats, per variant: one image and one clip per shot that owns a clip (a shot that continues a clip has none: clips.ts), one
 * image per generated still, one music. Speech, per variant: one image for the presenter still and one per generated still
 * (every talking clip starts from the presenter still), one talking clip per shot, one music, one voice.
 */
export function paidFor(template: TemplateJson, variants: number): Paid {
  if (!Number.isInteger(variants) || variants < 1) throw new RangeError(`variants must be a whole number from 1 on, got ${variants}`);
  const speech = template.mode === 'speech';
  const owners = clipShots(template), shots = owners.length;
  const clipSeconds = owners.reduce((sum, shot) => sum + billedSeconds(shot.clip_seconds), 0);
  return {
    images: ((speech ? 1 : shots) + (template.stills?.length ?? 0)) * variants,
    clips: shots * variants,
    clipSeconds: clipSeconds * variants,
    music: variants,
    voice: (speech ? 1 : 0) * variants,
  };
}

// What a job takes, in seconds, measured once on a real job (TS2: a 27 s video of two 14 s clips, machine unloaded). One
// measurement only: change these when a second one disagrees.
const ADAPT_SECONDS = 35;               // the model adapts the template to the customer's product
const IMAGES_SECONDS = 46;              // the first frames
const CLIP_BASE_SECONDS = 60;           // a clip: the provider's queue ...
const CLIP_PER_SECOND = 7;              // ... and its time per second of video (a 14 s clip took 2 min 40 s)
const CLIP_POOL = 3;                    // clips asked at once (produce/index.ts POOL): the next ones wait for a round to end
const MUSIC_SECONDS = 16;
const SPEECH_EXTRA_SECONDS = 240;       // the voice and the presenter's lip sync: not measured, the allowance the old formula gave speech
const RENDER_BASE_SECONDS = 60;         // cutting the clips and writing the video: the fixed part ...
const RENDER_PER_SECOND = 4;            // ... and the time per second of the finished video
const RENDERS = 2;                      // a delivered video is rendered until two renders show the same picture (produce/assemble.ts): twice when they agree, a third time after a mismatch

/**
 * The minutes shown to the customer, for one variant: the stages in the order the job runs them. The clips of a round run
 * side by side, so a round takes its longest clip (the shots that own a clip, the same list `paidFor` counts; a clip is
 * asked for and billed at `billedSeconds`); the cut and the render grow with the length of the finished video, and are counted
 * `RENDERS` times: the estimate is of a video that is delivered. A template's own sample video is rendered once, and is done
 * that much sooner than this says.
 */
export function minutesFor(template: TemplateJson): number {
  const clips = clipShots(template).map((shot) => CLIP_BASE_SECONDS + CLIP_PER_SECOND * billedSeconds(shot.clip_seconds)).sort((a, b) => b - a);
  let clipping = 0;
  for (let round = 0; round < clips.length; round += CLIP_POOL) clipping += clips[round]!;       // sorted: a round's first is its longest
  const video = cardOf(template, { image: null, video: null }).seconds;
  const render = RENDERS * (RENDER_BASE_SECONDS + RENDER_PER_SECOND * video);
  const speech = template.mode === 'speech' ? SPEECH_EXTRA_SECONDS : 0;
  return Math.ceil((ADAPT_SECONDS + IMAGES_SECONDS + clipping + MUSIC_SECONDS + render + speech) / 60);
}
