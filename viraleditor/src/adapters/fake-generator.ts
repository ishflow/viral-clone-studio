/**
 * The generator every test and trial uses in place of the paid one. It makes real media on this machine:
 * - image: a 720×1280 PNG, the request's key words in white block letters on a flat colour (written
 *   here, without ffmpeg, which has no text filter in this build);
 * - clip: H.264, the asked seconds exactly, a flat colour with the frame bar of `framebar.ts`; a
 *   speaker clip also carries a tone;
 * - music: 30 s of a quiet tone; voice: a tone of 0.4 s per word.
 * The log is the record of this pretend provider: one JSON line per submitted request, written before
 * `onSubmitted` is called. A ticket is `fake-<kind>-<line number>`; `resume` makes the file again from
 * that line and writes none. The colour and `failClip` follow the line's place in the log, so they are
 * the same after a restart.
 * It refuses what the real client refuses (`routes.ts`), so a trial stops where production would.
 */
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { promisify } from 'node:util';
import { crc32, deflateSync } from 'node:zlib';
import { GeneratorError } from '../ports.ts';
import type { Clock, Generated, Generator, OnSubmitted, PaidRequest } from '../ports.ts';
import { barFilter } from './framebar.ts';
import { refusalOf } from './routes.ts';

export interface FakeGeneratorOptions {
  log: string;                                              // VC_FAKE_GENERATOR_LOG
  failClip?: number;                                        // the Nth clip line of the log fails (VC_FAKE_FAIL_CLIP)
  delayMs?: number;                                         // between the acceptance and the file
  clip?: { width: number; height: number; fps: number };   // 720×1280 at 30 fps
  ffmpeg?: string;                                          // `ffmpeg` on the PATH
  clock?: Clock;                                            // for `at`
}

type Kind = 'image' | 'clip' | 'music' | 'voice';
interface Line { kind: Kind; words: string; seconds: number | null; ticket: string; at: string }

const IMAGE = { width: 720, height: 1280 };
const MUSIC_SECONDS = 30;
/** Flat colours, none near white: the bar and the letters stand out, and a cut between two clips shows. */
const COLOURS = ['8a2b2b', '2b6a8a', '2f7d4f', '7a4b9a', '9a6a1f', '1f6f6f', '8a3a6a', '4a5a9a', '6a7a2a', '9a4a2a'];

/** Letters of 5×7 dots: seven rows per letter, each row five bits written as two hex digits. */
const LETTERS: Record<string, string> = {
  A: '0E11111F111111', B: '1E11111E11111E', C: '0E11101010110E', D: '1E11111111111E', E: '1F10101E10101F', F: '1F10101E101010',
  G: '0E11101711110F', H: '1111111F111111', I: '0E04040404040E', J: '0702020202120C', K: '11121418141211', L: '1010101010101F',
  M: '111B1515111111', N: '11191513111111', O: '0E11111111110E', P: '1E11111E101010', Q: '0E11111115120D', R: '1E11111E141211',
  S: '0F10100E01011E', T: '1F040404040404', U: '1111111111110E', V: '11111111110A04', W: '1111111515150A', X: '11110A040A1111',
  Y: '11110A04040404', Z: '1F01020408101F',
  0: '0E11131519110E', 1: '040C040404040E', 2: '0E11010204081F', 3: '1E01010E01011E', 4: '02060A121F0202',
  5: '1F101E0101110E', 6: '0608101E11110E', 7: '1F010204080808', 8: '0E11110E11110E', 9: '0E11110F01020C',
};
const NO_LETTER = '1F11111111111F';   // a box, for a letter this alphabet does not have
const DOT = 9;                         // one dot is 9×9 pixels: a letter is 45×63, twelve fit in a line

