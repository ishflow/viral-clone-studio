// The shot plan of a reference: its hard cuts, measured on the file, as the shots a beats template has to have. The rhythm of
// the cuts is most of what makes a reference work, and a model that is shown a few frames cannot see it: the engine measures
// it, shows the model every shot, and holds the answer to the plan. Nothing here reads a file.
import type { FaintCut, FrameRange } from '../ports.ts';
import { billedSeconds, SHOT_SECONDS_MAX } from '../template/limits.ts';
import type { TemplateIssue } from './check.ts';

/** A cut closer than this to the cut before it, or to the end, is dropped: a flash or a false detection, not a shot. */
export const SHOT_FRAMES_MIN = 8;
/** The shots a template may have (template/schema.ts). A reference with more is not prepared: shots are never merged to make it fit. */
export const SHOTS_MAX = 30;

/** A part that a faint cut leaves is at least as long as the shortest clip that is billed: a shorter one is paid for as that long, and near the start or the end of its take it is an effect on the cut there far more often than a shot of its own. */
export const FAINT_SECONDS_MIN = billedSeconds(0);

/**
 * Where the faint cuts alone cut a take (`at` to `end`, in frames) into parts no longer than `longest`: the strongest first, then the
 * strongest in a part that is still too long, and no part further than it needs. [] for a take that fits; null when they leave a part too long.
 */
function faintEdges(at: number, end: number, faint: { at: number; score: number }[], longest: number, apart: number): number[] | null {
  if (end - at <= longest) return [];
  const cut = faint.filter((one) => one.at - at >= apart && end - one.at >= apart).sort((a, b) => b.score - a.score || a.at - b.at)[0];
  if (cut === undefined) return null;
  const before = faintEdges(at, cut.at, faint, longest, apart);
  const after = faintEdges(cut.at, end, faint, longest, apart);
  return before === null || after === null ? null : [...before, cut.at, ...after];
}

/**
 * The shots of a video of `seconds` with a hard cut at each of `cuts` (seconds, ascending), in frames at `fps`. The first shot
 * starts at 0, the last ends at the end, every shot starts on the frame the one before it ends. A take longer than a template
 * allows is cut at its `faint` cuts when they leave no part of it too long and no more than one part beyond its equal parts, else split into the fewest equal parts that fit;
 * a take that fits is one shot, whatever faint cuts it has.
 */
export function shotPlan(cuts: number[], seconds: number, fps: number, faint: FaintCut[] = []): FrameRange[] {
  const end = Math.round(seconds * fps);
  const starts = [0];
  for (const cut of cuts) {
    const at = Math.round(cut * fps);
    if (at - starts.at(-1)! >= SHOT_FRAMES_MIN && end - at >= SHOT_FRAMES_MIN) starts.push(at);
  }
  const longest = SHOT_SECONDS_MAX * fps;
  const soft = faint.map((cut) => ({ at: Math.round(cut.second * fps), score: cut.score }));
  const plan = starts.flatMap((at, i) => {
    const stop = starts[i + 1] ?? end;
    const frames = stop - at;
    const parts = Math.ceil(frames / longest);
    const edges = faintEdges(at, stop, soft, longest, FAINT_SECONDS_MIN * fps);
    // every part is a billed shot: the faint cuts may leave one part more than equal parts do, not more
    if (edges !== null && edges.length + 1 <= parts + 1) return [at, ...edges].map((from, part, all) => ({ at: from, for: (all[part + 1] ?? stop) - from }));
    const edge = (part: number): number => at + Math.floor((part * frames) / parts);
    return Array.from({ length: parts }, (_, part) => ({ at: edge(part), for: edge(part + 1) - edge(part) }));
  });
  // more shots than a template may have, where equal parts are fewer: the reference is not lost to its faint cuts
  return faint.length > 0 && plan.length > SHOTS_MAX ? shotPlan(cuts, seconds, fps) : plan;
}

/** The two frames a shot is shown by: how it starts and how it ends. Both lie a little inside it, where the frames of a cut have settled. */
export function shownFrames(shot: FrameRange): [number, number] {
  const last = shot.at + shot.for - 1;
  return [Math.min(shot.at + 2, last), Math.max(shot.at + shot.for - 3, shot.at)];
}

/** Where the shots of a written template leave the plan: nothing when they are the plan's, in its order, with its frames. */
export function offPlan(shots: { at?: number; for?: number }[], plan: FrameRange[]): TemplateIssue[] {
  if (shots.length !== plan.length) {
    return [{
      code: 'cuts', path: 'shots', message: `The template has ${shots.length} shots, the reference has ${plan.length}.`,
      fix: `Write exactly ${plan.length} shots, with these "at"/"for": ${plan.map((shot) => `${shot.at}/${shot.for}`).join(', ')}.`,
    }];
  }
  return plan.flatMap((shot, i) => {
    const wrote = shots[i]!;
    if (wrote.at === shot.at && wrote.for === shot.for) return [];
    return [{
      code: 'cuts', path: `shots.${i}.at`, message: `The shot is at ${wrote.at} for ${wrote.for} frames; shot ${i + 1} of the reference is at ${shot.at} for ${shot.for}.`,
      fix: `Write "at": ${shot.at}, "for": ${shot.for}.`,
    }];
  });
}
