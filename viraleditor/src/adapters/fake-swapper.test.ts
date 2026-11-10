import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GeneratorError } from '../ports.ts';
import type { SwapRequest } from '../ports.ts';
import { swapPrompt } from '../swap/prompt.ts';
import { containerFacts } from './encode.ts';
import { createFakeSwapper, swapRefusal } from './fake-swapper.ts';
import type { FakeSwapperOptions } from './fake-swapper.ts';
import { readBar } from './framebar.ts';
import { createMeasure } from './measure.ts';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const hasFfmpeg = existsSync(FFMPEG) && existsSync(FFPROBE);
const NOW = new Date('2026-10-07T10:00:00.000Z');
const TIER = { model: 'fake-swap', resolution: '720p' };

function setup(options: Partial<FakeSwapperOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vc-fake-swap-'));
  const log = join(dir, 'log', 'fake-swapper.log');
  const body = join(dir, 'body.jpg');
  writeFileSync(body, 'a photograph');
  const video = join(dir, 'p01.mp4');
  const request = (more: Partial<SwapRequest> = {}): SwapRequest => ({ video, people: [{ slot: 1, body, face: null, hint: 'the woman in the middle' }], seconds: 3, tier: TIER, keepSound: false, ...more });
  const lines = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((row) => JSON.parse(row) as Record<string, unknown>) : []);
  return { dir, log, video, body, request, lines, swapper: createFakeSwapper({ log, ffmpeg: FFMPEG, ffprobe: FFPROBE, clock: { now: () => NOW }, ...options }) };
}
/** Three seconds of a moving test picture with a tone: the part of a video a swap is asked for. */
function part(to: string): void {
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=180x320:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', to]);
}
const codeOf = async (promise: Promise<unknown>): Promise<unknown> => promise.then(() => 'no error', (error: unknown) => (error instanceof GeneratorError ? error.code : error));

describe('swapRefusal', () => {
  const { request } = setup();
  it('takes a part of 3 to 10 seconds with one or two people', () => {
    expect(swapRefusal(request())).toBeNull();
    expect(swapRefusal(request({ seconds: 10, people: [request().people[0]!, { ...request().people[0]!, slot: 2 }] }))).toBeNull();
  });
  it('names why it refuses a part that is too short or too long, and no person or three', () => {
    expect(swapRefusal(request({ seconds: 2.5 }))).toMatch(/3 to 10 seconds/);
    expect(swapRefusal(request({ seconds: 10.5 }))).toMatch(/3 to 10 seconds/);
    expect(swapRefusal(request({ people: [] }))).toMatch(/1 to 2 people/);
    expect(swapRefusal(request({ people: [1, 2, 3].map((slot) => ({ ...request().people[0]!, slot })) }))).toMatch(/1 to 2 people/);
  });
});

