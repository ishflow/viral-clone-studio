// The music under a video: the passes of the file and the gain along each (design §5.7, §12.1, §12.2). Pure.
// validate.ts uses it to count the points of a lane; audio.ts writes the elements from it.
import { LIMITS, MUSIC, tailOf } from './presets.ts';
import type { Edit, Frame, Frames } from './types.ts';

export interface Range { at: Frame; end: Frame }                                    // frames at … end − 1
export type Point = [Frame, number];                                                // a gain on a frame of the timeline
export interface Pass { at: Frame; for: Frames; from: Frame; points: Point[] }      // one <audio> element; linear between its points

/** The value of a line through `points` on frame `f`; before the first and after the last point it is `outside`. */
function valueAt(points: Point[], f: number, outside: number): number {
  if (points.length === 0 || f < points[0]![0] || f > points.at(-1)![0]) return outside;
  let i = points.length - 1;
  while (points[i]![0] > f) i--;
  const [x, y] = points[i]!;
  const next = points[i + 1];
  return next === undefined || x === f ? y : y + ((next[1] - y) * (f - x)) / (next[0] - x);
}

/** The periods in which the music is lowered, in order. Two that are closer than 2 × ramp are one: their ramps would cross. */
export function duckRanges(edit: Edit): Range[] {
  const duck = edit.audio?.music?.duck;
  if (!duck) return [];
  const raw: Range[] = duck.under === 'sound'
    ? edit.shots.flatMap((shot, i) => (shot.sound ? [{ at: shot.at, end: shot.at + shot.for + tailOf(edit.shots, i) }] : []))
    : (duck.under === 'captions' ? edit.captions?.words ?? [] : duck.under).map((range) => ({ at: range.at, end: range.at + range.for }));
  const gap = 2 * (duck.ramp ?? MUSIC.ramp);
  const merged: Range[] = [];
  for (const range of [...raw].sort((a, b) => a.at - b.at)) {
    const last = merged.at(-1);
    if (last && range.at - last.end < gap) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/**
 * The gain of the music on every frame where its slope changes, from frame 0 to the last frame's end.
 * The gain is the ducked level times the fade; between two points it is linear, as the volume lane is.
 */
export function musicGain(edit: Edit): Point[] {
  const music = edit.audio?.music;
  if (!music) return [];
  const frames = edit.frames;
  const ramp = music.duck?.ramp ?? MUSIC.ramp;
  const to = music.duck?.to ?? music.gain;
  const level: Point[] = duckRanges(edit).flatMap((range): Point[] => [[range.at - ramp, music.gain], [range.at, to], [range.end, to], [range.end + ramp, music.gain]]);
  const fadeIn = Math.min(music.fadeIn ?? MUSIC.fadeIn, frames);
  const fadeOut = Math.min(music.fadeOut ?? MUSIC.fadeOut, frames - fadeIn);
  const fade: Point[] = [[0, fadeIn > 0 ? 0 : 1], [fadeIn, 1], [frames - fadeOut, 1], [frames, fadeOut > 0 ? 0 : 1]];
  const edges = new Set([0, frames, ...[...level, ...fade].map(([f]) => f).filter((f) => f > 0 && f < frames)]);
  return [...edges].sort((a, b) => a - b).map((f): Point => [f, Number((valueAt(level, f, music.gain) * valueAt(fade, f, 1)).toFixed(6))]);
}

/**
 * The passes of the music file. Without `loop`: one, over the whole video. With `loop`: as many as the video needs, each cut
 * to a multiple of 3 frames (100 ms), so that every pass starts on a whole millisecond. Empty when a pass would have no frame.
 */
export function musicPasses(edit: Edit, fileFrames: number): Pass[] {
  const music = edit.audio?.music;
  if (!music) return [];
  const from = music.from ?? 0;
  const whole = (n: number) => Math.floor(n / LIMITS.loopStep) * LIMITS.loopStep;
  const covers = !music.loop || fileFrames - from >= edit.frames;          // one pass: validate refuses a file too short for it
  const first = covers ? edit.frames : whole(fileFrames - from);
  const later = covers ? edit.frames : whole(fileFrames);
  if (first <= 0 || later <= 0) return [];
  const gain = musicGain(edit);
  const on = (f: Frame): Point => [f, Number(valueAt(gain, f, 0).toFixed(6))];
  const passes: Pass[] = [];
  for (let at = 0; at < edit.frames;) {
    const length = Math.min(at === 0 ? first : later, edit.frames - at);
    const end = at + length;
    passes.push({ at, for: length, from: at === 0 ? from : 0, points: [on(at), ...gain.filter(([f]) => f > at && f < end), on(end)] });
    at = end;
  }
  return passes;
}
