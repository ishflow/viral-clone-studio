import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { GeneratorError } from '../ports.ts';
import type { ClipRequest, PaidRequest, SwapPaid } from '../ports.ts';
import { createFakeGenerator } from './fake-generator.ts';
import { createMagnific } from './magnific.ts';
import { readBar } from './framebar.ts';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const hasFfmpeg = existsSync(FFMPEG) && existsSync(FFPROBE);
const SLOW = 120_000;   // other renders may be running on this machine
const NOW = new Date('2026-10-04T10:00:00.000Z');

interface Line { kind: string; words: string; seconds: number | null; ticket: string; at: string }
const linesOf = (log: string): Line[] =>
  existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Line) : [];

function setup(options: { failClip?: number; delayMs?: number; clip?: { width: number; height: number; fps: number }; ffmpeg?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vc-fake-'));
  const log = join(dir, 'log', 'generator.jsonl');
  const generator = createFakeGenerator({ log, ffmpeg: FFMPEG, clock: { now: () => NOW }, ...options });
  const tickets: string[] = [];
  return { dir, log, generator, tickets, onSubmitted: (ticket: string): void => { tickets.push(ticket); } };
}

interface Probe { streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; nb_frames?: string; duration?: string }[]; format: { duration: string } }
function probe(file: string): Probe {
  const run = spawnSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  if (run.status !== 0) throw new Error(run.stderr.toString());
  return JSON.parse(run.stdout.toString()) as Probe;
}
/** The named frames of a video (or the one frame of an image), decoded to rgb24. */
function decode(file: string, width: number, height: number, frames: number[] = [0]): Buffer[] {
  const select = frames.map((n) => `eq(n\\,${n})`).join('+');
  const run = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-vf', `select='${select}'`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: width * height * 3 * (frames.length + 1) });
  const size = width * height * 3;
  if (run.status !== 0 || run.stdout.length !== size * frames.length) throw new Error(`decode: ${run.stderr.toString()} (${run.stdout.length} bytes)`);
  return frames.map((_, i) => run.stdout.subarray(i * size, (i + 1) * size));
}
const pixel = (rgb: Buffer, width: number, x: number, y: number): number[] => [...rgb.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
const isWhite = ([r, g, b]: number[]): boolean => r! > 200 && g! > 200 && b! > 200;
function whitePixels(rgb: Buffer): number {
  let count = 0;
  for (let i = 0; i < rgb.length; i += 3) if (rgb[i]! > 200 && rgb[i + 1]! > 200 && rgb[i + 2]! > 200) count++;
  return count;
}
function meanVolume(file: string): number {
  const run = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(run.stderr.toString())![1]);
}

const firstFrame = (seconds = 4, prompt = 'slow push in on the bottle'): ClipRequest =>
  ({ mode: 'first-frame', firstFrame: '/nowhere/s1.png', prompt, seconds, tier: { model: 'seedance-2-mini', resolution: '720p' } });
const speaker = (seconds = 4): ClipRequest =>
  ({ mode: 'speaker', presenter: '/nowhere/p.png', voice: '/nowhere/v.mp3', prompt: 'She says: I tried it', seconds, tier: { model: 'seedance-2-mini', resolution: '720p' }, aspect: '9:16' });
const image = (prompt: string) => ({ prompt, references: [], aspect: '9:16' });

