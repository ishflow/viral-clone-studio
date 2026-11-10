// For the *.render.test.ts files: media of their own (flat pictures, a wide clip, a short tone), and compose → write → lint →
// check → render of one document. Everything runs through the CLI with the three switches of the rules (golden-helpers.ts).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGenerator } from '../adapters/fake-generator.ts';
import type { Timeline } from '../edit/timeline.ts';
import type { ComposeFacts, Edit } from '../edit/types.ts';
import { decode, hyperframes, jsonOf, probe } from './golden-helpers.ts';
import type { Picture } from './golden-helpers.ts';
import { compose } from './index.ts';
import { writeComposition } from './write.ts';

export const FPS = 30;
export const SLOW = 900_000;                                   // the machine is shared: a render may take minutes
const TIER = { model: 'seedance-2-mini', resolution: '720p' };
const find = (name: string) => [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`].find((path) => existsSync(path))!;
export const FFMPEG = find('ffmpeg');

function ffmpeg(args: string[]): void {
  const run = spawnSync(FFMPEG, ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}: ${run.stderr}`);
}

export interface Media { dir: string; sources: Record<string, string>; facts: Record<string, ComposeFacts> }

/** The clips a, b, c of the fake generator (flat colour + frame bar, 150 frames) and the pictures it needs to make them. */
export async function fakeClips(): Promise<Media> {
  const dir = mkdtempSync(join(tmpdir(), 've-cases-media-'));
  const generator = createFakeGenerator({ log: join(dir, 'fake.log') });
  const file = (name: string) => join(dir, name);
  await generator.image({ prompt: 'seed', references: [], aspect: '9:16' }, file('seed.png'), () => {});
  const sources: Record<string, string> = {};
  const facts: Record<string, ComposeFacts> = {};
  for (const clip of ['a', 'b', 'c']) {
    await generator.clip({ mode: 'first-frame', firstFrame: file('seed.png'), prompt: `clip ${clip}`, seconds: 5, tier: TIER }, file(`${clip}.mp4`), () => {});
    const p = probe(file(`${clip}.mp4`));
    sources[`assets/${clip}.mp4`] = file(`${clip}.mp4`);
    facts[clip] = { frames: p.frames, audio: p.audio };
  }
  return { dir, sources, facts };
}

/** A media folder with nothing in it yet. */
export function emptyMedia(): Media {
  return { dir: mkdtempSync(join(tmpdir(), 've-cases-media-')), sources: {}, facts: {} };
}

/** A flat 720×1280 picture. */
export function flatImage(media: Media, key: string, hex: string): void {
  const file = join(media.dir, `${key}.png`);
  ffmpeg(['-f', 'lavfi', '-i', `color=c=0x${hex}:s=720x1280`, '-frames:v', '1', file]);
  media.sources[`assets/${key}.png`] = file;
  media.facts[key] = { frames: 0, audio: false, width: 720, height: 1280 };
}

/** A picture of a given size made with an ffmpeg `-vf` chain over a flat colour. */
export function drawnImage(media: Media, key: string, size: string, filters: string): void {
  const file = join(media.dir, `${key}.png`);
  const [w, h] = size.split('x').map(Number) as [number, number];
  ffmpeg(['-f', 'lavfi', '-i', `color=c=black:s=${size}`, '-vf', filters, '-frames:v', '1', file]);
  media.sources[`assets/${key}.png`] = file;
  media.facts[key] = { frames: 0, audio: false, width: w, height: h };
}

/** A silent clip of a given size made from a lavfi graph; 30 fps, H.264. */
export function drawnClip(media: Media, key: string, size: string, filters: string, frames: number): void {
  const file = join(media.dir, `${key}.mp4`);
  ffmpeg(['-f', 'lavfi', '-i', `color=c=black:s=${size}:r=30`, '-vf', filters, '-frames:v', String(frames), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', file]);
  media.sources[`assets/${key}.mp4`] = file;
  media.facts[key] = { frames: probe(file).frames, audio: false };
}

/** A sine tone as mp3 of exactly `seconds` (the real format of the music files). */
export function toneFile(media: Media, key: string, seconds: number): void {
  const file = join(media.dir, `${key}.mp3`);
  ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`, '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', file]);
  media.sources[`assets/${key}.mp3`] = file;
  media.facts[key] = { frames: Math.floor(probe(file).seconds * FPS), audio: true };
}

export interface Made { dir: string; timeline: Timeline; lint: any; check: any; output: string }

/** compose → write → lint → check at the rest frames → one render at 30 fps. */
export function build(edit: Edit, media: Media): Made {
  const composition = compose(edit, media.facts);
  const dir = mkdtempSync(join(tmpdir(), 've-case-'));
  writeComposition(dir, composition, media.sources);
  const lint = jsonOf(hyperframes(['lint', dir, '--json']).stdout);
  const at = composition.timeline.checkAt.map((frame) => String(frame / FPS)).join(',');
  const check = jsonOf(hyperframes(['check', dir, '--no-contrast', '--json', ...(at === '' ? [] : ['--at', at])]).stdout);
  mkdirSync(join(dir, 'out'), { recursive: true });
  const output = join(dir, 'out', 'render.mp4');
  const run = hyperframes(['render', dir, '--fps', '30', '--quality', 'looks', '--workers', '4', '--output', output]);
  if (run.status !== 0) throw new Error(`render failed (${run.status}): ${run.stderr.slice(-2000)}\n${run.stdout.slice(-2000)}`);
  return { dir, timeline: composition.timeline, lint, check, output };
}

/** `severity:code:selector` of every finding of a lint or check report. */
export const findings = (report: any): string[] => [...(report.findings ?? []), ...(report.lint?.findings ?? []), ...(report.runtime?.findings ?? []), ...(report.layout?.findings ?? [])]
  .map((f: any) => `${f.severity}:${f.code}:${f.selector ?? f.elementId ?? ''}`);

/** The frames of a rendered file, decoded. */
export function frames(made: Made, wanted: number[]): Map<number, Picture> {
  const all = [...new Set(wanted.filter((f) => f >= 0 && f < made.timeline.frames))].sort((a, b) => a - b);
  const pictures = new Map<number, Picture>();
  for (let i = 0; i < all.length; i += 12) {                    // a few at a time: a loaded machine refuses a large allocation
    for (const [n, picture] of decode(made.output, made.timeline.width, made.timeline.height, all.slice(i, i + 12))) pictures.set(n, { ...picture, rgb: Uint8Array.from(picture.rgb) });
  }
  return pictures;
}

export type Rgb = [number, number, number];
export const hexOf = (hex: string): Rgb => [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
/** A test: a pixel within `tolerance` (per channel) of a colour. */
export const near = (colour: Rgb, tolerance = 28) => (r: number, g: number, b: number) =>
  Math.abs(r - colour[0]) <= tolerance && Math.abs(g - colour[1]) <= tolerance && Math.abs(b - colour[2]) <= tolerance;
/** The pixel at (x, y). */
export function pixel(picture: Picture, x: number, y: number): Rgb {
  const i = (y * picture.width + x) * 3;
  return [picture.rgb[i]!, picture.rgb[i + 1]!, picture.rgb[i + 2]!];
}
/** The colour a file shows at (x, y) on its first frame. */
export function colourOf(file: string, x: number, y: number): Rgb {
  const p = probe(file);
  return pixel(decode(file, p.width, p.height, [0]).get(0)!, x, y);
}
