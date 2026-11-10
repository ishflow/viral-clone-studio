/** Momentary loudness (LUFS) is measured every 100 ms. */
const STEP_SECONDS = 0.1;
/** The fullest window must beat the opening by this many LU before the music starts anywhere but its first frame. */
export const WINDOW_GAIN = 1;
/** Frames of fade-in when the music starts inside the file. */
export const WINDOW_FADE_IN = 3;

/** The first momentary values of a measured file are -Infinity (the 400 ms window has nothing to measure yet): at most this many leading ones are left out of the opening. */
const WARMUP = 3;

const power = (lufs: number): number => 10 ** (lufs / 10);

/**
 * Where in a file longer than the video the music should start: the first frame of the window of the video's length with
 * the highest mean power (of the momentary values), searched in steps of 100 ms, the earliest of equals. 0 unless that
 * window is at least WINDOW_GAIN LU louder than the opening, and 0 when the music is not longer than the video. The
 * opening is the window that starts after the file's own warm-up (up to WARMUP leading -Infinity values), so those values
 * do not make it look quieter than it is; a window that starts inside the warm-up is not a candidate.
 */
export function musicStart(momentary: number[], musicFrames: number, videoFrames: number, fps: number): number {
  if (musicFrames <= videoFrames) return 0;
  const length = Math.max(1, Math.round(videoFrames / fps / STEP_SECONDS));
  const sum = (from: number): number => { let total = 0; for (let i = from; i < from + length; i++) total += power(momentary[i]!); return total; };
  let warm = 0;
  while (warm < WARMUP && momentary[warm] === -Infinity) warm++;
  if (momentary.length < warm + length) return 0;
  let best = warm, bestSum = sum(warm);
  const opening = bestSum;
  for (let i = warm + 1; i + length <= momentary.length; i++) {
    if (Math.round(i * STEP_SECONDS * fps) + videoFrames > musicFrames) break;
    const s = sum(i);
    if (s > bestSum) { best = i; bestSum = s; }
  }
  if (best === warm || !(bestSum >= opening * power(WINDOW_GAIN))) return 0;
  return Math.round(best * STEP_SECONDS * fps);
}
