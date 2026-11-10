// From word times in seconds to frames on the timeline, and from a mark's words to the frames an element is on screen. Pure.
import type { Captions } from '../edit/types.ts';
import type { WordTime } from './align.ts';
import { ResolveError } from './error.ts';
import type { Placed } from './parts.ts';
import type { WordRange } from './script.ts';

export type CaptionWord = Captions['words'][number];

/** A mark stays at most this many frames after its last word ends, waiting for the next word (or the cut). */
export const JOIN_FRAMES = 12;

/**
 * The words of one segment on the timeline (design §12.6): seconds become `Math.round(seconds × fps)`, then overlaps go:
 * no word starts before the one before it ends, a word of 0 frames gets 1, and every word lies inside its segment's frames.
 */
export function placeWords(texts: string[], times: WordTime[], segment: Placed, fps: number): CaptionWord[] {
  const first = segment.at, cut = segment.at + segment.for;
  if (texts.length > segment.for) throw new ResolveError('segment-short', `a clip of ${segment.for} frames cannot show ${texts.length} words one after the other`);
  const frameOf = (seconds: number) => first + (Number.isFinite(seconds) ? Math.round(seconds * fps) : 0);
  const start = times.map((time) => Math.min(cut - 1, Math.max(first, frameOf(time.start))));
  const end = times.map((time) => Math.min(cut, Math.max(first, frameOf(time.end))));
  let free = first;                                             // forwards: after the word before, and at least one frame long
  for (let i = 0; i < texts.length; i++) {
    start[i] = Math.max(start[i]!, free);
    end[i] = Math.max(end[i]!, start[i]! + 1);
    free = end[i]!;
  }
  let limit = cut;                                              // backwards: what was pushed past the cut comes back inside
  for (let i = texts.length - 1; i >= 0; i--) {
    end[i] = Math.min(end[i]!, limit);
    start[i] = Math.min(start[i]!, end[i]! - 1);
    limit = start[i]!;
  }
  return texts.map((text, i) => ({ text, at: start[i]!, for: end[i]! - start[i]! }));
}

/**
 * The frames of a mark: from its first word to where the next word of the segment begins (the cut, after the segment's last
 * word), but at most JOIN_FRAMES after its own last word ends. So a mark before a pause, even of one short word, stays long
 * enough to be seen, and a mark in running speech hands over exactly on the next word.
 */
export function markFrames(words: CaptionWord[], range: WordRange, segment: Placed): Placed {
  const at = words[range.from]!.at;
  const last = words[range.to]!;
  const next = words[range.to + 1]?.at ?? segment.at + segment.for;
  return { at, for: Math.min(next, last.at + last.for + JOIN_FRAMES) - at };
}
