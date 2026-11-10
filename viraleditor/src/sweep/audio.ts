// The sound of a render, read as numbers: the mix decoded to PCM, the level of one tone over time (Goertzel), and the holes at
// the seams of looped music. Hole detection sees a run of near-zero samples; it is checked against zeroed copies of clean tones.
import { spawnSync } from 'node:child_process';
import { FFMPEG } from './media.ts';

export const RATE = 48000;
/** Mono 48 kHz samples of the sound of a file. */
export function pcm(file: string): Int16Array {
  const run = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { maxBuffer: 1 << 29 });
  if (run.status !== 0) throw new Error(run.stderr.toString());
  const copy = new Uint8Array(run.stdout);                     // aligned copy
  return new Int16Array(copy.buffer, 0, Math.floor(copy.length / 2));
}

/** Amplitude of the tone `hz` in a window of `n` samples at `start` (n a whole number of its cycles keeps other tones out). */
export function tone(samples: ArrayLike<number>, hz: number, start: number, n: number): number {
  let c = 0; let s = 0;
  for (let k = 0; k < n; k++) { const v = samples[start + k] ?? 0; const a = (2 * Math.PI * hz * k) / RATE; c += v * Math.cos(a); s += v * Math.sin(a); }
  return (2 * Math.hypot(c, s)) / n;
}
/** 10 cycles of 440 Hz: also whole cycles of 660 and 880 Hz. */
export const WINDOW = 1091;
export const frameStart = (frame: number): number => Math.round((frame * RATE) / 30);
/** The level of `hz` around the middle of video frame `f`. */
export const levelAt = (samples: ArrayLike<number>, hz: number, f: number): number => tone(samples, hz, frameStart(f) + 800 - Math.floor(WINDOW / 2), WINDOW);

/** The longest run of samples with |s| ≤ `limit` that starts in [from, to); and where. */
export function longestQuiet(samples: ArrayLike<number>, from: number, to: number, limit: number): { run: number; at: number } {
  let best = { run: 0, at: from }; let run = 0;
  for (let i = from; i < to; i++) {
    if (Math.abs(samples[i]!) <= limit) { run++; if (run > best.run) best = { run, at: i - run + 1 }; } else run = 0;
  }
  return best;
}
/** The shortest hole this detector tells from a zero crossing of a tone of amplitude `peak`: more than the samples a crossing stays under `limit`. */
export const HOLE_LIMIT = (peak: number): number => 0.03 * peak;
export const MIN_HOLE = 4;           // samples (0.083 ms)

/** The lag (samples, within ±max) at which `samples` after `start` best matches a sine of `hz` that starts at phase 0 there. */
export function phaseLag(samples: ArrayLike<number>, hz: number, start: number, max = 96, n = 960): number {
  let best = 0; let top = -Infinity;
  for (let lag = -max; lag <= max; lag++) {
    let sum = 0;
    for (let k = 0; k < n; k++) sum += (samples[start + k + lag] ?? 0) * Math.sin((2 * Math.PI * hz * k) / RATE);
    if (sum > top) { top = sum; best = lag; }
  }
  return best;
}

/** What timeline.audio says the gain of every row of one media is on frame `f` (the sum of the rows that are playing); null before and after. */
export function gainAt(rows: { media: string; at: number; for: number; gain: [number, number][] }[], media: string, f: number): number | null {
  let total: number | null = null;
  for (const row of rows) {
    if (row.media !== media || f < row.at || f >= row.at + row.for) continue;
    const pts = row.gain;
    let g = pts[0]![1];
    const x = f + 0.5;
    for (let i = 0; i < pts.length; i++) {
      if (x >= pts[i]![0]) g = pts[i]![1];
      if (i + 1 < pts.length && x >= pts[i]![0] && x < pts[i + 1]![0]) g = pts[i]![1] + ((pts[i + 1]![1] - pts[i]![1]) * (x - pts[i]![0])) / (pts[i + 1]![0] - pts[i]![0]);
    }
    total = (total ?? 0) + g;
  }
  return total;
}
