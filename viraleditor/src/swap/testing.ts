// What the tests of a person swap share: a real template made on this machine (a moving test picture with a tone, cut
// into the parts `segmentsOf` gives), a run of it, and the real tools.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createMeasure } from '../adapters/measure.ts';
import { createMedia } from '../adapters/media.ts';
import { createSplicer } from '../adapters/splice.ts';
import type { CardSwap, Paid, RunInput } from '../contracts.ts';
import { claim, enqueue, getRun } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import { abs, rel } from '../paths.ts';
import type { Clock } from '../ports.ts';
import { PHOTOGRAPH, put } from '../produce/testing.ts';
import { countOf } from '../produce/plan.ts';
import { needsOf, partOf, sourceOf } from './plan.ts';
import { segmentsOf } from './segments.ts';

export const FFMPEG = '/opt/homebrew/bin/ffmpeg';
export const FFPROBE = '/opt/homebrew/bin/ffprobe';
export const hasFfmpeg = existsSync(FFMPEG) && existsSync(FFPROBE);
export const SIZE = { width: 180, height: 320, fps: 30 };
export const TEMPLATE = 'swap-1';
export const BODY = 'uploads/u1/body.png';
export const tools = () => ({ media: createMedia(FFMPEG, FFPROBE), measure: createMeasure(FFMPEG, FFPROBE), splicer: createSplicer({ ffmpeg: FFMPEG, ffprobe: FFPROBE }) });

/** A clip of a moving test picture, `frames` frames long, at `to`. */
export function clip(to: string, frames: number, size = SIZE): void {
  mkdirSync(dirname(to), { recursive: true });
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=${size.width}x${size.height}:r=${size.fps}`, '-frames:v', String(frames), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', to]);
}

const made = new Map<number, { dir: string; swap: CardSwap }>();
/**
 * templates/swap-1 in the data dir of this test (`workspace()` first): source.mp4 of `seconds` seconds with a tone, its parts and
 * swap.json for one person, and that person's photograph under uploads/. The files are made once for a length and copied.
 */
export async function seedSwap(seconds: number): Promise<CardSwap> {
  let kept = made.get(seconds);
  if (kept === undefined) {
    const dir = mkdtempSync(join(tmpdir(), 've-swap-template-'));
    const source = join(dir, 'source.mp4');
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=${SIZE.width}x${SIZE.height}:r=${SIZE.fps}:d=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', source]);
    const swap: CardSwap = { people: 1, persons: [{ slot: 1, box: { left: 20, top: 45, right: 80, bottom: 95 }, hint: 'the person in the middle' }], parts: segmentsOf(seconds, [], SIZE.fps), sound: true };
    mkdirSync(join(dir, 'parts'));
    for (const part of swap.parts) await tools().media.trim(source, part.from, part.to, join(dir, 'parts', `p${String(part.n).padStart(2, '0')}.mp4`));
    writeFileSync(join(dir, 'swap.json'), JSON.stringify(swap));
    made.set(seconds, kept = { dir, swap });
  }
  cpSync(kept.dir, abs(dirname(sourceOf(TEMPLATE))), { recursive: true });
  put(BODY, PHOTOGRAPH);
  return kept.swap;
}

export const inputOf = (more: Partial<Extract<RunInput, { kind: 'produce' }>> = {}): RunInput =>
  ({ kind: 'produce', templateId: TEMPLATE, ownerId: 'u1', quality: 'fast', variants: 1, language: 'en', products: [], sample: false, swap: { people: [{ slot: 1, body: BODY, face: null }] }, ...more });

/** A confirmed run of the template, claimed by `worker-test`; approved: everything the template needs, unless told otherwise. */
export function startSwap(db: DatabaseSync, clock: Clock, swap: CardSwap, approved?: Paid, input: RunInput = inputOf()): RunRow {
  const id = enqueue(db, input, `job-${Math.random().toString(36).slice(2)}`, approved ?? countOf(needsOf(swap, 'any')), clock.now());
  claim(db, 'worker-test', clock.now());
  return getRun(db, id)!;
}
export const partFile = (n: number): string => abs(partOf(TEMPLATE, n));
export const finalOf = (runId: string): string => abs(rel('jobs', runId, 'v1', 'final.mp4'));
