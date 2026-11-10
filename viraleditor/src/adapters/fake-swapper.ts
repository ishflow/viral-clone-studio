/**
 * The person-swap provider every test and trial uses in place of the paid one. It makes a real file on this machine:
 * the part it was given, encoded again at the same size, rate and number of frames, with a flat box painted where each
 * person stands (one per slot, side by side) and the frame bar of `framebar.ts` over every frame; the sound is left
 * out (the finished video gets the source's own sound).
 * The log is the record of this pretend provider: one JSON line per accepted request (the part, the slots, the prompt a provider that takes one would be asked with), written before `onSubmitted` is
 * called. A ticket is `fake-swap-<line number>`; `resume` makes the file again from that line and writes none. The
 * colour and `failSwap` follow the line's place in the log, so they are the same after a restart.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { GeneratorError } from '../ports.ts';
import type { Clock, Generated, OnSubmitted, PersonSwapper, SwapRequest } from '../ports.ts';
import { swapPrompt } from '../swap/prompt.ts';
import { SWAP_PART_SECONDS_MAX, SWAP_PART_SECONDS_MIN, SWAP_PEOPLE_MAX } from '../template/swap-schema.ts';
import { containerFacts } from './encode.ts';
import { runProcess } from './exec.ts';
import { barFilter } from './framebar.ts';

export interface FakeSwapperOptions {
  log: string;                                              // VC_FAKE_SWAPPER_LOG
  failSwap?: number;                                        // the Nth line of the log fails (VC_FAKE_FAIL_SWAP)
  delayMs?: number;                                         // between the acceptance and the file
  ffmpeg?: string;                                          // `ffmpeg` on the PATH
  ffprobe?: string;                                         // `ffprobe` on the PATH
  clock?: Clock;                                            // for `at`
}

/** `side`: for each slot, whether a side photograph came with the request; it is sent to no provider yet, so the log says no more of it than that. */
interface Line { kind: 'swap'; video: string; seconds: number; slots: number[]; side: ('yes' | 'no')[]; prompt: string; ticket: string; at: string }

const TIMEOUT_MS = 120_000;
/** Lengths read from a file may miss the limit by this and be at it. */
const SAME_SECOND = 1e-6;
const COLOURS = ['8a2b2b', '2b6a8a', '2f7d4f', '7a4b9a', '9a6a1f', '1f6f6f', '8a3a6a', '4a5a9a', '6a7a2a', '9a4a2a'];

/** Why a request is not sent, or null: what any person-swap provider of ours refuses before it costs anything. It looks at the length and the people, never at files. */
export function swapRefusal(request: SwapRequest): string | null {
  if (request.seconds < SWAP_PART_SECONDS_MIN - SAME_SECOND || request.seconds > SWAP_PART_SECONDS_MAX + SAME_SECOND) {
    return `a part is ${SWAP_PART_SECONDS_MIN} to ${SWAP_PART_SECONDS_MAX} seconds long, not ${Number(request.seconds.toFixed(3))}`;
  }
  if (request.people.length < 1 || request.people.length > SWAP_PEOPLE_MAX) return `a part has 1 to ${SWAP_PEOPLE_MAX} people replaced, not ${request.people.length}`;
  return null;
}

export function createFakeSwapper(options: FakeSwapperOptions): PersonSwapper {
  const ffmpeg = options.ffmpeg ?? 'ffmpeg', ffprobe = options.ffprobe ?? 'ffprobe';
  const clock = options.clock ?? { now: () => new Date() };

  /** The log as it is on disk; a row that is not a whole line of ours (a worker killed while writing it) is skipped. `open`: the next line must start with a line break. */
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

  /** Makes the file of a request that is in the log. Used by a submit and by `resume` alike. */
  async function make(ticket: string, to: string): Promise<Generated> {
    const all = read().lines;
    const index = all.findIndex((line) => line.ticket === ticket);
    const line = all[index];
    if (line === undefined) throw new GeneratorError('submission-unknown', `the fake swapper's log has no request ${ticket}`);
    if (index + 1 === options.failSwap) throw new GeneratorError('task-failed', `swap ${options.failSwap} fails, as the fake swapper was told`, ticket);
    try {
      const { width, height, fps, frames } = await containerFacts(ffprobe, line.video, TIMEOUT_MS);
      const colour = COLOURS[index % COLOURS.length]!;
      const share = 1 / line.slots.length;
      const boxes = line.slots.map((_, at) => `drawbox=x=iw*${(at + 0.2) * share}:y=ih*0.45:w=iw*${0.6 * share}:h=ih*0.5:color=0x${colour}:t=fill`);
      mkdirSync(dirname(to), { recursive: true });
      const made = await runProcess(ffmpeg, [
        '-v', 'error', '-y', '-nostdin', '-i', line.video, '-filter_complex', `[0:v]${boxes.join(',')}[in];${barFilter({ width, height, fps })}`,
        '-frames:v', String(frames), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-f', 'mp4', to,
      ], { timeoutMs: TIMEOUT_MS });
      if (made.code !== 0) throw new Error(made.stderr.trim().split('\n').at(-1) ?? `ffmpeg exited ${made.code}`);
    } catch (error) {
      throw new GeneratorError('download-failed', `the fake swapper could not make ${basename(to)}: ${error instanceof Error ? error.message : String(error)}`, ticket);
    }
    return { taskId: ticket, file: to };
  }

  return {
    refusal: swapRefusal,
    /** The line goes into the log first: from then on the request exists, as it would at a provider. */
    async replace(request, to, onSubmitted: OnSubmitted) {
      const reason = swapRefusal(request);
      if (reason !== null) throw new GeneratorError('rejected', `not sent: ${reason}`);
      // what a provider is sent is read first: a file that is not there is an upload that failed, and nothing was started
      const lost = [request.video, ...request.people.flatMap((person) => [person.body, ...(person.face === null ? [] : [person.face])])].find((file) => !existsSync(file));
      if (lost !== undefined) throw new GeneratorError('upload-failed', `${basename(lost)} is not there`);
      mkdirSync(dirname(options.log), { recursive: true });
      const { lines, open } = read();
      const ticket = `fake-swap-${lines.length + 1}`;
      const line: Line = { kind: 'swap', video: request.video, seconds: request.seconds, slots: request.people.map((person) => person.slot), side: request.people.map((person) => (person.side === undefined ? 'no' : 'yes')), prompt: swapPrompt(request.people, request.outfit === undefined ? {} : { outfit: request.outfit }), ticket, at: clock.now().toISOString() };
      appendFileSync(options.log, `${open ? '\n' : ''}${JSON.stringify(line)}\n`);
      try { onSubmitted(ticket); } catch (error) {
        const said = error instanceof Error ? error.message : String(error);
        throw new GeneratorError('submission-unknown', `the request is in the log, but its ticket could not be recorded (${said}): do not send it again`, ticket);
      }
      if (options.delayMs) await wait(options.delayMs);
      return make(ticket, to);
    },
    resume: (ticket, to) => make(ticket, to),
    async ready() {
      try {
        const answered = await runProcess(ffmpeg, ['-version'], { timeoutMs: TIMEOUT_MS });
        if (answered.code === 0) return { ready: true, note: null };
      } catch { /* said below */ }
      return { ready: false, note: `ffmpeg does not run: ${ffmpeg}` };
    },
  };
}