describe('fake generator: the image (needs no ffmpeg)', () => {
  it('writes a 720×1280 PNG and one log line with the key words; onSubmitted comes before the file', async () => {
    const { dir, log, generator } = setup({ ffmpeg: '/nowhere/ffmpeg' });
    const to = join(dir, 'new', 'folder', 's1.png');
    const seen: { ticket: string; lines: number; file: boolean }[] = [];
    const made = await generator.image(image('A glass serum bottle on a marble shelf, soft morning light'), to,
      (ticket) => { seen.push({ ticket, lines: linesOf(log).length, file: existsSync(to) }); });
    expect(made).toEqual({ taskId: 'fake-image-1', file: to });
    expect(seen).toEqual([{ ticket: 'fake-image-1', lines: 1, file: false }]);
    expect(linesOf(log)).toEqual([
      { kind: 'image', words: 'A glass serum bottle on a marble shelf', seconds: null, ticket: 'fake-image-1', at: '2026-10-04T10:00:00.000Z' },
    ]);
    const bytes = readFileSync(to);
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([720, 1280]);
  });

  it.skipIf(!hasFfmpeg)('the PNG decodes; the words are drawn in white on a flat colour, and other words give another picture', async () => {
    const { dir, generator, onSubmitted } = setup();
    const files = [join(dir, 'a.png'), join(dir, 'b.png'), join(dir, 'c.png')];
    await generator.image(image('serum bottle'), files[0]!, onSubmitted);
    await generator.image(image('marble shelf'), files[1]!, onSubmitted);
    await generator.image(image('…'), files[2]!, onSubmitted);
    expect(probe(files[0]!).streams[0]).toMatchObject({ codec_name: 'png', width: 720, height: 1280 });
    const [a, b, c] = files.map((file) => decode(file, 720, 1280)[0]!);
    expect(isWhite(pixel(a!, 720, 5, 5))).toBe(false);
    expect(whitePixels(a!)).toBeGreaterThan(5000);
    expect(whitePixels(b!)).toBeGreaterThan(5000);
    expect(a!.equals(b!)).toBe(false);
    expect(whitePixels(c!)).toBe(0);                                  // no words: only the colour
    expect(pixel(a!, 720, 5, 5)).not.toEqual(pixel(b!, 720, 5, 5));   // a different colour per request
  }, SLOW);
});

