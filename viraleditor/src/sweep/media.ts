// Media of the accuracy sweep, made with ffmpeg. Every picture says what it is by colour: the red channel is 0 in all of
// it, so text and cards (red channel 255) can be measured on any background. A clip carries two marks: its whole picture is
// one flat colour that names the frame number modulo 64 (green: n mod 8 in steps of 24, blue: (n div 8) mod 8 in steps of
// 24), which survives any zoom or crop, and the frame bar of framebar.ts on top, which names the number exactly.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { barFilter } from '../adapters/framebar.ts';
import type { ComposeFacts } from '../edit/types.ts';
import { probe } from '../compose/golden-helpers.ts';

const find = (name: string) => [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`].find((path) => existsSync(path))!;
export const FFMPEG = find('ffmpeg');
export const FFPROBE = find('ffprobe');
export type Rgb = [number, number, number];

export interface SweepMedia { dir: string; sources: Record<string, string>; facts: Record<string, ComposeFacts>; colours: Record<string, Rgb>; clips: Set<string>; bars: Set<string> }

function ffmpeg(args: string[]): void {
  const run = spawnSync(FFMPEG, ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}: ${run.stderr}`);
}

/** The colour a clip shows on its frame n. */
export const codeColour = (n: number): Rgb => [0, (n % 8) * 24, (Math.floor(n / 8) % 8) * 24];

export const IMAGES: Record<string, Rgb> = { 'img-p': [0, 60, 110], 'img-q': [0, 120, 60], 'img-r': [0, 150, 170], 'img-s': [0, 40, 40], 'img-t': [0, 90, 20], 'img-u': [0, 8, 24] };
export const CARDS: Record<string, { colour: Rgb; width: number; height: number }> = {
  'card-wide': { colour: [255, 140, 0], width: 480, height: 320 },
  'card-tall': { colour: [255, 60, 160], width: 300, height: 500 },
};

export function sweepMedia(): SweepMedia {
  const dir = mkdtempSync(join(tmpdir(), 've-sweep-media-'));
  const media: SweepMedia = { dir, sources: {}, facts: {}, colours: {}, clips: new Set(), bars: new Set() };
  for (const key of ['va', 'vb', 'vc', 'vx', 'vy', 'vz']) {                // vx, vy, vz: the same without the frame bar (text documents: a bar crossing a line of text is not text)
    const file = join(dir, `${key}.mp4`);
    const withBar = key < 'vx';
    const graph = 'color=c=black:s=720x1280:r=30,format=gbrp,geq=r=0:g=mod(N\\,8)*24:b=mod(floor(N/8)\\,8)*24';
    ffmpeg(['-f', 'lavfi', '-i', graph, '-vf', `${withBar ? `${barFilter({ width: 720, height: 1280, fps: 30 })},` : ''}scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`, '-frames:v', '150', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-r', '30', file]);
    media.sources[`assets/${key}.mp4`] = file;
    media.facts[key] = { frames: probe(file).frames, audio: false };
    media.clips.add(key);
    if (withBar) media.bars.add(key);
  }
  for (const [key, colour] of Object.entries(IMAGES)) {
    const file = join(dir, `${key}.png`);
    ffmpeg(['-f', 'lavfi', '-i', `color=c=0x${colour.map((c) => c.toString(16).padStart(2, '0')).join('')}:s=720x1280`, '-frames:v', '1', file]);
    media.sources[`assets/${key}.png`] = file;
    media.facts[key] = { frames: 0, audio: false, width: 720, height: 1280 };
    media.colours[key] = colour;
  }
  for (const [key, c] of Object.entries(CARDS)) {
    const file = join(dir, `${key}.png`);
    ffmpeg(['-f', 'lavfi', '-i', `color=c=0x${c.colour.map((v) => v.toString(16).padStart(2, '0')).join('')}:s=${c.width}x${c.height}`, '-frames:v', '1', file]);
    media.sources[`assets/${key}.png`] = file;
    media.facts[key] = { frames: 0, audio: false, width: c.width, height: c.height };
    media.colours[key] = c.colour;
  }
  return media;
}

/** A sine tone as mp3 of `seconds` (a length that is no multiple of three frames makes the loop cut a pass short). */
export function toneFile(media: SweepMedia, key: string, seconds: number, hz = 440): void {
  const file = join(media.dir, `${key}.mp3`);
  ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=48000:duration=${seconds}`, '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', file]);
  media.sources[`assets/${key}.mp3`] = file;
  media.facts[key] = { frames: Math.floor(probe(file).seconds * 30), audio: true };
}
