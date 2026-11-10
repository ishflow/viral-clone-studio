/**
 * The frame bar: two white bars, drawn on every frame of a generated clip, whose positions name the frame
 * number. A test reads them from a rendered frame to learn which source frame it shows.
 *
 * The width is split into 32 columns and the frame number is written in base 30: the upper half of the
 * frame carries the units as a bar in column `units + 1`, the lower half the thirties in column
 * `thirties + 1` (columns 0 and 31 stay empty). That gives 900 numbers, then the count starts again.
 * Each bar spans half the height, so lines of text over the clip do not hide it. Positions are fractions
 * of the width: they survive any rescale and any crop of the height; a crop of more than about 3 % of
 * the width moves the outer columns.
 */
const COLUMNS = 32;
const BASE = 30;
/** How many frame numbers the bar can tell apart: 0 … 899 (30 s at 30 fps). */
export const BAR_FRAMES = BASE * BASE;
/** Rows read in the upper half, as fractions of the height; the lower half mirrors them. */
const ROWS = [0.08, 0.16, 0.24, 0.32, 0.4];

/**
 * The ffmpeg filter (`-vf`, one input, one output) that draws the bar. The frame number comes from the
 * frame's timestamp, so the clip must have a constant `fps` and start at zero, as a generated clip does.
 */
export function barFilter(options: { width: number; height: number; fps: number }): string {
  const { width, height, fps } = options;
  const bar = Math.ceil(width / COLUMNS);
  const upper = Math.floor(height / 2);
  const frame = `floor(t*${fps}+0.5)`;
  const x = (digit: string): string => `floor((1+${digit})*W/${COLUMNS})`;
  return [
    `color=c=white:s=${bar}x${upper}[barunits]`,
    `color=c=white:s=${bar}x${height - upper}[barthirties]`,
    `[in][barunits]overlay=x='${x(`mod(${frame},${BASE})`)}':y=0:shortest=1[barhalf]`,
    `[barhalf][barthirties]overlay=x='${x(`mod(floor(${frame}/${BASE}),${BASE})`)}':y=${upper}:shortest=1`,
  ].join(';');
}

/** The frame number written on one decoded frame (raw `rgb24` bytes), or null when no bar can be read. */
export function readBar(rgb: Uint8Array, width: number, height: number): number | null {
  if (rgb.length !== width * height * 3) return null;
  const units = digitOf(rgb, width, ROWS.map((at) => Math.floor(height * at)));
  const thirties = digitOf(rgb, width, ROWS.map((at) => Math.floor(height * (1 - at))));
  return units === null || thirties === null ? null : units + BASE * thirties;
}

/** The digit most rows agree on: at least two rows, and more than half of the rows that show a bar. */
function digitOf(rgb: Uint8Array, width: number, rows: number[]): number | null {
  const votes = new Map<number, number>();
  for (const y of rows) {
    const digit = digitOfRow(rgb, width, y);
    if (digit !== null) votes.set(digit, (votes.get(digit) ?? 0) + 1);
  }
  let best: number | null = null;
  let most = 0;
  let all = 0;
  for (const [digit, count] of votes) {
    all += count;
    if (count > most) { best = digit; most = count; }
  }
  return most >= 2 && most * 2 > all ? best : null;
}

/** One row: exactly one white run about one column wide, in a digit column. Anything else is no reading. */
function digitOfRow(rgb: Uint8Array, width: number, y: number): number | null {
  const column = width / COLUMNS;
  let start = -1;
  let found: number | null = null;
  for (let x = 0; x <= width; x++) {
    const i = (y * width + x) * 3;
    const white = x < width && rgb[i]! > 200 && rgb[i + 1]! > 200 && rgb[i + 2]! > 200;
    if (white && start < 0) start = x;
    if (!white && start >= 0) {
      const run = x - start;
      if (found !== null || run < column * 0.5 || run > column * 1.5) return null;
      found = Math.floor((start + run / 2) / column) - 1;
      start = -1;
    }
  }
  return found !== null && found >= 0 && found < BASE ? found : null;
}