describe.skipIf(!hasFfmpeg)('fake generator: clips and sound', () => {
  it('a clip has the asked seconds exactly, 720×1280 at 30 fps, the frame bar on every frame, and no sound', async () => {
    const { dir, log, generator, tickets, onSubmitted } = setup();
    const to = join(dir, 's1.mp4');
    await expect(generator.clip(firstFrame(4), to, onSubmitted)).resolves.toEqual({ taskId: 'fake-clip-1', file: to });
    const { streams, format } = probe(to);
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({ codec_type: 'video', codec_name: 'h264', width: 720, height: 1280, r_frame_rate: '30/1', nb_frames: '120' });
    expect(Number(format.duration)).toBe(4);
    const frames = [0, 1, 29, 30, 59, 119];
    expect(decode(to, 720, 1280, frames).map((rgb) => readBar(rgb, 720, 1280))).toEqual(frames);
    expect(tickets).toEqual(['fake-clip-1']);
    expect(linesOf(log)).toEqual([{ kind: 'clip', words: 'slow push in on the bottle', seconds: 4, ticket: 'fake-clip-1', at: '2026-10-04T10:00:00.000Z' }]);
  }, SLOW);

  it('the clip size and rate can stand for a provider clip: 1072×1928 at 24 fps, 5 s = 120 frames', async () => {
    const { dir, generator, onSubmitted } = setup({ clip: { width: 1072, height: 1928, fps: 24 } });
    const to = join(dir, 's1.mp4');
    await generator.clip(firstFrame(5), to, onSubmitted);
    expect(probe(to).streams[0]).toMatchObject({ width: 1072, height: 1928, r_frame_rate: '24/1', nb_frames: '120' });
    expect(Number(probe(to).format.duration)).toBe(5);
    expect(decode(to, 1072, 1928, [0, 47, 119]).map((rgb) => readBar(rgb, 1072, 1928))).toEqual([0, 47, 119]);
  }, SLOW);

  it('a speaker clip carries a tone as its sound; two clips have different colours', async () => {
    const { dir, generator, tickets, onSubmitted } = setup();
    const [one, two] = [join(dir, 'seg1.mp4'), join(dir, 'seg2.mp4')];
    await generator.clip(speaker(4), one, onSubmitted);
    await generator.clip(firstFrame(4), two, onSubmitted);
    const streams = probe(one).streams;
    expect(streams.map((stream) => stream.codec_type).sort()).toEqual(['audio', 'video']);
    expect(streams.find((stream) => stream.codec_type === 'video')).toMatchObject({ nb_frames: '120' });
    expect(meanVolume(one)).toBeGreaterThan(-40);
    expect(tickets).toEqual(['fake-clip-1-speaker', 'fake-clip-2']);
    const [a, b] = [pixel(decode(one, 720, 1280)[0]!, 720, 600, 640), pixel(decode(two, 720, 1280)[0]!, 720, 600, 640)];
    expect(isWhite(a)).toBe(false);
    expect(isWhite(b)).toBe(false);
    expect(Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!)).toBeGreaterThan(40);
  }, SLOW);

  it('music is 30 s of a quiet tone; a voice is a tone of 0.4 s per word', async () => {
    const { dir, log, generator, onSubmitted } = setup();
    const [bed, voice] = [join(dir, 'music.mp3'), join(dir, 'voice.mp3')];
    await expect(generator.music({ prompt: 'warm lo-fi bed, no vocals' }, bed, onSubmitted)).resolves.toEqual({ taskId: 'fake-music-1', file: bed });
    await expect(generator.voice({ text: 'I tried it for a week.', voiceId: 'voice-abc' }, voice, onSubmitted)).resolves.toEqual({ taskId: 'fake-voice-2', file: voice });
    expect(probe(bed).streams[0]).toMatchObject({ codec_type: 'audio', codec_name: 'mp3' });
    expect(Math.abs(Number(probe(bed).format.duration) - 30)).toBeLessThan(0.15);
    expect(meanVolume(bed)).toBeLessThan(-18);
    expect(meanVolume(bed)).toBeGreaterThan(-45);
    expect(Math.abs(Number(probe(voice).format.duration) - 2.4)).toBeLessThan(0.15);
    expect(linesOf(log).map(({ kind, words, seconds }) => ({ kind, words, seconds }))).toEqual([
      { kind: 'music', words: 'warm lo fi bed no vocals', seconds: 30 },
      { kind: 'voice', words: 'I tried it for a week', seconds: 2.4 },
    ]);
  }, SLOW);

  it('one log line per submitted request, numbered in the order they were submitted', async () => {
    const { dir, log, generator, onSubmitted } = setup();
    await generator.image(image('serum bottle'), join(dir, 'a.png'), onSubmitted);
    await generator.clip(firstFrame(4), join(dir, 'a.mp4'), onSubmitted);
    await generator.music({ prompt: 'bed' }, join(dir, 'm.mp3'), onSubmitted);
    await generator.voice({ text: 'two words', voiceId: 'v' }, join(dir, 'v.mp3'), onSubmitted);
    expect(linesOf(log).map(({ kind, seconds, ticket }) => ({ kind, seconds, ticket }))).toEqual([
      { kind: 'image', seconds: null, ticket: 'fake-image-1' },
      { kind: 'clip', seconds: 4, ticket: 'fake-clip-2' },
      { kind: 'music', seconds: 30, ticket: 'fake-music-3' },
      { kind: 'voice', seconds: 0.8, ticket: 'fake-voice-4' },
    ]);
  }, SLOW);

  it('failClip: 2 → the second clip fails with task-failed after onSubmitted; the first and the third are made', async () => {
    const { dir, log, generator, tickets, onSubmitted } = setup({ failClip: 2 });
    const files = [1, 2, 3].map((n) => join(dir, `s${n}.mp4`));
    await generator.image(image('not a clip'), join(dir, 'a.png'), onSubmitted);
    await generator.clip(firstFrame(4), files[0]!, onSubmitted);
    const error: unknown = await generator.clip(firstFrame(4), files[1]!, onSubmitted).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GeneratorError);
    expect(error).toMatchObject({ code: 'task-failed', ticket: 'fake-clip-3' });
    expect(tickets).toEqual(['fake-image-1', 'fake-clip-2', 'fake-clip-3']);
    await generator.clip(firstFrame(4), files[2]!, onSubmitted);
    expect(files.map((file) => existsSync(file))).toEqual([true, false, true]);
    expect(linesOf(log)).toHaveLength(4);

    // asking again for the failed one gives the same failure and no new line
    await expect(generator.resume('fake-clip-3', files[1]!)).rejects.toMatchObject({ code: 'task-failed', ticket: 'fake-clip-3' });
    expect(linesOf(log)).toHaveLength(4);
  }, SLOW);

  it('resume gives the same file again and adds no line, also from a new generator on the same log', async () => {
    const { dir, log, generator, onSubmitted } = setup();
    const [picture, clip, sound] = [join(dir, 'a.png'), join(dir, 'a.mp4'), join(dir, 'seg.mp4')];
    await generator.image(image('serum bottle'), picture, onSubmitted);
    await generator.clip(firstFrame(4), clip, onSubmitted);
    await generator.clip(speaker(4), sound, onSubmitted);

    const again = createFakeGenerator({ log, ffmpeg: FFMPEG });
    const copies = [join(dir, 'again', 'a.png'), join(dir, 'again', 'a.mp4'), join(dir, 'again', 'seg.mp4')];
    await expect(generator.resume('fake-image-1', copies[0]!)).resolves.toEqual({ taskId: 'fake-image-1', file: copies[0] });
    await expect(again.resume('fake-clip-2', copies[1]!)).resolves.toEqual({ taskId: 'fake-clip-2', file: copies[1] });
    await again.resume('fake-clip-3-speaker', copies[2]!);
    expect(readFileSync(copies[0]!).equals(readFileSync(picture))).toBe(true);
    expect(decode(copies[1]!, 720, 1280, [0, 60]).map((rgb) => [readBar(rgb, 720, 1280), pixel(rgb, 720, 600, 640)]))
      .toEqual(decode(clip, 720, 1280, [0, 60]).map((rgb) => [readBar(rgb, 720, 1280), pixel(rgb, 720, 600, 640)]));
    expect(probe(copies[1]!).streams).toHaveLength(1);
    expect(probe(copies[1]!).streams[0]).toMatchObject({ nb_frames: '120' });
    expect(probe(copies[2]!).streams).toHaveLength(2);
    expect(linesOf(log)).toHaveLength(3);
  }, SLOW);

  it('the ffmpeg child never sees MAGNIFIC_API_KEY', async () => {
    const { dir, onSubmitted } = setup();
    const stub = join(dir, 'ffmpeg-stub.sh');
    const seen = join(dir, 'child-env.txt');
    writeFileSync(stub, `#!/bin/sh\nenv > "${seen}"\nexec ${FFMPEG} "$@"\n`);
    chmodSync(stub, 0o755);
    const before = process.env.MAGNIFIC_API_KEY;
    process.env.MAGNIFIC_API_KEY = 'made-up-key-for-this-test';
    try {
      const generator = createFakeGenerator({ log: join(dir, 'log.jsonl'), ffmpeg: stub });
      await generator.clip(firstFrame(4), join(dir, 'a.mp4'), onSubmitted);
      expect((await generator.ready()).ready).toBe(true);
    } finally {
      if (before === undefined) delete process.env.MAGNIFIC_API_KEY; else process.env.MAGNIFIC_API_KEY = before;
    }
    const environment = readFileSync(seen, 'utf8');
    expect(environment).toContain('PATH=');
    expect(environment).not.toContain('MAGNIFIC_API_KEY');
    expect(environment).not.toContain('made-up-key-for-this-test');
    expect(existsSync(join(dir, 'a.mp4'))).toBe(true);
  }, SLOW);

  it('ready() is true when ffmpeg runs', async () => {
    expect(await setup().generator.ready()).toEqual({ ready: true, note: null });
  }, SLOW);
});

