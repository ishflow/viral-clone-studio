import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { barFilter, readBar } from './framebar.ts';
import { createMeasure } from './measure.ts';
import { MediaError } from './media.ts';
import { createSplicer, labelBox } from './splice.ts';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const hasFfmpeg = existsSync(FFMPEG) && existsSync(FFPROBE);
const LABEL = fileURLToPath(new URL('../swap/ai-label.png', import.meta.url));
const SIZE = { width: 180, height: 320, fps: 30 };

const ffmpeg = (args: string[]) => execFileSync(FFMPEG, ['-v', 'error', '-y', ...args]);
/** A clip of `frames` frames of a flat colour that carries the frame bar: every frame says which one it is. */
function clip(dir: string, name: string, frames: number, colour: string, size = SIZE): string {
  const to = join(dir, name);
  ffmpeg(['-f', 'lavfi', '-i', `color=c=0x${colour}:s=${size.width}x${size.height}:r=${size.fps}`, '-vf', barFilter(size), '-frames:v', String(frames), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', to]);
  return to;
}
function tone(dir: string, seconds: number): string {
  const to = join(dir, 'sound.m4a');
  ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`, '-c:a', 'aac', to]);
  return to;
}
const comment = (file: string): string => execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format_tags=comment', '-of', 'csv=p=0', file]).toString().trim();
const setup = () => ({ dir: mkdtempSync(join(tmpdir(), 'vc-splice-')), splicer: createSplicer({ ffmpeg: FFMPEG, ffprobe: FFPROBE }), measure: createMeasure(FFMPEG, FFPROBE) });

describe('labelBox', () => {
  it('sits in the upper left corner in the proportions of the label, on even pixels', () => {
    expect(labelBox({ width: 720, height: 1280 }, { width: 540, height: 120 })).toEqual({ left: 28, top: 28, width: 216, height: 48 });
  });
});

describe.skipIf(!hasFfmpeg)('splicer: join', () => {
  it('joins the parts frame for frame, in order, under the sound, and says what it made', async () => {
    const { dir, splicer, measure } = setup();
    const parts = [clip(dir, 'p01.mp4', 30, '8a2b2b'), clip(dir, 'p02.mp4', 45, '2b6a8a'), clip(dir, 'p03.mp4', 15, '2f7d4f')];
    const to = join(dir, 'out', 'final.mp4');
    const facts = await splicer.join(parts, tone(dir, 5), LABEL, to);
    expect(facts).toMatchObject({ width: 180, height: 320, fps: 30, frames: 90, audio: true });
    expect(facts.seconds).toBeCloseTo(3, 1);
    // each frame of the whole is the frame of its part: none dropped, none shown twice at a seam
    for (const [frame, own] of [[0, 0], [29, 29], [30, 0], [74, 44], [75, 0], [89, 14]] as const) {
      const picture = await measure.picture(to, frame);
      expect(readBar(picture.rgb, picture.width, picture.height), `frame ${frame}`).toBe(own);
    }
  });

  it('draws the label over every frame and names the file as made by AI', async () => {
    const { dir, splicer, measure } = setup();
    const to = join(dir, 'final.mp4');
    await splicer.join([clip(dir, 'p01.mp4', 30, '8a2b2b'), clip(dir, 'p02.mp4', 30, '2b6a8a')], null, LABEL, to);
    const box = labelBox(SIZE, { width: 540, height: 120 });
    for (const frame of [0, 59]) {
      const picture = await measure.picture(to, frame);
      const at = (x: number, y: number) => picture.rgb[(y * picture.width + x) * 3]!;
      expect(at(box.left + 2, box.top + 2), `plate, frame ${frame}`).toBeLessThan(60);                 // the dark plate, where the clip is a bright red
      const row = Array.from({ length: box.width }, (_, x) => at(box.left + x, box.top + Math.round(box.height / 2)));
      expect(row.some((value) => value > 180), `letters, frame ${frame}`).toBe(true);
    }
    expect(comment(to)).toBe('AI-generated');
  });

  it('a video without sound has no sound stream', async () => {
    const { dir, splicer } = setup();
    const facts = await splicer.join([clip(dir, 'p01.mp4', 30, '8a2b2b')], null, LABEL, join(dir, 'final.mp4'));
    expect(facts).toMatchObject({ frames: 30, audio: false });
  });

  it('rejects a part that cannot be read, and parts of different shapes, and writes nothing', async () => {
    const { dir, splicer } = setup();
    const good = clip(dir, 'p01.mp4', 30, '8a2b2b');
    const broken = join(dir, 'p02.mp4');
    writeFileSync(broken, 'not a video');
    const to = join(dir, 'final.mp4');
    await expect(splicer.join([good, broken], null, LABEL, to)).rejects.toBeInstanceOf(MediaError);
    await expect(splicer.join([good, clip(dir, 'p03.mp4', 30, '2b6a8a', { width: 320, height: 180, fps: 30 })], null, LABEL, to)).rejects.toThrow(/p03\.mp4.*320x180/);
    await expect(splicer.join([], null, LABEL, to)).rejects.toBeInstanceOf(MediaError);
    expect(existsSync(to)).toBe(false);
  });
});

describe.skipIf(!hasFfmpeg)('splicer: fit', () => {
  it('holds the last frame of a part that is too short and cuts one that is too long, at the size and rate asked for, without sound', async () => {
    const { dir, splicer, measure } = setup();
    const short = await splicer.fit(clip(dir, 'short.mp4', 28, '8a2b2b', { width: 360, height: 640, fps: 30 }), join(dir, 'fit', 'short.mp4'), { ...SIZE, frames: 30 });
    expect(short).toMatchObject({ width: 180, height: 320, fps: 30, frames: 30, audio: false });
    const last = await measure.picture(join(dir, 'fit', 'short.mp4'), 29);
    expect(readBar(last.rgb, last.width, last.height)).toBe(27);
    const long = await splicer.fit(clip(dir, 'long.mp4', 33, '2b6a8a'), join(dir, 'fit', 'long.mp4'), { ...SIZE, frames: 30 });
    expect(long.frames).toBe(30);
  });
});