describe.skipIf(!hasFfmpeg)('fake swapper', () => {
  it('writes the request into its log, hands out the ticket, then makes the part again in the same shape, without its sound', async () => {
    const { dir, video, request, lines, swapper } = setup();
    part(video);
    const to = join(dir, 'out', 'clip-p01.mp4');
    const seen: unknown[] = [];
    const made = await swapper.replace(request(), to, (ticket) => { seen.push(ticket, lines().length, existsSync(to)); });
    expect(seen).toEqual(['fake-swap-1', 1, false]);
    expect(made).toEqual({ taskId: 'fake-swap-1', file: to });
    expect(lines()).toEqual([{ kind: 'swap', video, seconds: 3, slots: [1], side: ['no'], prompt: swapPrompt(request().people), ticket: 'fake-swap-1', at: NOW.toISOString() }]);
    expect(await containerFacts(FFPROBE, to, 10_000)).toMatchObject({ width: 180, height: 320, fps: 30, frames: 90, audio: false });
  });
  it('writes the clothes the request asks for into the prompt of its log line', async () => {
    const { dir, video, request, lines, swapper } = setup();
    part(video);
    await swapper.replace(request({ outfit: 'photo' }), join(dir, 'out', 'clip-p01.mp4'), () => {});
    expect(lines()[0]!.prompt).toBe(swapPrompt(request().people, { outfit: 'photo' }));
  });
  it('says of each person only whether a side photograph came with the request: the file is never read, where it is is not written, and the prompt does not change', async () => {
    const { dir, log, video, request, lines, swapper } = setup();
    part(video);
    const [person] = request().people;
    const people = [{ ...person!, side: join(dir, 'side-that-is-not-there.jpg') }, { ...person!, slot: 2 }];
    await swapper.replace(request({ people }), join(dir, 'out', 'clip-p01.mp4'), () => {});
    expect(lines()[0]).toMatchObject({ slots: [1, 2], side: ['yes', 'no'], prompt: swapPrompt([person!, { ...person!, slot: 2 }]) });
    expect(readFileSync(log, 'utf8')).not.toContain('side-that-is-not-there');
  });
  it('paints a flat box where the person stands and the frame bar over every frame', async () => {
    const { dir, video, request, swapper } = setup();
    part(video);
    const to = join(dir, 'clip.mp4');
    await swapper.replace(request(), to, () => {});
    const picture = await createMeasure(FFMPEG, FFPROBE).picture(to, 47);
    expect(readBar(picture.rgb, picture.width, picture.height)).toBe(47);
    const at = (x: number, y: number) => [...picture.rgb.subarray((y * picture.width + x) * 3, (y * picture.width + x) * 3 + 3)];
    const [one, other] = [at(60, 240), at(120, 280)];
    one.forEach((value, channel) => expect(Math.abs(value - other[channel]!)).toBeLessThan(12));      // one colour all over the box, where the test picture has many
  });

  it('asked again by a ticket, makes the same file and writes no line', async () => {
    const { dir, video, request, lines, swapper } = setup();
    part(video);
    await swapper.replace(request(), join(dir, 'first.mp4'), () => {});
    const again = await swapper.resume('fake-swap-1', join(dir, 'again.mp4'));
    expect(again).toEqual({ taskId: 'fake-swap-1', file: join(dir, 'again.mp4') });
    expect((await containerFacts(FFPROBE, join(dir, 'again.mp4'), 10_000)).frames).toBe(90);
    expect(lines()).toHaveLength(1);
    expect(await codeOf(swapper.resume('fake-swap-9', join(dir, 'none.mp4')))).toBe('submission-unknown');
  });

  it('fails the request it was told to fail, after accepting it, and the ones around it are made', async () => {
    const { dir, video, request, lines, swapper } = setup({ failSwap: 2 });
    part(video);
    await swapper.replace(request(), join(dir, 'one.mp4'), () => {});
    const failed = await swapper.replace(request(), join(dir, 'two.mp4'), () => {}).catch((error: unknown) => error);
    expect(failed).toMatchObject({ code: 'task-failed', ticket: 'fake-swap-2' });
    await swapper.replace(request(), join(dir, 'three.mp4'), () => {});
    expect(lines().map((line) => line.ticket)).toEqual(['fake-swap-1', 'fake-swap-2', 'fake-swap-3']);
    expect([existsSync(join(dir, 'two.mp4')), existsSync(join(dir, 'three.mp4'))]).toEqual([false, true]);
    expect(await codeOf(swapper.resume('fake-swap-2', join(dir, 'two.mp4')))).toBe('task-failed');   // the same after a restart
  });

  it('starts nothing for a request it refuses or whose photograph is not there', async () => {
    const { dir, video, request, lines, swapper } = setup();
    part(video);
    let accepted = 0;
    expect(await codeOf(swapper.replace(request({ seconds: 12 }), join(dir, 'a.mp4'), () => { accepted += 1; }))).toBe('rejected');
    expect(await codeOf(swapper.replace(request({ people: [{ slot: 1, body: join(dir, 'gone.jpg'), face: null, hint: 'x' }] }), join(dir, 'b.mp4'), () => { accepted += 1; }))).toBe('upload-failed');
    expect([accepted, lines().length, swapper.refusal(request({ seconds: 12 })) !== null]).toEqual([0, 0, true]);
  });

  it('is ready when ffmpeg runs', async () => {
    expect(await setup().swapper.ready()).toEqual({ ready: true, note: null });
    expect((await setup({ ffmpeg: '/nowhere/ffmpeg' }).swapper.ready()).ready).toBe(false);
  });
});
