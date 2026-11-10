// For the tests of the commands: a project folder in a temp dir, and a context whose tools are fakes (no browser, no
// ffmpeg). The fakes record what was asked of them.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AlignError } from '../adapters/aligner.ts';
import type { AlignErrorCode } from '../adapters/aligner.ts';
import { MediaError } from '../adapters/media.ts';
import type { RenderFacts, StageTime } from '../adapters/renderer.ts';
import { RenderError } from '../ports.ts';
import type { CheckIssue, FrameRange, Loudness, StreamFacts, Word } from '../ports.ts';
import { cli } from './commands.ts';
import type { Context, ToolName } from './context.ts';
import type { Ran } from './framework.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
/** A fixture document, parsed: a fresh copy each time, free to change. */
export function fixture(name: 'small' | 'white'): any {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));
}

/** A project folder in a temp dir: `edit.json` and an empty file for every name in `assets`. Returns the path of edit.json. */
export function tempProject(edit: unknown, assets: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 've-cli-'));
  mkdirSync(join(dir, 'assets'));
  for (const name of assets) writeFileSync(join(dir, 'assets', name), '');
  const file = join(dir, 'edit.json');
  writeFileSync(file, typeof edit === 'string' ? edit : JSON.stringify(edit, null, 2));
  return file;
}

const video = (over: Partial<StreamFacts> = {}): StreamFacts => ({
  width: 720, height: 1280, fps: 30, frames: 90, seconds: 3, audio: false, codec: 'h264', pixelFormat: 'yuv420p',
  colour: { space: 'bt709', transfer: 'bt709', primaries: 'bt709' }, keyframes: [0, 30, 60], sound: null, constantRate: true, ...over,
});
/** The facts the fake measure gives, by file name: the media of fixtures/small.json and what a render of it would be. */
export const STREAMS: Record<string, StreamFacts> = {
  'clip.mp4': video(),
  'still.png': video({ frames: 1, seconds: 0.04, codec: 'png', pixelFormat: 'rgb24', keyframes: [0] }),
  'product.png': video({ width: 600, height: 600, frames: 1, seconds: 0.04, codec: 'png', pixelFormat: 'rgba', keyframes: [0] }),
  'tone.mp3': video({ width: 0, height: 0, fps: 0, frames: 0, audio: true, codec: 'mp3', pixelFormat: '', keyframes: [], sound: { codec: 'mp3', sampleRate: 48000, channels: 2 } }),
  'render.mp4': video({ frames: 75, seconds: 2.5, audio: true, sound: { codec: 'aac', sampleRate: 48000, channels: 2 } }),
};
export const SMALL_ASSETS = ['clip.mp4', 'still.png', 'product.png', 'tone.mp3'];
const STAGES: StageTime[] = [{ stage: 'cli', seconds: 5 }, { stage: 'cli.capture', seconds: 3.5 }, { stage: 'cli.encode', seconds: 1 }, { stage: 'probe', seconds: 0.2 }];

/** What the fake measure decodes for any frame: white stripes on black, so a white text has its ink and its contrast everywhere. */
const STRIPES = { width: 720, height: 1280, rgb: Uint8Array.from({ length: 720 * 1280 * 3 }, (_, i) => ((Math.floor(i / 3) % 720) % 8 < 5 ? 255 : 0)) };

export interface Fakes {
  streams: Record<string, StreamFacts>;                    // by file name; a name that is not here is not a media file
  black: Record<string, FrameRange[]>;                     // by file name
  loudness: Loudness | null;
  checkIssues: CheckIssue[];                               // what Renderer.check answers
  renderFails: string | null;                              // the message of the RenderError
  transcript: Word[];                                      // what the transcriber hears
  aligner: { ready: boolean; note: string | null; fails: AlignErrorCode | null; unplaced: number[] };   // `unplaced`: indexes of the words it gives score 0
  exec: Partial<Record<ToolName, (args: string[]) => { code: number; stdout: string; stderr: string }>>;
}
export interface Call { tool: string; args: unknown[] }

