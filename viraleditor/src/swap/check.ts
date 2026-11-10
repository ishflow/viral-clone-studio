// The free checks of a person swap: a part as the provider made it, against the part of the source it was made from,
// and the joined video before it is delivered.
import { MediaError } from '../adapters/media.ts';
import { labelBox } from '../adapters/splice.ts';
import type { PartShape } from '../adapters/splice.ts';
import type { FrameRange, Measure, Media, MediaFacts, Picture } from '../ports.ts';

/** A made part may be this much longer or shorter than its source part and still be fitted to it. */
export const PART_SECONDS_SLACK = 0.5;
/** A made part may be black, or stand still, for this many seconds longer than its source part does. */
const DEAD_SECONDS_SLACK = 1;
/** The points the label is compared at, and the share of them that must show it. */
const LABEL_GRID = { columns: 36, rows: 8 };
const LABEL_SHARE = 0.85;

const framesIn = (ranges: FrameRange[]): number => ranges.reduce((sum, range) => sum + range.for, 0);

/**
 * A made part against its source part. `fault`: why it cannot be used (it is not a video, its length is another one, it is
 * black or stands still where the source does not): it has to be made again. Otherwise its facts, and `fits`: it has
 * the source part's size, rate and number of frames already.
 */
export async function checkPart(tools: { media: Media; measure: Measure }, made: string, source: { file: string; shape: PartShape }): Promise<{ fault: string } | { facts: MediaFacts; fits: boolean }> {
  const { media, measure } = tools;
  let facts: MediaFacts;
  try { facts = await media.probe(made); } catch (error) {
    if (error instanceof MediaError && error.code !== 'tool-failed') return { fault: `it cannot be read as a video: ${error.message}` };
    throw error;
  }
  if (!(facts.width > 0 && facts.height > 0 && facts.frames > 0)) return { fault: 'it has no picture' };
  const { shape } = source;
  const off = facts.seconds - shape.frames / shape.fps;
  if (Math.abs(off) > PART_SECONDS_SLACK) return { fault: `it is ${Number(facts.seconds.toFixed(2))} s long, its source part ${Number((shape.frames / shape.fps).toFixed(2))} s` };
  const slack = DEAD_SECONDS_SLACK * facts.fps;
  if (framesIn(await measure.black(made)) > framesIn(await measure.black(source.file)) + slack) return { fault: 'it is black where its source part is not' };
  if (framesIn(await measure.frozen(made)) > framesIn(await measure.frozen(source.file)) + slack) return { fault: 'it stands still where its source part does not' };
  return { facts, fits: facts.width === shape.width && facts.height === shape.height && facts.fps === shape.fps && facts.frames === shape.frames };
}

const bright = (picture: Picture, x: number, y: number): boolean => {
  const at = (Math.min(picture.height - 1, y) * picture.width + Math.min(picture.width - 1, x)) * 3;
  return picture.rgb[at]! + picture.rgb[at + 1]! + picture.rgb[at + 2]! > 3 * 128;
};

/** Is the label on this frame, where `labelBox` puts it: light where the label is light and dark where it is dark, at most points of a grid. */
export function labelShown(frame: Picture, label: Picture): boolean {
  const box = labelBox(frame, label);
  let same = 0;
  for (let row = 0; row < LABEL_GRID.rows; row += 1) {
    for (let column = 0; column < LABEL_GRID.columns; column += 1) {
      const u = (column + 0.5) / LABEL_GRID.columns, v = (row + 0.5) / LABEL_GRID.rows;
      if (bright(frame, box.left + Math.floor(u * box.width), box.top + Math.floor(v * box.height)) === bright(label, Math.floor(u * label.width), Math.floor(v * label.height))) same += 1;
    }
  }
  return same >= LABEL_SHARE * LABEL_GRID.rows * LABEL_GRID.columns;
}

/** Why the joined video must not be delivered, or null: every frame of the source, its sound when it has one, the label on its first, middle and last frame. */
export async function finishedFault(measure: Measure, video: string, facts: MediaFacts, expected: { frames: number; sound: boolean; label: string }): Promise<string | null> {
  if (facts.frames !== expected.frames) return `it has ${facts.frames} frames, its source ${expected.frames}`;
  if (facts.audio !== expected.sound) return expected.sound ? 'it has no sound, its source has' : 'it has sound, its source has none';
  const label = await measure.picture(expected.label, 0);
  for (const frame of new Set([0, Math.floor(facts.frames / 2), facts.frames - 1])) {
    if (!labelShown(await measure.picture(video, frame), label)) return `frame ${frame} does not show the AI label`;
  }
  return null;
}
