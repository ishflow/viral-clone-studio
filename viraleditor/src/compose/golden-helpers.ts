// For the render tests only: the HyperFrames CLI with the three switches of the rules, decoded frames, and the frame bar of
// a shot read through the frame table (where the shot is on screen, how large, how opaque: timeline.animations says it).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Timeline } from '../edit/timeline.ts';
import { valueAt } from './testing.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HF = join(ROOT, 'node_modules/.bin/hyperframes');
const find = (name: string) => [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`].find((path) => existsSync(path));
const FFMPEG = find('ffmpeg');
const FFPROBE = find('ffprobe');
/** The render tests run only where the CLI, its Chrome and ffmpeg are installed. */
export const available = existsSync(HF) && existsSync(join(homedir(), '.cache/hyperframes/chrome')) && FFMPEG !== undefined && FFPROBE !== undefined;

const ENV: NodeJS.ProcessEnv = { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', NO_COLOR: '1' };
delete ENV.GEMINI_API_KEY;

export function hyperframes(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync(HF, args, { env: ENV, encoding: 'utf8', maxBuffer: 1 << 28 });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}
/** The JSON a command printed (the CLI may print a line before it). */
export function jsonOf(text: string): any {
  return JSON.parse(text.slice(text.indexOf('{')));
}

export interface Probe { width: number; height: number; fps: string; frames: number; seconds: number; audio: boolean }
/** Size, rate, counted frames and length of a file; a file without a picture has width 0 and frames 0. */
export function probe(file: string): Probe {
  const run = spawnSync(FFPROBE!, ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,nb_read_frames:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr);
  const info = JSON.parse(run.stdout) as { streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string; nb_read_frames?: string }[]; format: { duration: string } };
  const video = info.streams.find((s) => s.codec_type === 'video');
  return {
    width: video?.width ?? 0, height: video?.height ?? 0, fps: video?.r_frame_rate ?? '', frames: Number(video?.nb_read_frames ?? 0),
    seconds: Number(info.format.duration), audio: info.streams.some((s) => s.codec_type === 'audio'),
  };
}

/** The checksum of every decoded frame (`ffmpeg -f framemd5`). */
export function frameMd5(file: string): string[] {
  const run = spawnSync(FFMPEG!, ['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'framemd5', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (run.status !== 0) throw new Error(run.stderr);
  return run.stdout.split('\n').filter((line) => line !== '' && !line.startsWith('#')).map((line) => line.split(',').pop()!.trim());
}

export interface Picture { width: number; height: number; rgb: Uint8Array }
/** The frames with these numbers, decoded to rgb24. */
export function decode(file: string, width: number, height: number, frames: number[]): Map<number, Picture> {
  const numbers = [...new Set(frames)].sort((a, b) => a - b);
  const select = numbers.map((n) => `eq(n\\,${n})`).join('+');
  const run = spawnSync(FFMPEG!, ['-v', 'error', '-i', file, '-vf', `select='${select}'`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  if (run.status !== 0) throw new Error(run.stderr.toString());
  const size = width * height * 3;
  if (run.stdout.length !== size * numbers.length) throw new Error(`decoded ${run.stdout.length / size} frames, asked for ${numbers.length}`);
  return new Map(numbers.map((n, i) => [n, { width, height, rgb: run.stdout.subarray(i * size, (i + 1) * size) }]));
}

/** How many pixels of a rectangle pass a test. */
export function count(picture: Picture, rect: { x: number; y: number; width: number; height: number }, test: (r: number, g: number, b: number) => boolean): { n: number; cx: number; cy: number } {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = Math.max(0, rect.y); y < Math.min(picture.height, rect.y + rect.height); y++) {
    for (let x = Math.max(0, rect.x); x < Math.min(picture.width, rect.x + rect.width); x++) {
      const i = (y * picture.width + x) * 3;
      if (test(picture.rgb[i]!, picture.rgb[i + 1]!, picture.rgb[i + 2]!)) { n++; sx += x; sy += y; }
    }
  }
  return { n, cx: n > 0 ? sx / n : 0, cy: n > 0 ? sy / n : 0 };
}

// ── the frame bar of framebar.ts, read where the frame table says the shot is ──

const COLUMNS = 32;
const DIGITS = 30;
const ROWS = [0.04, 0.08, 0.12, 0.16, 0.2, 0.24, 0.28, 0.32, 0.36, 0.4, 0.44];     // of the height, in the upper half; the lower half mirrors them
const FULL = 150;                 // the least a bar stands out from its clip (min channel) when the shot is alone and sharp

interface Placed { opacity: number; blur: number; map(x: number, y: number): [number, number]; rect: [number, number, number, number] }

/** Where shot `index` is on frame `f`: the picture is scaled around the centre (motion on the media, zoom on the wrapper) and moved. */
function place(timeline: Timeline, index: number, f: number): Placed {
  const shot = timeline.shots[index]!;
  const { width: W, height: H } = timeline;
  const scale = valueAt(timeline, shot.element, 'scale', f, 1) * valueAt(timeline, shot.id, 'scale', f, 1);
  const dx = valueAt(timeline, shot.id, 'x', f, 0);
  const dy = valueAt(timeline, shot.id, 'y', f, 0);
  const map = (x: number, y: number): [number, number] => [W / 2 + scale * (x - W / 2) + dx, H / 2 + scale * (y - H / 2) + dy];
  const [left, top] = map(0, 0);
  const [right, bottom] = map(W, H);
  return { opacity: valueAt(timeline, shot.id, 'opacity', f, 1), blur: valueAt(timeline, shot.id, 'blur', f, 0), map, rect: [left, top, right, bottom] };
}

export interface BarReading { source: number; weight: number; units: number | null; before: number | null; after: number | null; thirties: number | null }

/**
 * How the frame bar of shot `index` looks on frame `f`: for the source frame the table expects (`from + f − at`), how far
 * the column of its units digit, the columns before and after it, and the column of its thirties digit stand out from the
 * rest of their rows. null: that column cannot be read there (off screen, hidden by a shot above, another shot's bar on it).
 * Returns null when the shot is not readable on that frame at all (too faint, too blurred).
 */
export function readShot(timeline: Timeline, picture: Picture, index: number, f: number): BarReading | null {
  const { width: W, height: H } = timeline;
  const shot = timeline.shots[index]!;
  const visible = timeline.shots.map((_, i) => i).filter((i) => { const s = timeline.shots[i]!; return f >= s.at && f < s.at + s.for + s.tail; });
  if (!visible.includes(index)) return null;
  const me = place(timeline, index, f);
  const above = visible.filter((i) => i > index).map((i) => place(timeline, i, f));
  const others = visible.filter((i) => i !== index).map((i) => ({ placed: place(timeline, i, f), source: timeline.shots[i]!.from + (f - timeline.shots[i]!.at) }));
  const inside = (p: Placed, x: number, y: number) => x >= p.rect[0] && x < p.rect[2] && y >= p.rect[1] && y < p.rect[3];
  const weight = me.opacity * above.reduce((w, p) => (p.opacity < 0.999 ? w * (1 - p.opacity) : w), 1);
  if (weight < 0.05 || me.blur > 8) return null;

  const column = (digit: number) => Math.floor(((1 + digit) * W) / COLUMNS) + Math.ceil(W / COLUMNS) / 2;
  const white = (x: number, y: number): number | null => {
    const sx = Math.round(x);
    const sy = Math.round(y);
    if (sx < 2 || sy < 2 || sx >= W - 2 || sy >= H - 2) return null;
    if (above.some((p) => p.opacity >= 0.999 && inside(p, sx, sy))) return null;
    const i = (sy * W + sx) * 3;
    return Math.min(picture.rgb[i]!, picture.rgb[i + 1]!, picture.rgb[i + 2]!);
  };
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  /** another shot's bar within a column and a half of this point: the reading there says nothing about this shot */
  const taken = (x: number, half: 0 | 1) => others.some(({ placed, source }) => {
    const digit = half === 0 ? source % DIGITS : Math.floor(source / DIGITS) % DIGITS;
    const [ox] = placed.map(column(digit), H / 2);
    return Math.abs(ox - x) < (1.5 * W) / COLUMNS;
  });
  const stands = (digit: number, half: 0 | 1): number | null => {
    if (digit < 0 || digit >= DIGITS) return null;
    if (taken(me.map(column(digit), 0)[0], half)) return null;
    const rows: number[] = [];
    for (const row of ROWS) {
      const y = (half === 0 ? row : 1 - row) * H;
      const all = Array.from({ length: DIGITS }, (_, d) => white(...me.map(column(d), y)));
      const known = all.filter((v): v is number => v !== null);
      if (all[digit] === null || all[digit] === undefined || known.length < 8) continue;
      rows.push(all[digit]! - median(known));
    }
    return rows.length >= 3 ? median(rows) : null;
  };
  const source = shot.from + (f - shot.at);
  const units = source % DIGITS;
  return {
    source, weight: weight * (me.blur > 1 ? 0.5 : 1),
    units: stands(units, 0), before: stands(units - 1, 0), after: stands(units + 1, 0),
    thirties: stands(Math.floor(source / DIGITS) % DIGITS, 1),
  };
}

/** Is the bar of the expected source frame there, and not the one of the frame before or after? `null`: nothing could be read. */
export function showsExpected(reading: BarReading | null): boolean | null {
  if (reading === null || reading.units === null) return null;
  const least = 0.5 * reading.weight * FULL;
  const neighbour = (value: number | null) => value === null || value < Math.max(4, 0.3 * reading.units!);
  return reading.units >= least && neighbour(reading.before) && neighbour(reading.after) && (reading.thirties === null || reading.thirties >= least);
}
