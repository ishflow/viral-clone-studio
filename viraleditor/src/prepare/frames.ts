// The pictures a template shows before it has a sample: a frame of its reference video for each shot, and, for a customer's own
// template, the first of them as its card image. Taken from the reference file with the media adapter, offline.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Card } from '../contracts.ts';
import type { Media } from '../ports.ts';

export interface Frames { cover: string | null; shots: Record<number, string> }   // paths under data/

const END_MARGIN = 0.1;   // a frame asked for at the very end of a file may not be there

/**
 * `cover` is `templates/<id>/poster.jpg`, only when `own`: the poster of a catalog template is its sample's, and a card image is
 * what lets an admin publish it. A beats shot is timed in the reference itself: its frame is the middle of it. A talking shot is timed
 * in the new video (the seconds of its script), so its frame is taken at the same share of the reference. A frame that cannot be
 * taken is left out, one that is on disk is not taken again, unless `retake`: then a file that no picture of the card points to is
 * a leftover of another second (a shot that was moved), so the frame is taken again over it.
 */
export async function takeFrames(deps: { media: Media; dataDir: string }, id: string, card: Card, source: string, seconds: number, own: boolean, retake = false): Promise<Frames> {
  const frames: Frames = { cover: null, shots: {} };
  const scale = card.format === 'talking' && card.seconds > 0 ? seconds / card.seconds : 1;
  const middle = (from: number, to: number): number => Math.max(0, Math.min((from + to) / 2 * scale, seconds - END_MARGIN));
  const take = async (to: string, second: number, leftover: boolean): Promise<string | null> => {
    const file = join(deps.dataDir, to);
    try {
      mkdirSync(dirname(file), { recursive: true });
      if (!existsSync(file) || (retake && leftover)) await deps.media.still(source, second, file);
      return to;
    } catch { return null; }
  };
  const first = card.shots[0];
  if (own && first !== undefined) frames.cover = await take(`templates/${id}/poster.jpg`, middle(first.from, first.to), !card.image);
  for (const shot of card.shots) {
    if (!(shot.to > shot.from)) continue;
    const taken = await take(`templates/${id}/shots/${shot.n}.jpg`, middle(shot.from, shot.to), !shot.image);
    if (taken !== null) frames.shots[shot.n] = taken;
  }
  return frames;
}

/** The card with the frames in it: `image` only when there is a cover (it never takes the place of a sample's poster), `image` of every shot that has a frame. */
export function withFrames(card: Card, frames: Frames): Card {
  return {
    ...card,
    image: frames.cover ?? card.image,
    shots: card.shots.map((shot) => (frames.shots[shot.n] === undefined ? shot : { ...shot, image: frames.shots[shot.n]! })),
  };
}

/** The card with the frames of `before` for the shots that are where they were (same number, same seconds): a shot that was moved shows another picture of the reference, so its old frame is dropped. */
export function keepFrames(card: Card, before: Card['shots']): Card {
  const frames: Record<number, string> = {};
  for (const shot of before) {
    const now = card.shots.find((s) => s.n === shot.n);
    if (shot.image && now && now.from === shot.from && now.to === shot.to) frames[shot.n] = shot.image;
  }
  return withFrames(card, { cover: null, shots: frames });
}
