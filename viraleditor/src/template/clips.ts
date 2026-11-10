// The clips of a template: which shots own one, and which frames of it each shot shows. In beats a shot may continue the
// clip of an earlier shot (`continues`): it shows a later part of that clip and has no paid request of its own. This file
// is the one place that says which shots own a clip: estimate, plan and assemble count and walk what `clipShots` gives.
import { tailOf } from './motion.ts';
import type { TemplateJson } from './schema.ts';

type Shot = TemplateJson['shots'][number];
/** A shot that owns a clip: the rules give it its own clip_seconds and motion_prompt. */
export type ClipShot = Shot & { clip_seconds: number; motion_prompt: string };

/**
 * The shots that own a clip, in order: every shot without `continues`. Per variant each is one clip and, in beats, one
 * first frame; a shot that continues a clip is no request and no file. Throws when such a shot has no clip_seconds or no
 * motion_prompt: the template did not pass its rules.
 */
export function clipShots(template: Pick<TemplateJson, 'shots'>): ClipShot[] {
  return template.shots.filter((shot): shot is ClipShot => {
    if (shot.continues !== undefined) return false;
    if (shot.clip_seconds === undefined || shot.motion_prompt === undefined) throw new Error(`shot "${shot.id}" owns a clip and has no clip_seconds or no motion_prompt: the template did not pass its rules`);
    return true;
  });
}

/** One shot of a clip. `index`: its place in `shots` · `frames`: what it shows of the clip, its "for" and the frames the next shot's transition keeps it on screen. */
export interface Part { shot: Shot; index: number; frames: number }

/** The parts of the clip of shot `owner`, in order: the owner, then every shot that continues it. */
export function partsOf(template: Pick<TemplateJson, 'shots'>, owner: string): Part[] {
  const parts: Part[] = [];
  template.shots.forEach((shot, index) => {
    if ((shot.id === owner && shot.continues === undefined) || shot.continues === owner) {
      parts.push({ shot, index, frames: (shot.for ?? 0) + tailOf(template.shots[index + 1]?.in) });
    }
  });
  return parts;
}

/**
 * Where each part of a clip of `clip` frames starts, for parts of `lengths` frames in order. The first starts on frame 0
 * and the last ends on the clip's last frame; the frames no part shows are split into the gaps between the parts as evenly
 * as whole frames allow, the earlier gaps taking the frames left over. A single part starts on frame 0. Parts longer than
 * the clip together get no gaps: the last one runs past the clip's end, and the edit's own check (clip-short) says so.
 */
export function partStarts(clip: number, lengths: number[]): number[] {
  const gaps = lengths.length - 1;
  const spare = gaps > 0 ? Math.max(0, clip - lengths.reduce((sum, length) => sum + length, 0)) : 0;
  const starts: number[] = [];
  let at = 0;
  lengths.forEach((length, k) => {
    starts.push(at);
    at += length + (k < gaps ? Math.floor(spare / gaps) + (k < spare % gaps ? 1 : 0) : 0);
  });
  return starts;
}
