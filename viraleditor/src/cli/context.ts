// What a command may touch besides the files it is given: the local tools (ffmpeg, ffprobe, the HyperFrames CLI), the
// clock and stderr. The commands get it as an argument, so a test hands them fakes.
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../adapters/exec.ts';
import type { ExecResult } from '../adapters/exec.ts';
import { createMeasure } from '../adapters/measure.ts';
import { createAligner } from '../adapters/aligner.ts';
import { createMedia } from '../adapters/media.ts';
import { createRenderer } from '../adapters/renderer.ts';
import type { TimedRenderer } from '../adapters/renderer.ts';
import { createTranscriber } from '../adapters/transcriber.ts';
import type { Aligner, Clock, Measure, Media, Transcriber } from '../ports.ts';
import { localPlaceholders } from '../prepare/placeholders.ts';
import type { Placeholders } from '../prepare/placeholders.ts';

export type ToolName = 'hyperframes' | 'ffmpeg' | 'ffprobe';
export interface Where { hyperframes: string; ffmpeg: string; ffprobe: string; root: string }   // root: the viraleditor folder (its node_modules hold the CLI and the fonts)
export interface Tools {
  where: Where;
  media: Media;
  measure: Measure;
  renderer(quality: 'draft' | 'looks'): TimedRenderer;
  transcriber: Transcriber;            // finds the words of a sound (whisper); `words` without a script
  aligner: Aligner;                    // places the words of a known script on a sound (tools/align); `words --script`
  placeholders: Placeholders;          // stand-in media made on this machine (frame-bar clips, lettered pictures, tones): what `init` fills a project with
  /** Runs a tool and returns its exit code and output. The child's environment is the allow list of adapters/exec.ts: no key of an outside service reaches it. */
  exec(tool: ToolName, args: string[], timeoutMs?: number): Promise<ExecResult>;
}
export interface Context {
  cwd: string;                         // relative paths on the command line are read from here
  clock: Clock;
  log(line: string): void;             // stderr: progress and logs, never part of the answer
  tools: Tools;
}

/** The switches every HyperFrames child runs with (rules: no telemetry, no update check). */
const SWITCHES = { HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', NO_COLOR: '1' };
const TOOL_TIMEOUT_MS = 5 * 60_000;

/** `exec` over the real binaries. The HyperFrames CLI leads its own process group, so its Chrome never outlives it. */
export function toolRunner(where: Where): Tools['exec'] {
  return (tool, args, timeoutMs = TOOL_TIMEOUT_MS) => runProcess(where[tool], args, tool === 'hyperframes' ? { timeoutMs, env: SWITCHES, killGroup: true } : { timeoutMs });
}

/** The first place a binary is found: the PATH, then the usual folders. Not found: its bare name (starting it then fails, and `doctor` says so). */
function find(name: string): string {
  const dirs = [...(process.env.PATH ?? '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].filter((dir) => dir !== '');
  return dirs.map((dir) => join(dir, name)).find((path) => existsSync(path)) ?? name;
}

export function realContext(): Context {
  const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
  const where: Where = { root, hyperframes: join(root, 'node_modules', '.bin', 'hyperframes'), ffmpeg: find('ffmpeg'), ffprobe: find('ffprobe') };
  const measure = createMeasure(where.ffmpeg, where.ffprobe);
  return {
    cwd: process.env.INIT_CWD ?? process.cwd(),        // through `pnpm --dir <viraleditor>` the caller's folder is INIT_CWD, not the package's
    clock: { now: () => new Date() },
    log: (line) => { process.stderr.write(`${line}\n`); },
    tools: {
      where,
      measure,
      media: createMedia(where.ffmpeg, where.ffprobe),
      renderer: (quality) => createRenderer({ bin: where.hyperframes, ffmpeg: where.ffmpeg, ffprobe: where.ffprobe, measure, quality }),
      transcriber: createTranscriber(where.hyperframes),
      aligner: createAligner(),
      placeholders: localPlaceholders({ ffmpeg: where.ffmpeg }),
      exec: toolRunner(where),
    },
  };
}