/** What the log line of a request says, and the mark its ticket carries. */
function factsOf(paid: PaidRequest): { text: string; seconds: number | null; mark: string } {
  switch (paid.kind) {
    case 'image': return { text: paid.request.prompt, seconds: null, mark: '' };
    case 'clip': return { text: paid.request.prompt, seconds: paid.request.seconds, mark: paid.request.mode === 'speaker' ? '-speaker' : '' };
    case 'music': return { text: paid.request.prompt, seconds: MUSIC_SECONDS, mark: '' };
    case 'voice': {
      const words = Math.max(1, paid.request.text.trim().split(/\s+/).filter(Boolean).length);
      return { text: paid.request.text, seconds: words * 4 / 10, mark: '' };                 // 0.4 s per word
    }
  }
}

/** The first eight words of a text, without punctuation. */
function keyWords(text: string): string {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).join(' ');
}

/** Lines of at most `width` letters; a longer word is cut. */
function wrap(words: string, width: number): string[] {
  const lines: string[] = [];
  for (const word of words.split(' ').filter(Boolean).map((whole) => whole.slice(0, width))) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

function png(width: number, height: number, rgb: Buffer): Buffer {
  const row = width * 3;
  const raw = Buffer.alloc((row + 1) * height);              // every row starts with filter type 0
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (row + 1) + 1, y * row, (y + 1) * row);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);                             // 8 bits per channel, RGB, not interlaced
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const whole = Buffer.alloc(body.length + 8);
    whole.writeUInt32BE(data.length, 0);
    body.copy(whole, 4);
    whole.writeUInt32BE(crc32(body), body.length + 4);
    return whole;
  };
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** The picture: the words in white on the colour, readable on a contact sheet. */
function picture(words: string, colour: string): Buffer {
  const { width, height } = IMAGE;
  const rgb = Buffer.alloc(width * height * 3);
  const paint = [0, 2, 4].map((at) => parseInt(colour.slice(at, at + 2), 16));
  for (let i = 0; i < rgb.length; i++) rgb[i] = paint[i % 3]!;
  const plain = words.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
  wrap(plain, 12).forEach((line, row) => {
    [...line].forEach((letter, column) => {
      if (letter === ' ') return;
      const dots = LETTERS[letter] ?? NO_LETTER;
      for (let dotY = 0; dotY < 7; dotY++) {
        const bits = parseInt(dots.slice(dotY * 2, dotY * 2 + 2), 16);
        for (let dotX = 0; dotX < 5; dotX++) {
          if ((bits >> (4 - dotX) & 1) === 0) continue;
          const left = 36 + (column * 6 + dotX) * DOT;
          const top = 120 + (row * 9 + dotY) * DOT;
          for (let y = top; y < top + DOT; y++) rgb.fill(255, (y * width + left) * 3, (y * width + left + DOT) * 3);
        }
      }
    });
  });
  return png(width, height, rgb);
}

