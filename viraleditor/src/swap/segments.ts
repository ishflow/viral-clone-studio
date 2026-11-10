// The parts a person-swap video is asked for in. Pure.
import type { SwapPart } from '../contracts.ts';
import { SWAP_PART_SECONDS_MAX, SWAP_PART_SECONDS_MIN, SWAP_SECONDS_MAX } from '../template/swap-schema.ts';

/**
 * The video cut into parts of 3 to 10 seconds that cover it from its start, on whole frames. A part ends at a cut of the video
 * (`cuts`: the second each new shot starts at) where the shots allow it: shots too short to be a part are joined to the ones
 * beside them, and a run longer than a part may be is cut into the fewest equal pieces. Throws for a video of another length
 * than a person swap takes.
 */
export function segmentsOf(seconds: number, cuts: number[], fps: number): SwapPart[] {
  const total = Math.round(seconds * fps), min = Math.ceil(SWAP_PART_SECONDS_MIN * fps), max = Math.floor(SWAP_PART_SECONDS_MAX * fps);
  if (total < min || total > Math.floor(SWAP_SECONDS_MAX * fps)) throw new Error(`a person-swap video is ${SWAP_PART_SECONDS_MIN} to ${SWAP_SECONDS_MAX} seconds long, not ${Number(seconds.toFixed(3))}`);
  const shots = [...new Set(cuts.map((cut) => Math.round(cut * fps)).filter((frame) => frame > 0 && frame < total))].sort((a, b) => a - b);
  // the frames at which a run of shots ends that is long enough to be a part; what is left over at the end joins the run before it
  const ends: number[] = [];
  for (const frame of shots) if (frame - (ends.at(-1) ?? 0) >= min) ends.push(frame);
  if (ends.length > 0 && total - ends.at(-1)! < min) ends.pop();
  ends.push(total);
  const frames: number[] = [0];
  for (const end of ends) {
    const start = frames.at(-1)!, pieces = Math.ceil((end - start) / max);
    for (let piece = 1; piece <= pieces; piece += 1) frames.push(start + Math.round((end - start) * piece / pieces));
  }
  return frames.slice(1).map((frame, index): SwapPart => ({ n: index + 1, from: frames[index]! / fps, to: frame / fps }));
}
