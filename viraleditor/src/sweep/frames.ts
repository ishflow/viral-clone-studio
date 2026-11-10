// Every frame of an mp4, one after the other (a pipe, so a long video never sits in memory), and the measures taken on a frame.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Picture } from '../compose/golden-helpers.ts';
import { FFMPEG } from './media.ts';

/** Calls `each(n, picture)` for frame 0, 1, 2 … of the file, in order; the picture's bytes are reused: copy what must outlive the call. */
export function streamFrames(file: string, width: number, height: number, each: (n: number, picture: Picture) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const size = width * height * 3;
    const buffer = new Uint8Array(size);
    const picture: Picture = { width, height, rgb: buffer };
    let filled = 0;
    let n = 0;
    let said = '';
    let failed: unknown = null;                       // `each` threw: ffmpeg is stopped and the promise rejects with that error
    child.stderr.on('data', (chunk: Buffer) => { said += chunk.toString(); });
    child.stdout.on('data', (chunk: Buffer) => {
      if (failed !== null) return;
      let at = 0;
      while (at < chunk.length) {
        const take = Math.min(size - filled, chunk.length - at);
        buffer.set(chunk.subarray(at, at + take), filled);
        filled += take; at += take;
        if (filled === size) {
          try { each(n++, picture); } catch (error) { failed = error; child.kill('SIGKILL'); reject(error); return; }
          filled = 0;
        }
      }
    });
    child.on('error', reject);
    child.on('close', (code) => (failed !== null ? undefined : code === 0 ? resolve(n) : reject(new Error(`ffmpeg exited ${code}: ${said.slice(-500)}`))));
  });
}

/** PNG stills of the frames with these numbers, written as `<dir>/<name>-<frame>.png`. Returns the paths. */
export function stills(file: string, dir: string, name: string, frames: number[]): string[] {
  mkdirSync(dir, { recursive: true });
  return [...new Set(frames)].sort((a, b) => a - b).map((n) => {
    const to = join(dir, `${name}-${String(n).padStart(4, '0')}.png`);
    spawnSync(FFMPEG, ['-v', 'error', '-y', '-i', file, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', to]);
    return to;
  });
}

export interface Box { x: number; y: number; width: number; height: number }
export type Weight = (r: number, g: number, b: number) => number;
const white = (g: number, b: number) => g > 200 && b > 200;                       // the frame bar of a clip
/** Text and card colours have the red channel at 255 and every picture of the sweep has it at 0: red is the opacity of what is drawn. */
export const red: Weight = (r, g, b) => (white(g, b) ? 0 : r / 255);
/** The active colour of a caption (green) on the dark pictures the caption documents use (green channel under 45). */
export const green: Weight = (r, g) => (r > 128 ? 0 : Math.max(0, g - 45) / 210);
/** A pill (magenta). */
export const magenta: Weight = (r, g, b) => (white(g, b) ? 0 : Math.min(r, b) / 255);

export const clampBox = (box: Box, width: number, height: number): Box => {
  const x = Math.max(0, Math.floor(box.x)); const y = Math.max(0, Math.floor(box.y));
  return { x, y, width: Math.max(0, Math.min(width, Math.ceil(box.x + box.width)) - x), height: Math.max(0, Math.min(height, Math.ceil(box.y + box.height)) - y) };
};
export const grow = (box: Box, dx: number, dy: number): Box => ({ x: box.x - dx, y: box.y - dy, width: box.width + 2 * dx, height: box.height + 2 * dy });

export interface Measure { mass: number; cx: number; cy: number; edge: number; solid: number }
/** Mass (sum of the weight), its centroid, the edge length (sum of the weight's steps) and the solid mass (weight at or above `solidLevel`) inside a box. */
export function measure(p: Picture, rect: Box, w: Weight, withEdge = false, solidLevel = 2): Measure {
  const box = clampBox(rect, p.width, p.height);
  let mass = 0; let sx = 0; let sy = 0; let edge = 0; let solid = 0;
  const prev = new Float32Array(box.width);
  for (let y = box.y; y < box.y + box.height; y++) {
    let left = 0;
    for (let x = box.x; x < box.x + box.width; x++) {
      const i = (y * p.width + x) * 3;
      const v = w(p.rgb[i]!, p.rgb[i + 1]!, p.rgb[i + 2]!);
      mass += v; sx += v * x; sy += v * y;
      if (v >= solidLevel) solid += v;
      if (withEdge) {
        const k = x - box.x;
        if (k > 0) edge += Math.abs(v - left);
        if (y > box.y) edge += Math.abs(v - prev[k]!);
        left = v; prev[k] = v;
      }
    }
  }
  return { mass, cx: mass > 0 ? sx / mass : 0, cy: mass > 0 ? sy / mass : 0, edge, solid };
}

/** The 90th percentile of the weight over a patch: a bar of the clip crossing the patch does not hide a card. */
export function patch90(p: Picture, cx: number, cy: number, half: number, w: Weight): number {
  const values: number[] = [];
  for (let y = Math.max(0, cy - half); y < Math.min(p.height, cy + half); y++) for (let x = Math.max(0, cx - half); x < Math.min(p.width, cx + half); x++) {
    const i = (y * p.width + x) * 3;
    values.push(w(p.rgb[i]!, p.rgb[i + 1]!, p.rgb[i + 2]!));
  }
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length * 0.9)] ?? 0;
}

/** The bounding box of the pixels whose weight is above `level` inside `rect`; null when none is. */
export function extent(p: Picture, rect: Box, w: Weight, level = 0.5): { x0: number; x1: number; y0: number; y1: number } | null {
  const box = clampBox(rect, p.width, p.height);
  let x0 = Infinity; let x1 = -1; let y0 = Infinity; let y1 = -1;
  for (let y = box.y; y < box.y + box.height; y++) for (let x = box.x; x < box.x + box.width; x++) {
    const i = (y * p.width + x) * 3;
    if (w(p.rgb[i]!, p.rgb[i + 1]!, p.rgb[i + 2]!) > level) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
  }
  return x1 < 0 ? null : { x0, x1, y0, y1 };
}

export const median = (values: number[]): number => (values.length === 0 ? 0 : [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!);
