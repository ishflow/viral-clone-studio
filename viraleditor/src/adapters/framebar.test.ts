import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BAR_FRAMES, barFilter, readBar } from './framebar.ts';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const hasFfmpeg = existsSync(FFMPEG);
const SLOW = 120_000;   // other renders may be running on this machine

function ffmpeg(args: string[]): void {
  const run = spawnSync(FFMPEG, ['-v', 'error', '-y', ...args]);
  if (run.status !== 0) throw new Error(run.stderr.toString());
}

/** A flat-colour clip with the bar, encoded as H.264 at the editor's render quality (CRF 16). */
function makeClip(to: string, width: number, height: number, fps: number, seconds: number): void {
  ffmpeg(['-f', 'lavfi', '-i', `color=c=0x2b6a8a:s=${width}x${height}:r=${fps}:d=${seconds}`,
    '-vf', barFilter({ width, height, fps }), '-frames:v', String(seconds * fps),
    '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', to]);
}

/** Decodes every frame of a file (through `filter`, when given) and reads its bar; memory stays at one frame. */
function readEvery(file: string, width: number, height: number, filter: string | null): Promise<(number | null)[]> {
  return new Promise((resolve, reject) => {
    const size = width * height * 3;
    const child = spawn(FFMPEG, ['-v', 'error', '-i', file, ...(filter === null ? [] : ['-vf', filter]),
      '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const read: (number | null)[] = [];
    let rest = Buffer.alloc(0);
    let problem = '';
    child.stdout.on('data', (chunk: Buffer) => {
      rest = Buffer.concat([rest, chunk]);
      while (rest.length >= size) {
        read.push(readBar(rest.subarray(0, size), width, height));
        rest = rest.subarray(size);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { problem += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => { if (code === 0 && rest.length === 0) resolve(read); else reject(new Error(problem || `exit ${code}, ${rest.length} bytes left`)); });
  });
}

const numbers = (count: number): number[] => Array.from({ length: count }, (_, k) => k);
const cover = (width: number, height: number): string =>
  `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;

/** A 720×1280 frame painted by hand: flat colour, one white bar in the upper half, one in the lower half. */
function painted(upper: [number, number] | null, lower: [number, number] | null): Uint8Array {
  const width = 720, height = 1280;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const bar = y < 640 ? upper : lower;
    for (let x = 0; x < width; x++) {
      const white = bar !== null && x >= bar[0] && x < bar[1];
      rgb.set(white ? [255, 255, 255] : [43, 106, 138], (y * width + x) * 3);
    }
  }
  return rgb;
}
function whiteBox(rgb: Uint8Array, left: number, top: number, right: number, bottom: number): void {
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) rgb.set([255, 255, 255], (y * 720 + x) * 3);
}

describe('readBar on frames painted by hand', () => {
  // The width is 32 columns of 22.5 px. Units of the frame number: upper half, column units + 1.
  // Thirties: lower half, column thirties + 1.
  it('frame 0: both bars in column 1', () => {
    expect(readBar(painted([22, 45], [22, 45]), 720, 1280)).toBe(0);
  });
  it('frame 37 = 7 + 30 × 1: upper bar in column 8, lower bar in column 2', () => {
    expect(readBar(painted([180, 203], [45, 68]), 720, 1280)).toBe(37);
  });
  it('frame 899 = 29 + 30 × 29: both bars in column 30', () => {
    expect(readBar(painted([675, 698], [675, 698]), 720, 1280)).toBe(899);
  });
  it('a frame without a bar is null', () => {
    expect(readBar(painted(null, null), 720, 1280)).toBeNull();
    expect(readBar(painted([180, 203], null), 720, 1280)).toBeNull();
    expect(readBar(new Uint8Array(720 * 1280 * 3).fill(255), 720, 1280)).toBeNull();
    expect(readBar(new Uint8Array(720 * 1280 * 3), 720, 1280)).toBeNull();
  });
  it('a bar in a margin column (0 or 31) is null', () => {
    expect(readBar(painted([0, 22], [22, 45]), 720, 1280)).toBeNull();
    expect(readBar(painted([22, 45], [698, 720]), 720, 1280)).toBeNull();
  });
  it('a buffer of the wrong size is null', () => {
    expect(readBar(new Uint8Array(100), 720, 1280)).toBeNull();
  });
  it('white text lines over the frame do not change the reading', () => {
    const rgb = painted([180, 203], [45, 68]);
    for (let top = 100; top < 1280; top += 150) {     // eight lines of "text": white blocks with gaps
      for (let left = 60; left < 660; left += 40) whiteBox(rgb, left, top, left + 24, top + 40);
    }
    expect(readBar(rgb, 720, 1280)).toBe(37);
  });
  it('a white box that is not a bar does not give a number', () => {
    const rgb = painted(null, null);
    whiteBox(rgb, 100, 0, 400, 1280);                 // much wider than a column
    expect(readBar(rgb, 720, 1280)).toBeNull();
  });
});

describe.skipIf(!hasFfmpeg)('barFilter with ffmpeg', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vc-bar-'));

  it('every frame of a 720×1280 clip at 30 fps reads back as its own number', async () => {
    const clip = join(dir, 'p.mp4');
    makeClip(clip, 720, 1280, 30, 2);
    expect(await readEvery(clip, 720, 1280, null)).toEqual(numbers(60));
  }, SLOW);

  it('all 900 numbers read back; frame 900 reads as 0 again', async () => {
    expect(BAR_FRAMES).toBe(900);
    const clip = join(dir, 'long.mp4');
    makeClip(clip, 360, 640, 30, 31);
    expect(await readEvery(clip, 360, 640, null)).toEqual([...numbers(900), ...numbers(30)]);
  }, SLOW);

  it('survives a cover-crop and rescale from 1072×1928 at 24 fps to 720×1280 and to 1080×1920, re-encoded as H.264', async () => {
    const source = join(dir, 'provider.mp4');
    makeClip(source, 1072, 1928, 24, 2);
    expect(await readEvery(source, 1072, 1928, null)).toEqual(numbers(48));
    for (const [width, height] of [[720, 1280], [1080, 1920]] as const) {
      const normal = join(dir, `n${width}.mp4`);
      ffmpeg(['-i', source, '-vf', cover(width, height), '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', normal]);
      expect(await readEvery(normal, width, height, null)).toEqual(numbers(48));
    }
  }, SLOW);

  it('still reads after a much harder compression (CRF 32) and a decode at another size', async () => {
    const clip = join(dir, 'p2.mp4');
    makeClip(clip, 720, 1280, 30, 2);
    const hard = join(dir, 'hard.mp4');
    ffmpeg(['-i', clip, '-c:v', 'libx264', '-crf', '32', '-pix_fmt', 'yuv420p', hard]);
    expect(await readEvery(hard, 540, 960, 'scale=540:960')).toEqual(numbers(60));
  }, SLOW);
});