describe('fake generator: without ffmpeg, and other edges', () => {
  it('ready() says not ready when ffmpeg is missing', async () => {
    const answer = await setup({ ffmpeg: '/nowhere/ffmpeg' }).generator.ready();
    expect(answer.ready).toBe(false);
    expect(answer.note).toContain('/nowhere/ffmpeg');
  });

  it('a clip that cannot be made fails with download-failed and its ticket; the request is in the log once', async () => {
    const { dir, log, generator, tickets, onSubmitted } = setup({ ffmpeg: '/nowhere/ffmpeg' });
    const error: unknown = await generator.clip(firstFrame(4), join(dir, 'a.mp4'), onSubmitted).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GeneratorError);
    expect(error).toMatchObject({ code: 'download-failed', ticket: 'fake-clip-1' });
    expect(tickets).toEqual(['fake-clip-1']);
    expect(linesOf(log)).toHaveLength(1);
  });

  it('resume of a ticket that is not in the log is refused and adds no line', async () => {
    const { dir, log, generator, onSubmitted } = setup();
    await generator.image(image('serum bottle'), join(dir, 'a.png'), onSubmitted);
    const error: unknown = await generator.resume('fake-clip-7', join(dir, 'x.mp4')).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GeneratorError);
    expect(error).toMatchObject({ code: 'submission-unknown' });
    expect(linesOf(log)).toHaveLength(1);
    expect(existsSync(join(dir, 'x.mp4'))).toBe(false);
  });

  it('delayMs: the log line and onSubmitted come at once, the file only after the delay', async () => {
    const { dir, log, generator, tickets, onSubmitted } = setup({ delayMs: 400 });
    const to = join(dir, 'a.png');
    const making = generator.image(image('serum bottle'), to, onSubmitted);
    await wait(100);
    expect([linesOf(log).length, tickets.length, existsSync(to)]).toEqual([1, 1, false]);
    await making;
    expect(existsSync(to)).toBe(true);
  });

  it('three requests started together get three tickets and three lines', async () => {
    const { dir, log, generator, tickets, onSubmitted } = setup({ delayMs: 20 });
    await Promise.all([1, 2, 3].map((n) => generator.image(image(`picture ${n}`), join(dir, `${n}.png`), onSubmitted)));
    expect(tickets).toEqual(['fake-image-1', 'fake-image-2', 'fake-image-3']);
    expect(linesOf(log).map((line) => line.ticket)).toEqual(['fake-image-1', 'fake-image-2', 'fake-image-3']);
  });
});