/** A context with fake tools. `calls` lists every use of a tool, in order; `logs` what went to stderr. */
export function fakeContext(over: Partial<Fakes> = {}): { context: Context; calls: Call[]; logs: string[]; fakes: Fakes } {
  const fakes: Fakes = { streams: { ...STREAMS }, black: {}, loudness: { integrated: -14, truePeak: -2, range: 4 }, checkIssues: [], renderFails: null, transcript: [{ text: 'Hello', start: 0.1, end: 0.5 }, { text: 'there.', start: 0.6, end: 1.2 }],
    aligner: { ready: true, note: null, fails: null, unplaced: [] }, exec: {}, ...over };
  const calls: Call[] = [];
  const logs: string[] = [];
  const note = (tool: string, ...args: unknown[]) => { calls.push({ tool, args }); };
  const streams = async (file: string): Promise<StreamFacts> => {
    note('measure.streams', file);
    const facts = fakes.streams[basename(file)];
    if (!facts) throw new MediaError('not-media', `not a readable media file: ${file}`);
    return facts;
  };
  let now = Date.parse('2026-10-04T12:00:00Z');
  const context: Context = {
    cwd: tmpdir(),
    clock: { now: () => new Date((now += 1000)) },
    log: (line) => { logs.push(line); },
    tools: {
      where: { hyperframes: '/fake/hyperframes', ffmpeg: '/fake/ffmpeg', ffprobe: '/fake/ffprobe', root: '/fake/viraleditor' },
      measure: {
        streams,
        black: async (file) => { note('measure.black', file); return fakes.black[basename(file)] ?? []; },
        frozen: async () => [],
        loudness: async (file) => { note('measure.loudness', file); return fakes.loudness; },
        momentary: async () => [],
        picture: async () => STRIPES,
      },
      media: {
        probe: async (file) => streams(file),
        normalize: async (file, to, target) => { note('media.normalize', file, to, target); writeFileSync(to, 'mp4'); return { width: target.width, height: target.height, fps: target.fps, frames: 90, seconds: 3, audio: target.audio }; },
        still: async () => {},
        sheet: async (file, to, grid) => { note('media.sheet', file, to, grid); writeFileSync(to, 'png'); return { seconds: Array.from({ length: grid.columns * grid.rows }, (_, i) => i / 4) }; },
        trim: async (file, from, to, out) => { writeFileSync(out, 'mp4'); return { width: 720, height: 1280, fps: 30, frames: Math.round((to - from) * 30), seconds: to - from, audio: true }; },
        cuts: async () => ({ seconds: [], faint: [] }),
      },
      renderer: (quality) => ({
        check: async (dir) => { note('renderer.check', dir); return { ok: fakes.checkIssues.length === 0, issues: fakes.checkIssues }; },
        render: async (dir, to, onProgress): Promise<RenderFacts> => {
          note('renderer.render', dir, to, quality);
          if (fakes.renderFails !== null) throw new RenderError(fakes.renderFails);
          mkdirSync(dirname(to), { recursive: true });
          writeFileSync(to, 'mp4');
          onProgress({ frame: 75, frames: 75 });
          return { width: 720, height: 1280, fps: 30, frames: 75, seconds: 2.5, audio: true, encode: 'cli', note: null, stages: STAGES };
        },
        ready: async () => ({ ready: true, note: null }),
      }),
      transcriber: { words: async (media, language) => { note('transcriber.words', media, language); return fakes.transcript; } },
      aligner: {
        // one word every half second, 0.4 s long
        align: async (media, words, language) => {
          note('aligner.align', media, words, language);
          if (fakes.aligner.fails !== null) throw new AlignError(fakes.aligner.fails, `the aligner failed (${fakes.aligner.fails})`);
          return words.map((text, i) => ({ text, start: i / 2, end: i / 2 + 0.4, score: fakes.aligner.unplaced.includes(i) ? 0 : 0.9 }));
        },
        ready: async () => ({ ready: fakes.aligner.ready, note: fakes.aligner.note }),
      },
      placeholders: {
        make: async (needs, dir) => { note('placeholders.make', needs, dir); mkdirSync(dir, { recursive: true }); for (const need of needs) writeFileSync(join(dir, need.file), need.kind); },
      },
      exec: async (tool, args) => {
        note(`exec.${tool}`, ...args);
        const answer = fakes.exec[tool];
        if (!answer) throw new Error(`the test gave no answer for ${tool} ${args.join(' ')}`);
        return answer(args);
      },
    },
  };
  return { context, calls, logs, fakes };
}

/** Runs the command line in this process with `--json` and reads the answer back from what it would print. */
export async function ask(context: Context, argv: string[]): Promise<Ran & { json: any }> {
  const ran = await cli([...argv, '--json'], context);
  return { ...ran, json: JSON.parse(ran.stdout) };
}

/** A fake `hyperframes snapshot`: one PNG per time in the folder after --output, named as the CLI names them (the index padded to two digits), each holding its own second. */
export function fakeSnapshot(args: string[]): { code: number; stdout: string; stderr: string } {
  const out = args[args.indexOf('--output') + 1]!;
  mkdirSync(out, { recursive: true });
  args[args.indexOf('--at') + 1]!.split(',').forEach((second, i) => writeFileSync(join(out, `frame-${String(i).padStart(2, '0')}-at-${Number(Number(second).toFixed(3))}s.png`), `png ${second}`));
  return { code: 0, stdout: '', stderr: '' };
}