export function createFakeGenerator(options: FakeGeneratorOptions): Generator {
  const bin = options.ffmpeg ?? 'ffmpeg';
  const size = options.clip ?? { ...IMAGE, fps: 30 };
  const clock = options.clock ?? { now: () => new Date() };
  const run = promisify(execFile);

  /** The child gets this process's environment without the provider key. */
  function environment(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.MAGNIFIC_API_KEY;
    return env;
  }
  /**
   * The log as it is on disk. A row that is not a whole line of ours (a worker killed while writing it) is
   * skipped. `open`: the file does not end with a line break, so the next line must start with one.
   */
  function read(): { lines: Line[]; open: boolean } {
    const text = existsSync(options.log) ? readFileSync(options.log, 'utf8') : '';
    const lines: Line[] = [];
    for (const row of text.split('\n')) {
      try {
        const line = JSON.parse(row) as Partial<Line> | null;
        if (typeof line?.ticket === 'string') lines.push(line as Line);
      } catch { /* empty or half-written */ }
    }
    return { lines, open: text !== '' && !text.endsWith('\n') };
  }

  function clipArgs(seconds: number, colour: string, sound: boolean, to: string): string[] {
    const { width, height, fps } = size;
    return [
      '-f', 'lavfi', '-i', `color=c=0x${colour}:s=${width}x${height}:r=${fps}:d=${seconds}`,
      ...(sound ? ['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`] : []),
      '-vf', barFilter({ width, height, fps }), '-frames:v', String(Math.round(seconds * fps)),
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', ...(sound ? ['-c:a', 'aac'] : []),
      '-f', 'mp4', to,
    ];
  }
  const toneArgs = (seconds: number, hertz: number, gain: number, to: string): string[] =>
    ['-f', 'lavfi', '-i', `sine=frequency=${hertz}:sample_rate=44100:duration=${seconds}`, '-af', `volume=${gain}`, to];

  /** Makes the file of a request that is in the log. Used by a submit and by `resume` alike. */
  async function make(ticket: string, to: string): Promise<Generated> {
    const all = read().lines;
    const index = all.findIndex((line) => line.ticket === ticket);
    const line = all[index];
    if (line === undefined) throw new GeneratorError('submission-unknown', `the fake generator's log has no request ${ticket}`);
    if (line.kind === 'clip' && all.slice(0, index + 1).filter((earlier) => earlier.kind === 'clip').length === options.failClip) {
      throw new GeneratorError('task-failed', `clip ${options.failClip} fails, as the fake generator was told`, ticket);
    }
    const colour = COLOURS[index % COLOURS.length]!;
    const seconds = line.seconds ?? 0;
    try {
      mkdirSync(dirname(to), { recursive: true });
      if (line.kind === 'image') writeFileSync(to, picture(line.words, colour));
      else {
        const args = line.kind === 'clip' ? clipArgs(seconds, colour, ticket.endsWith('-speaker'), to)
          : line.kind === 'music' ? toneArgs(seconds, 220, 0.35, to) : toneArgs(seconds, 330, 1, to);
        await run(bin, ['-v', 'error', '-y', ...args], { env: environment() });
      }
    } catch (error) {
      const said = (error as { stderr?: string }).stderr?.trim().split('\n').at(-1) || (error instanceof Error ? error.message : String(error));
      throw new GeneratorError('download-failed', `the fake generator could not make ${basename(to)}: ${said}`, ticket);
    }
    return { taskId: ticket, file: to };
  }

  /** The line goes into the log first: from then on the request exists, as it would at a provider. */
  async function submit(paid: PaidRequest, to: string, onSubmitted: OnSubmitted): Promise<Generated> {
    const reason = refusalOf(paid);
    if (reason !== null) throw new GeneratorError('rejected', `not sent: ${reason}`);
    const { text, seconds, mark } = factsOf(paid);
    mkdirSync(dirname(options.log), { recursive: true });
    const { lines, open } = read();
    const ticket = `fake-${paid.kind}-${lines.length + 1}${mark}`;
    const line: Line = { kind: paid.kind, words: keyWords(text), seconds, ticket, at: clock.now().toISOString() };
    appendFileSync(options.log, `${open ? '\n' : ''}${JSON.stringify(line)}\n`);
    try { onSubmitted(ticket); } catch (error) {
      const said = error instanceof Error ? error.message : String(error);
      throw new GeneratorError('submission-unknown', `the request is in the log, but its ticket could not be recorded (${said}): do not send it again`, ticket);
    }
    if (options.delayMs) await wait(options.delayMs);
    return make(ticket, to);
  }

  return {
    refusal: (paid) => refusalOf(paid),
    image: (request, to, onSubmitted) => submit({ kind: 'image', request }, to, onSubmitted),
    clip: (request, to, onSubmitted) => submit({ kind: 'clip', request }, to, onSubmitted),
    music: (request, to, onSubmitted) => submit({ kind: 'music', request }, to, onSubmitted),
    voice: (request, to, onSubmitted) => submit({ kind: 'voice', request }, to, onSubmitted),
    resume: (ticket, to) => make(ticket, to),
    async ready() {
      try {
        await run(bin, ['-version'], { env: environment() });
        return { ready: true, note: null };
      } catch { return { ready: false, note: `ffmpeg does not run: ${bin}` }; }
    },
  };
}