describe('fake generator: it refuses what the real client refuses', () => {
  const refused: [string, PaidRequest][] = [
    ['an unknown model', { kind: 'clip', request: { ...firstFrame(4), tier: { model: 'veo-3', resolution: '720p' } } }],
    ['a resolution the model has no route for', { kind: 'clip', request: { ...firstFrame(4), tier: { model: 'seedance-2-mini', resolution: '1080p' } } }],
    ['3 seconds', { kind: 'clip', request: firstFrame(3) }],
    ['4.5 seconds', { kind: 'clip', request: firstFrame(4.5) }],
    ['a ratio without a name', { kind: 'clip', request: { ...speaker(4), aspect: '5:4' } as ClipRequest }],
    ['15 references', { kind: 'image', request: { prompt: 'x', references: Array.from({ length: 15 }, (_, i) => `/nowhere/${i}.png`), aspect: '9:16' } }],
  ];
  const accepted: PaidRequest[] = [
    { kind: 'image', request: image('serum bottle') },
    { kind: 'clip', request: firstFrame(4) },
    { kind: 'clip', request: speaker(8) },
    { kind: 'music', request: { prompt: 'bed' } },
    { kind: 'voice', request: { text: 'hi', voiceId: 'v' } },
  ];
  // the real client, never asked to send anything here: only its free, local answer is compared
  const real = createMagnific({ apiKey: '', fetch: (() => { throw new Error('no request in this test'); }) as typeof fetch });

  it.each(refused)('%s: refusal gives the real client\'s reason, the method rejects, and nothing is submitted', async (_what, paid) => {
    const { dir, log, generator, tickets, onSubmitted } = setup({ ffmpeg: '/nowhere/ffmpeg' });
    const reason = generator.refusal(paid);
    expect(typeof reason).toBe('string');
    expect(reason).toBe(real.refusal(paid));
    const to = join(dir, 'x.bin');
    const made = paid.kind === 'image' ? generator.image(paid.request, to, onSubmitted)
      : paid.kind === 'clip' ? generator.clip(paid.request, to, onSubmitted)
        : paid.kind === 'music' ? generator.music(paid.request, to, onSubmitted) : generator.voice(paid.request, to, onSubmitted);
    const error: unknown = await made.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GeneratorError);
    expect(error).toMatchObject({ code: 'rejected', ticket: null });
    expect((error as GeneratorError).message).toContain(reason);
    expect([linesOf(log).length, tickets.length, existsSync(to)]).toEqual([0, 0, false]);
  });

  it('a request the real client would send → null, and no line is written by asking', () => {
    const { log, generator } = setup({ ffmpeg: '/nowhere/ffmpeg' });
    for (const paid of accepted) expect(generator.refusal(paid)).toBeNull();
    expect(existsSync(log)).toBe(false);
  });

  it('a person swap is none of its requests: asked about one all the same, it gives the real client\'s reason and writes no line', () => {
    const { log, generator } = setup({ ffmpeg: '/nowhere/ffmpeg' });
    const swap: SwapPaid = {
      kind: 'swap',
      request: { video: '/nowhere/p01.mp4', people: [{ slot: 1, body: '/nowhere/body.jpg', face: null, hint: 'the woman' }], seconds: 8, tier: { model: 'seedance-2-mini', resolution: '720p' }, keepSound: false },
    };
    const asked = swap as unknown as PaidRequest;                // what a wrong dispatch would hand over: the types alone keep a swap away from a generator
    expect(generator.refusal(asked)).toBe('this provider replaces no person in a video');
    expect(generator.refusal(asked)).toBe(real.refusal(asked));
    expect(existsSync(log)).toBe(false);
  });
});

