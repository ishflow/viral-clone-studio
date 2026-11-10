// fetchSource with a range, against a real file and the real ffmpeg: a fake media port does not check a range against the clip, so only this shows
// what happens when the downloader's length and the file's own length differ by a fraction of a second.
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runProcess } from '../adapters/exec.ts';
import { createMedia } from '../adapters/media.ts';
import type { Downloader } from '../ports.ts';
import { RangeRefused, fetchSource } from './read.ts';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const have = existsSync(FFMPEG) && existsSync(FFPROBE);
const T = 120_000;

describe.skipIf(!have)('fetchSource with a range, on a real clip', () => {
  const media = createMedia(FFMPEG, FFPROBE);
  const dir = mkdtempSync(join(tmpdir(), 've-read-range-'));
  const clip = join(dir, 'clip.mp4');                                   // 9.9 s long: what a download "of 10 s" often really is
  beforeAll(async () => {
    const made = await runProcess(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=24:duration=9.9', '-pix_fmt', 'yuv420p', clip]);
    if (made.code !== 0) throw new Error(made.stderr);
  }, T);

  /** A downloader that says `says` seconds for the clip, as yt-dlp does in whole seconds. */
  const downloader = (says: number): Downloader => ({
    video: async (_url: string, to: string) => { const file = join(to, 'downloaded.mp4'); copyFileSync(clip, file); return { file, title: 'a clip', seconds: says, views: null, likes: null }; },
  });
  const fetched = (says: number, range: { from: number; to: number }) => fetchSource({ downloader: downloader(says), media }, mkdtempSync(join(dir, 'src-')), 'https://example.com/v', 0, range);

  it('"to the end" of a download that says 10 s but is 9.9 s long is cut to the end of the file, not refused', async () => {
    const source = await fetched(10, { from: 5, to: 10 });
    expect(source.seconds).toBeCloseTo(4.9, 1);
    expect((await media.probe(source.video)).seconds).toBeCloseTo(4.9, 1);
  }, T);

  it('a range that ends more than half a second after the real end of the file is still refused', async () => {
    await expect(fetched(10, { from: 5, to: 10.5 })).rejects.toBeInstanceOf(RangeRefused);
  }, T);
});
