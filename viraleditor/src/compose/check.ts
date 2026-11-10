// The frames on which the renderer runs `hyperframes check` (design §12.17). The renderer takes any overflow it finds
// there for a fault, so a sample is a frame on which the element it is taken for stands still and nothing else moves.
import type { Timeline } from '../edit/timeline.ts';
import type { Frame } from '../edit/types.ts';

/**
 * One sample per text line, caption group and card: a frame of its rest that lies outside every transition's effect
 * frames, outside the moves of every window (its shrink and its return) and outside the enter and the exit of every
 * other element; of those, the one nearest the middle of the rest (the earlier one of two that are equally near). An element whose rest has no such frame gives no sample. Ascending,
 * each frame once. One pass over the frames and one over the elements: no element is compared with another.
 */
export function checkFrames(timeline: Timeline): Frame[] {
  const entries = [...timeline.texts, ...timeline.captions, ...timeline.cards];
  const frames = timeline.frames;
  // how many things move on each frame, as a list of changes that is summed once: +1 where a move begins, -1 where it ends.
  // An element moves outside its rest only, so on a frame of its rest whatever moves is something else.
  const change = new Array<number>(frames + 1).fill(0);
  const moves = (at: Frame, end: Frame): void => {
    const [from, to] = [Math.max(0, at), Math.min(frames, end)];
    if (to > from) { change[from]! += 1; change[to]! -= 1; }
  };
  for (const transition of timeline.transitions) moves(transition.at, transition.at + transition.for);
  // a window is a move while it shrinks and while it returns, and it rests in between
  for (const { at, for: length, frames: move } of timeline.windows) { moves(at, at + move); moves(at + length - move, at + length); }
  for (const { at, for: length, rest } of entries) { moves(at, rest.at); moves(rest.at + rest.for, at + length); }
  // for every frame the nearest still frame at or before it and at or after it (-1 and `frames`: none)
  const before = new Array<Frame>(frames);
  const after = new Array<Frame>(frames);
  let moving = 0;
  let last = -1;
  for (let f = 0; f < frames; f++) {
    moving += change[f]!;
    if (moving === 0) last = f;
    before[f] = last;
  }
  let next = frames;
  for (let f = frames - 1; f >= 0; f--) {
    if (before[f] === f) next = f;
    after[f] = next;
  }
  const samples = new Set<Frame>();
  for (const { rest } of entries) {
    const middle = rest.at + Math.floor(rest.for / 2);
    const [low, high] = [before[middle]!, after[middle]!];
    const [lowIn, highIn] = [low >= rest.at, high < rest.at + rest.for];
    if (lowIn && (!highIn || middle - low <= high - middle)) samples.add(low);
    else if (highIn) samples.add(high);
  }
  return [...samples].sort((x, y) => x - y);
}