describe('fake generator: the edges of a submit', () => {
  it('onSubmitted throws → submission-unknown with the ticket; the request is in the log once and no file is made', async () => {
    const { dir, log, generator } = setup({ ffmpeg: '/nowhere/ffmpeg' });
    const to = join(dir, 'a.png');
    const error: unknown = await generator.image(image('serum bottle'), to, () => { throw new Error('database is locked'); }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GeneratorError);
    expect(error).toMatchObject({ code: 'submission-unknown', ticket: 'fake-image-1' });
    expect((error as GeneratorError).message).toContain('database is locked');
    expect(linesOf(log).map((line) => line.ticket)).toEqual(['fake-image-1']);
    expect(existsSync(to)).toBe(false);
  });

  it('a half-written last line in the log (a worker killed while writing) is skipped by every later call', async () => {
    const { dir, log, generator, tickets, onSubmitted } = setup({ ffmpeg: '/nowhere/ffmpeg' });
    await generator.image(image('first picture'), join(dir, '1.png'), onSubmitted);
    const whole = readFileSync(log, 'utf8');
    writeFileSync(log, `${whole}{"kind":"clip","words":"slow push`);                     // no end, no line break
    await generator.image(image('second picture'), join(dir, '2.png'), onSubmitted);
    await generator.image(image('third picture'), join(dir, '3.png'), onSubmitted);
    expect(tickets).toEqual(['fake-image-1', 'fake-image-2', 'fake-image-3']);
    const rows = readFileSync(log, 'utf8').split('\n').filter(Boolean);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toBe('{"kind":"clip","words":"slow push');                            // left as it was, on a line of its own
    expect(rows.filter((row) => row.endsWith('}')).map((row) => (JSON.parse(row) as Line).ticket)).toEqual(['fake-image-1', 'fake-image-2', 'fake-image-3']);

    for (const [ticket, name] of [['fake-image-1', '1.png'], ['fake-image-2', '2.png'], ['fake-image-3', '3.png']] as const) {
      const again = join(dir, 'again', name);
      await generator.resume(ticket, again);
      expect(readFileSync(again).equals(readFileSync(join(dir, name)))).toBe(true);
    }
    expect((await generator.ready()).ready).toBe(false);                                   // and no call threw a SyntaxError on the way
  });

  it('a log that holds only a broken line still takes requests', async () => {
    const { dir, log, generator, tickets, onSubmitted } = setup({ ffmpeg: '/nowhere/ffmpeg' });
    mkdirSync(dirname(log), { recursive: true });
    writeFileSync(log, '{"kind":"ima');
    await generator.image(image('a picture'), join(dir, '1.png'), onSubmitted);
    expect(tickets).toEqual(['fake-image-1']);
    expect(readFileSync(log, 'utf8')).toMatch(/^\{"kind":"ima\n\{.*"ticket":"fake-image-1".*\}\n$/);
  });
});
