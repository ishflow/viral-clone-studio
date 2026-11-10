// What the tests of a person-swap preparation share: a video made on this machine, a downloader that copies it instead of
// fetching anything, and the row and the run the site writes when an admin gives a link or a file.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { RunInput } from '../contracts.ts';
import { claim, enqueue } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import * as templates from '../db/templates.ts';
import type { Clock, Downloader } from '../ports.ts';
import { FFMPEG, SIZE } from './testing.ts';

type PrepareInput = Extract<RunInput, { kind: 'prepare' }>;

/** What a model answers for a video of one person. */
export const ONE_PERSON = { people: 1, persons: [{ box: { left: 25, top: 30, right: 75, bottom: 95 }, hint: 'the woman in the middle in a green shirt' }] };

const made = new Map<string, string>();
/** A video of `seconds` seconds with a tone: a moving test picture, and from `cutAt` (a second) on another picture. Made once for a length and a cut. */
export function video(seconds: number, cutAt?: number): string {
  const key = `${seconds}:${cutAt ?? ''}`;
  let file = made.get(key);
  if (file === undefined) {
    file = join(mkdtempSync(join(tmpdir(), 've-swap-video-')), 'video.mp4');
    const size = `s=${SIZE.width}x${SIZE.height}:r=${SIZE.fps}`, first = cutAt ?? seconds;
    const pictures = ['-f', 'lavfi', '-i', `testsrc2=${size}:d=${first}`, ...(cutAt === undefined ? [] : ['-f', 'lavfi', '-i', `smptebars=${size}:d=${seconds - first}`])];
    const sound = ['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`];
    const joined = cutAt === undefined ? ['-map', '0:v', '-map', '1:a'] : ['-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-map', '2:a'];
    execFileSync(FFMPEG, ['-v', 'error', '-y', ...pictures, ...sound, ...joined, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', file]);
    made.set(key, file);
  }
  return file;
}

/** A downloader that fetches nothing: it copies `file` into the folder it is given, and remembers what it was asked for. */
export function copying(file: string, title = 'a dance in the kitchen'): Downloader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async video(url, toDir) {
      calls.push(url);
      mkdirSync(toDir, { recursive: true });
      const to = join(toDir, 'video.mp4');
      copyFileSync(file, to);
      return { file: to, title, seconds: 0, views: 1_200_000, likes: 80_000 };
    },
  };
}

/** The row and the run the site writes for a person-swap template an admin asked for, the run claimed by `worker-test`. */
export function beginPrepare(db: DatabaseSync, clock: Clock, templateId: string, from: PrepareInput['from'], ownerId: string | null = null): RunRow {
  templates.upsert(db, {
    id: templateId, state: 'preparing', owner: null, sourceKind: from.kind === 'upload' ? 'upload' : 'link', sourceUrl: from.kind === 'link' ? from.url : null, note: null,
    card: { title: 'Uploaded video', category: '', format: 'no-talking', seconds: 0, referenceViews: '', image: null, video: null, products: 0, shots: [], description: '', tags: [] },
    estimate: null, minutes: null,
  }, clock.now());
  enqueue(db, { kind: 'prepare', templateId, ownerId, mode: 'swap', from }, templateId, null, clock.now());
  const run = claim(db, 'worker-test', clock.now());
  if (run === null) throw new Error('the run was not claimed');
  return run;
}
