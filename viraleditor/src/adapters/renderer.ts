import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Timeline } from '../edit/timeline.ts';
import { RenderError } from '../ports.ts';
import type { CheckIssue, Loudness, MediaFacts, Measure, RenderCall, Renderer } from '../ports.ts';
import { cliEncodeArgs, containerFacts, finalPassArgs, gainFilter, hardwareEncoderFault } from './encode.ts';
import type { EncodePath } from './encode.ts';
import { ExecError, runProcess } from './exec.ts';

export interface RendererOptions {
  bin: string;                          // the `hyperframes` executable
  ffmpeg: string;
  ffprobe: string;
  measure: Measure;                     // the rendered file is checked with it (streams) and its sound is measured (loudness)
  quality?: 'draft' | 'looks';          // default 'looks'
  workers?: number;                     // default: 1 for a timeline without animations, otherwise 4; capped by the CPU count
  encode?: EncodePath;                  // who encodes the delivered picture (encode.ts); default DEFAULT_ENCODE. 'hardware' falls back to 'cli' when the hardware encoder is missing or the CLI fails with it (the result's note says so); quality 'draft' always takes 'cli'
  timeoutMs?: number;                   // for the render child; default 30 minutes
  checkTimeoutMs?: number;              // for lint and check; default 5 minutes
  verifyRepeat?: boolean;               // opt-in, for every render of this renderer (one call asks with its own `RenderCall`): two identical decoded pictures before publication; one bounded mismatch retry (up to 3 renders)
  cpus?: number;                        // default: this machine's; here so a test can fix it
}

/** One stage of a render and how long it took. The CLI's own stages are named `cli.<its name>` and lie inside `cli`. */
export interface StageTime { stage: string; seconds: number }
/** What `render` returns on top of the port's MediaFacts. */
export interface RenderFacts extends MediaFacts {
  encode: EncodePath;                   // the path that wrote the delivered picture
  note: string | null;                  // why that is not the path that was asked for; null: it is
  stages: StageTime[];                  // in the order they ran
}
/** The Renderer of ports.ts, with the richer result. */
export interface TimedRenderer extends Renderer {
  render(dir: string, to: string, onProgress: (p: { frame: number; frames: number }) => void, call?: RenderCall): Promise<RenderFacts>;
}

/** The path a renderer takes when its options name none. */
export const DEFAULT_ENCODE: EncodePath = 'cli';

const SWITCHES = { HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', NO_COLOR: '1' };
/**
 * For the CLI child on the 'hardware' path: with more than one worker, HyperFrames 0.8.120 then feeds the encoder while it
 * captures instead of encoding the captured frames afterwards. The switch is not in `render --help` (the CLI prints its name
 * when it is on; it is that version's default on Linux). Same frames (0 of 900 checksums differ); 12 to 14 s less on a busy
 * machine, nothing lost on a quiet one (docs/research/2026-10-04-viraleditor-speed-2.md §5).
 */
const ENCODE_WHILE_CAPTURING = { HF_CAPTURE_PARALLEL_STREAM: 'true' };
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const CHECK_TIMEOUT_MS = 5 * 60_000;
/** The only HyperFrames version the parsing here was read from; `ready` refuses any other. */
export const HYPERFRAMES_VERSION = '0.8.120';
const FAST_TIMEOUT_MS = 2 * 60_000;
/** Workers for an animated timeline (the spike: 4 was the best of 4, 6 and 8). A static one runs on one worker (drawElement capture). */
const ANIMATED_WORKERS = 4;
/** Below this many dB the loudness pass changes nothing. */
export const LOUDNESS_MIN_GAIN = 0.1;
const TAIL_LINES = 12;
/** Loudness pass limits: quieter than this is near-silence (not amplified); the gain never exceeds MAX_GAIN; PEAK_MARGIN stays under the ceiling when the peak limits (the AAC encode can overshoot). */
export const LOUDNESS_FLOOR = -50;
export const MAX_GAIN = 20;
export const PEAK_MARGIN = 0.5;
/** A mix the ceiling leaves more than LIMIT_ABOVE dB under the target gets the missing gain through a peak limiter, when that is at most LIMIT_MAX dB. */
export const LIMIT_ABOVE = 1;
export const LIMIT_MAX = 8;
/** The limiter holds this much further under the ceiling than the gain does: the AAC encode of a limited signal overshoots it by up to a dB. */
export const LIMIT_HEADROOM = 1;
/** Sound and picture must still be this close in length (seconds) after the pass. */
const DURATION_TOLERANCE = 0.05;

// ── small helpers ──
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const stripAnsi = (text: string): string => text.replace(ANSI, '');
/** The last lines of a CLI's output that say something: no escape codes, no progress bars. */
function tail(text: string): string {
  const lines = stripAnsi(text).split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l !== '' && !/[█░]/.test(l));
  return lines.slice(-TAIL_LINES).map((l) => l.slice(0, 300)).join('\n');
}

interface CliResult { code: number; stdout: string; stderr: string }
/** Runs the CLI through `runProcess`: the three switches, its own process group (Chrome must not outlive it), every chunk to `onData`. */
async function runCli(bin: string, args: string[], timeoutMs: number, onData?: (chunk: string, stream: 'stdout' | 'stderr') => void, env: Record<string, string> = {}): Promise<CliResult> {
  try {
    return await runProcess(bin, args, { timeoutMs, env: { ...env, ...SWITCHES }, killGroup: true, onData });
  } catch (e) {
    if (e instanceof ExecError) throw new RenderError(e.message);
    throw e;
  }
}
function tailNote(text: string): string {
  const t = tail(text);
  return t === '' ? '' : `:\n${t}`;
}

/** The JSON object a `--json` command printed (from its first brace), or null. */
function jsonOf(text: string): Record<string, unknown> | null {
  const from = text.indexOf('{');
  if (from < 0) return null;
  try {
    const value: unknown = JSON.parse(text.slice(from));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch { return null; }
}

// ── timeline.json ──
type Run = Pick<Timeline, 'fps' | 'frames' | 'width' | 'height' | 'checkAt' | 'master'> & { animated: boolean; hasAudio: boolean };
function readTimeline(dir: string): Run {
  const file = join(dir, 'timeline.json');
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { throw new RenderError(`cannot read ${file}`); }
  let t: Partial<Timeline>;
  try { t = JSON.parse(text) as Partial<Timeline>; } catch { throw new RenderError(`${file} is not JSON`); }
  const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (t === null || typeof t !== 'object' || !positive(t.fps) || !positive(t.frames) || !positive(t.width) || !positive(t.height)
    || !Array.isArray(t.checkAt) || !Array.isArray(t.audio) || !Array.isArray(t.animations)) {
    throw new RenderError(`${file} lacks fps, frames, width, height, checkAt, audio or animations`);
  }
  const m = t.master;
  const master = m && typeof m.lufs === 'number' && typeof m.peak === 'number' ? { lufs: m.lufs, peak: m.peak } : null;
  return { fps: t.fps, frames: t.frames, width: t.width, height: t.height, checkAt: t.checkAt as number[], master, animated: t.animations.length > 0, hasAudio: t.audio.length > 0 };
}

// ── temp files ──
const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
const STALE_MS = 60 * 60_000;
/** Removes the temp files beside `target` that a run which no longer exists left: the writer's pid (in the name) is not alive, or, with no pid in the name, the file is over an hour old. */
function sweepStale(target: string): void {
  const dir = dirname(target);
  const named = new RegExp(`^\\.${escapeRe(basename(target))}\\.(?:(\\d+)-)?[0-9a-f]{8}\\.(?:render|sound|audio)\\.mp4$`);
  for (const name of readdirSync(dir)) {
    const m = named.exec(name);
    if (m === null) continue;
    const file = join(dir, name);
    const stale = m[1] !== undefined ? !alive(Number(m[1])) : Date.now() - statSync(file).mtimeMs > STALE_MS;
    if (stale) rmSync(file, { force: true });
  }
}

// ── findings of lint / check ──
interface Finding { code?: unknown; severity?: unknown; message?: unknown; selector?: unknown; file?: unknown; sourceFile?: unknown; time?: unknown }
const asFindings = (section: unknown): Finding[] => {
  const list = (section as { findings?: unknown } | null)?.findings;
  return Array.isArray(list) ? (list as Finding[]) : [];
};
/** The element id when the selector is exactly `#id`, else the file the finding names, else null. */
function targetOf(f: Finding): string | null {
  if (typeof f.selector === 'string') {
    const id = /^#([A-Za-z_][\w-]*)$/.exec(f.selector);
    if (id) return id[1]!;
  }
  const file = typeof f.file === 'string' ? f.file : typeof f.sourceFile === 'string' ? f.sourceFile : null;
  return file;
}
/** The layout check only warns when text or an element leaves its box or the canvas; for us that is a fault. */
const OVERFLOW_CODE = /overflow|clipped/i;
const OVERFLOW_TEXT = /(extends|overflows?|outside|beyond).*(box|canvas|container|frame)/i;
function issueOf(f: Finding, withTime: boolean): CheckIssue {
  return {
    code: typeof f.code === 'string' ? f.code : 'unknown',
    message: typeof f.message === 'string' ? f.message : '',
    target: targetOf(f),
    second: withTime && typeof f.time === 'number' ? f.time : null,
  };
}

// ── progress ──
/** Reads the CLI's output chunk by chunk and calls `onProgress` for each `frame n/N` that moves forward. `frames` is the timeline's. */
export function progressReader(frames: number, onProgress: (p: { frame: number; frames: number }) => void): (chunk: string) => void {
  let pending = '';
  let last = 0;
  return (chunk) => {
    pending += stripAnsi(chunk);
    const pattern = /frame (\d+)\//gi;
    let end = 0;
    for (let m = pattern.exec(pending); m !== null; m = pattern.exec(pending)) {
      end = pattern.lastIndex;
      const frame = Math.min(Number(m[1]), frames);
      if (frame > last) {
        last = frame;
        try { onProgress({ frame, frames }); } catch { /* a callback that fails must not stop the render */ }
      }
    }
    pending = pending.slice(end).slice(-64);
  };
}

// ── stage times ──
/** The stage times of the CLI's closing line (`… · capture 24.2s · encode 1m 21.8s · assemble 1.1s`), in its order; [] when it printed none. */
export function cliStages(output: string): StageTime[] {
  const line = stripAnsi(output).split(/[\r\n]+/).reverse().find((l) => /·\s*capture\s+(?:\d+m\s+)?[\d.]+s/.test(l));
  if (line === undefined) return [];
  const stages: StageTime[] = [];
  for (const part of line.split('·')) {
    const m = /^(.*?\S)\s+(?:(\d+)m\s+)?(\d+(?:\.\d+)?)s$/.exec(part.trim());
    if (m) stages.push({ stage: m[1]!, seconds: Number(m[2] ?? 0) * 60 + Number(m[3]) });
  }
  return stages;
}

/** The CLI ran and failed, or wrote nothing (not: it could not start, or did not finish in time). */
class CliFailed extends RenderError {}
/** The CLI failed on the 'hardware' path: the render is done again on the 'cli' path. */
class HardwareFailed extends Error {}

// ── rules ──
/** 1 worker for a static timeline, 4 for an animated one, never more than max(1, cpus − 2). */
export function workerCount(timeline: { animated: boolean }, asked: number | undefined, cpus: number): number {
  const wanted = asked ?? (timeline.animated ? ANIMATED_WORKERS : 1);
  return Math.max(1, Math.min(Math.floor(wanted), Math.max(1, cpus - 2)));
}

/** dB to add so the integrated loudness reaches the target without the true peak passing the ceiling (less PEAK_MARGIN), at most MAX_GAIN; null: silence or near-silence, left alone. */
export function loudnessGain(loudness: Loudness, master: { lufs: number; peak: number }): number | null {
  if (!Number.isFinite(loudness.integrated) || !Number.isFinite(loudness.truePeak) || loudness.integrated < LOUDNESS_FLOOR) return null;
  let gain = Math.min(master.lufs - loudness.integrated, MAX_GAIN);
  const ceiling = master.peak - PEAK_MARGIN;
  if (loudness.truePeak + gain > ceiling) gain = ceiling - loudness.truePeak;
  return gain;
}

/** The loudness pass for a measured mix: the gain, and the ceiling (dBTP) of the peak limiter that carries the gain the peak does not allow; null: left alone. */
export function masterPass(loudness: Loudness, master: { lufs: number; peak: number }): { gain: number; limit: number | null } | null {
  const gain = loudnessGain(loudness, master);
  if (gain === null) return null;
  const missing = Math.min(master.lufs - loudness.integrated, MAX_GAIN) - gain;
  return missing > LIMIT_ABOVE && missing <= LIMIT_MAX ? { gain: gain + missing, limit: master.peak - PEAK_MARGIN - LIMIT_HEADROOM } : { gain, limit: null };
}

export function createRenderer(options: RendererOptions): TimedRenderer {
  const quality = options.quality ?? 'looks';
  const encode = options.encode ?? DEFAULT_ENCODE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const checkMs = options.checkTimeoutMs ?? CHECK_TIMEOUT_MS;
  const cpus = options.cpus ?? availableParallelism();

  async function cli(args: string[], limit = timeoutMs, onData?: (chunk: string, stream: 'stdout' | 'stderr') => void, env: Record<string, string> = {}): Promise<CliResult> {
    return runCli(options.bin, args, limit, onData, env);
  }
  function failed(what: string, r: CliResult): RenderError {
    return new RenderError(`${what} exited ${r.code}${tailNote(r.stderr + '\n' + r.stdout)}`);
  }

  async function check(dir: string): Promise<{ ok: boolean; issues: CheckIssue[] }> {
    const timeline = readTimeline(dir);
    const lint = await cli(['lint', dir, '--json'], checkMs);
    const lintJson = jsonOf(lint.stdout);
    if (lintJson === null || (lint.code !== 0 && asFindings(lintJson).length === 0)) throw failed('hyperframes lint', lint);   // a failing lint names its findings; `{"ok":false,"error":"Command failed"}` does not
    const at = timeline.checkAt.length > 0 ? ['--at', timeline.checkAt.map((frame) => String(frame / timeline.fps)).join(',')] : [];
    const run = await cli(['check', dir, '--no-contrast', '--json', ...at], checkMs);
    const report = jsonOf(run.stdout);
    if (report === null || report.lint === undefined || report.runtime === undefined || report.layout === undefined) throw failed('hyperframes check', run);

    const issues: CheckIssue[] = [];
    const seen = new Set<string>();
    const add = (f: Finding, withTime: boolean) => {
      const issue = issueOf(f, withTime);
      const key = `${issue.code}|${issue.message}|${issue.second}|${issue.target}`;     // lint reports the same finding twice: on its own and inside check
      if (!seen.has(key)) { seen.add(key); issues.push(issue); }
    };
    for (const f of asFindings(lintJson)) if (f.severity === 'error') add(f, false);
    for (const f of asFindings(report.lint)) if (f.severity === 'error') add(f, false);
    for (const f of asFindings(report.runtime)) if (f.severity === 'error') add(f, false);
    for (const f of asFindings(report.layout)) {
      const overflow = (typeof f.code === 'string' && OVERFLOW_CODE.test(f.code)) || (typeof f.message === 'string' && OVERFLOW_TEXT.test(f.message));
      if (f.severity === 'error' || overflow) add(f, true);
    }
    if (issues.length === 0 && (report.ok === false || lintJson.ok === false || run.code !== 0)) {
      // the CLI says no, but nothing we can name: never report that as a pass
      const section = ['lint', 'runtime', 'layout', 'motion', 'contrast'].filter((name) => ((report[name] as { ok?: unknown } | undefined)?.ok === false)).join(', ') || 'unknown';
      issues.push({ code: 'check_failed', message: `hyperframes check failed (exit ${run.code}) in: ${section}`, target: null, second: null });
    }
    return { ok: issues.length === 0, issues };
  }

  /** undefined: not tried yet; null: the hardware encoder works; a string: why it does not (kept for the life of this renderer). */
  let hardwareFault: string | null | undefined;
  async function hardware(): Promise<string | null> {
    if (hardwareFault === undefined) hardwareFault = await hardwareEncoderFault(options.ffmpeg, FAST_TIMEOUT_MS);
    return hardwareFault;
  }
  const softwareNote = (why: string): string => `encoded on the software path (libx264 inside the CLI): ${why}`;

  async function render(dir: string, to: string, onProgress: (p: { frame: number; frames: number }) => void, call: RenderCall = {}): Promise<RenderFacts> {
    const timeline = readTimeline(dir);
    let last = 0;
    const report = (p: { frame: number; frames: number }) => {       // never backwards, never twice
      if (p.frame <= last) return;
      last = p.frame;
      try { onProgress(p); } catch { /* a callback that fails must not stop the render */ }
    };
    const target = resolve(to);
    try {
      mkdirSync(dirname(target), { recursive: true });
      rmSync(target, { force: true });                               // after a failure there is never a file at `to`, an older one included
      sweepStale(target);
    } catch (e) { throw new RenderError(`cannot prepare the target ${target}: ${e instanceof Error ? e.message : String(e)}`); }
    const stem = `.${basename(target)}.${process.pid}-${randomUUID().slice(0, 8)}`;
    const rendered = join(dirname(target), `${stem}.render.mp4`);
    const adjusted = join(dirname(target), `${stem}.sound.mp4`);
    const audio = join(dirname(target), `${stem}.audio.mp4`);
    const clean = () => { for (const file of [rendered, adjusted, audio]) rmSync(file, { force: true }); };

    const stages: StageTime[] = [];
    const timed = async <T>(stage: string, work: () => Promise<T>): Promise<T> => {
      const from = performance.now();
      try { return await work(); } finally { stages.push({ stage, seconds: (performance.now() - from) / 1000 }); }
    };

    /** The CLI child. `most`: the last frame number it may report (the hardware path keeps frames/frames for the end of its own pass). */
    async function runCliRender(extra: string[], most: number, env: Record<string, string> = {}): Promise<void> {
      const workers = workerCount(timeline, options.workers, cpus);
      const capped = (p: { frame: number; frames: number }) => report({ frame: Math.min(p.frame, most), frames: p.frames });
      const run = await timed('cli', () => cli(['render', dir, '--fps', String(timeline.fps), '--quality', quality, '--workers', String(workers), '--output', rendered, ...extra],
        timeoutMs, (() => {
          const readers = { stdout: progressReader(timeline.frames, capped), stderr: progressReader(timeline.frames, capped) };   // one line buffer per stream
          return (chunk: string, stream: 'stdout' | 'stderr') => readers[stream](chunk);
        })(), env));
      for (const s of cliStages(`${run.stdout}\n${run.stderr}`)) stages.push({ stage: `cli.${s.stage}`, seconds: s.seconds });
      if (run.code !== 0) throw new CliFailed(failed('hyperframes render', run).message);
      if (!existsSync(rendered)) throw new CliFailed(`hyperframes render exited 0 but wrote no file${tailNote(run.stderr + '\n' + run.stdout)}`);
    }
    /** Size, rate, frame count and sound are the timeline's, or RenderError naming every difference. */
    function sameAsTimeline(facts: MediaFacts): void {
      const differences: string[] = [];
      const compare = (name: string, got: number, want: number) => { if (got !== want) differences.push(`${name}: ${got}, the timeline says ${want}`); };
      compare('width', facts.width, timeline.width);
      compare('height', facts.height, timeline.height);
      if (Math.abs(facts.fps - timeline.fps) > 1e-6) differences.push(`rate: ${facts.fps}, the timeline says ${timeline.fps}`);
      compare('frames', facts.frames, timeline.frames);
      if (timeline.hasAudio && !facts.audio) differences.push('no sound stream, the timeline has audio');
      if (differences.length > 0) throw new RenderError(`the rendered file differs from the timeline (${differences.join('; ')})`);
    }

    /** The CLI encodes the picture (libx264); our pass, when the loudness asks for one, copies it and changes the sound. */
    async function viaCli(): Promise<{ facts: MediaFacts; final: string }> {
      await runCliRender([], timeline.frames);
      let facts = await timed('probe', () => streams(rendered));
      sameAsTimeline(facts);
      const before = facts.seconds;
      let final = rendered;
      if (timeline.master !== null && facts.audio) {
        const master = timeline.master;
        const loudness = await timed('loudness', () => options.measure.loudness(rendered));
        const pass = loudness === null ? null : masterPass(loudness, master);
        if (pass !== null && Math.abs(pass.gain) >= LOUDNESS_MIN_GAIN) {
          await timed('gain', () => applyGain(rendered, adjusted, pass));
          facts = await timed('verify', () => streams(adjusted));
          if (facts.frames !== timeline.frames) throw new RenderError(`the loudness pass changed the picture (frames: ${facts.frames}, the timeline says ${timeline.frames})`);
          if (Math.abs(facts.seconds - before) > DURATION_TOLERANCE) throw new RenderError(`the loudness pass changed the length (${facts.seconds} s, was ${before} s)`);
          final = adjusted;
        }
      }
      return { facts, final };
    }

    /** The CLI encodes the picture with its hardware encoder; our pass copies it, completes its colour tags and sets the loudness. */
    async function viaHardware(): Promise<{ facts: MediaFacts; final: string }> {
      try { await runCliRender(cliEncodeArgs('hardware', { width: timeline.width, height: timeline.height, fps: timeline.fps }), timeline.frames - 1, ENCODE_WHILE_CAPTURING); }
      catch (e) { if (e instanceof CliFailed) throw new HardwareFailed(e.message); throw e; }
      let pass: { gain: number; limit: number | null } | null = null;
      if (timeline.master !== null && timeline.hasAudio) {
        const master = timeline.master;
        pass = await timed('loudness', async () => {
          // the sound alone, copied: measuring it does not decode the picture
          const copy = await ffmpeg(['-y', '-v', 'error', '-nostdin', '-i', rendered, '-vn', '-map', '0:a:0', '-c:a', 'copy', audio]);
          if (copy.code !== 0 || !existsSync(audio)) throw new RenderError(`the rendered file has no sound stream that can be read, the timeline has audio: ${copy.stderr.trim().slice(-300)}`);
          const loudness = await options.measure.loudness(audio);
          const wanted = loudness === null ? null : masterPass(loudness, master);
          return wanted !== null && Math.abs(wanted.gain) >= LOUDNESS_MIN_GAIN ? wanted : null;
        });
      }
      await timed('pass', async () => {
        const r = await ffmpeg(finalPassArgs({ from: rendered, to: adjusted, gain: pass?.gain ?? null, limit: pass?.limit ?? null }));
        if (r.code !== 0) throw new RenderError(`ffmpeg exited ${r.code} in the final pass: ${r.stderr.trim().slice(-500)}`);
        if (!existsSync(adjusted)) throw new RenderError('ffmpeg wrote nothing in the final pass');
      });
      // the container's own numbers: the picture was copied, not encoded again, and the quality checks decode the file anyway
      const facts = await timed('verify', () => containerFacts(options.ffprobe, adjusted, FAST_TIMEOUT_MS));
      sameAsTimeline(facts);
      const length = timeline.frames / timeline.fps;
      if (Math.abs(facts.seconds - length) > DURATION_TOLERANCE) throw new RenderError(`the final pass changed the length (${facts.seconds} s, the timeline says ${length} s)`);
      return { facts, final: adjusted };
    }

    try {
      let path: EncodePath = quality === 'draft' ? 'cli' : encode;
      let note: string | null = null;
      if (path === 'hardware') {
        const fault = await hardware();
        if (fault !== null) { path = 'cli'; note = softwareNote(fault); }
      }
      let made: { facts: MediaFacts; final: string };
      if (path === 'hardware') {
        try { made = await viaHardware(); }
        catch (e) {
          if (!(e instanceof HardwareFailed)) throw e;
          const why = `the CLI failed with its hardware encoder (${e.message.split('\n')[0]})`;
          path = 'cli';
          note = softwareNote(why);
          clean();
          made = await viaCli();                                     // a composition the CLI cannot render at all fails here again, with its own message
          hardwareFault = why;                                       // the software path rendered what the hardware path could not: the renders after this one start there
        }
      } else made = await viaCli();
      let settled: string | null = null;
      if (call.verifyRepeat ?? options.verifyRepeat) {
        const fingerprint = async (file: string): Promise<string> => {
          const result = await timed('picture-verify', () => ffmpeg(['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', file, '-map', '0:v:0', '-f', 'framemd5', '-']));
          const hashes = result.stdout.split('\n').filter(line => line.trim() !== '' && !line.startsWith('#')).map(line => line.split(',').at(-1)?.trim() ?? '');
          if (result.code !== 0 || hashes.length !== timeline.frames || hashes.some(hash => !/^[a-f0-9]{32}$/.test(hash))) throw new RenderError('render-picture-verification-failed');
          return hashes.join(',');
        };
        // the picture that two renders agree on is the one published: a third render settles a mismatch whichever of the two it repeats
        const seen = [await fingerprint(made.final)];
        let matched = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          clean();                                                   // a repeat that exits 0 and writes nothing must not find the file of the render before it
          made = path === 'hardware' ? await viaHardware() : await viaCli();
          const current = await fingerprint(made.final);
          const repeated = seen.indexOf(current);
          if (repeated !== -1) {
            if (seen.length > 1) settled = `render-picture-mismatch: ${target} render ${seen.length + 1} repeats render ${repeated + 1}, published`;
            matched = true;
            break;
          }
          seen.push(current);
          note = [note, 'render verification retried after a picture mismatch'].filter(Boolean).join('; ');
        }
        if (!matched) throw new RenderError('render-picture-unstable');
      }
      renameSync(made.final, target);
      if (settled !== null) console.error(settled);                  // one line per mismatch that a third render settled: how often it happens is counted from the log
      report({ frame: timeline.frames, frames: timeline.frames });
      const { facts } = made;
      return { width: facts.width, height: facts.height, fps: facts.fps, frames: facts.frames, seconds: facts.seconds, audio: facts.audio, encode: path, note, stages };
    } finally {
      clean();
    }
  }

  async function streams(file: string) {
    try { return await options.measure.streams(file); }
    catch (e) { throw new RenderError(`cannot read the rendered file: ${e instanceof Error ? e.message : String(e)}`); }
  }

  /** ffmpeg under the render's time limit; a binary that cannot start or does not finish is a RenderError. */
  async function ffmpeg(args: string[]) {
    try { return await runProcess(options.ffmpeg, args, { timeoutMs }); }
    catch (e) { throw new RenderError(e instanceof ExecError ? e.message : String(e)); }
  }

  /** `volume`, and the peak limiter when the pass has one: the picture is copied, the sound is encoded again as AAC at 48 kHz. */
  async function applyGain(from: string, to: string, pass: { gain: number; limit: number | null }): Promise<void> {
    const r = await ffmpeg(['-y', '-v', 'error', '-nostdin', '-i', from, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy',
      '-af', gainFilter(pass), '-c:a', 'aac', '-ar', '48000', '-b:a', '192k', '-movflags', '+faststart', to]);
    if (r.code !== 0) throw new RenderError(`ffmpeg exited ${r.code} in the loudness pass: ${r.stderr.trim().slice(-500)}`);
    if (!existsSync(to)) throw new RenderError('ffmpeg wrote nothing in the loudness pass');
  }

  async function ready(): Promise<{ ready: boolean; note: string | null }> {
    const missing: string[] = [];
    const version = await cli(['--version'], FAST_TIMEOUT_MS).catch((e: unknown) => e as Error);
    if (version instanceof Error) missing.push(`hyperframes does not run: ${version.message}`);
    else if (version.code !== 0) missing.push(`hyperframes --version exited ${version.code}`);
    else if (version.stdout.trim() !== HYPERFRAMES_VERSION) missing.push(`hyperframes is version ${version.stdout.trim().slice(0, 40) || 'unknown'}, this editor reads only ${HYPERFRAMES_VERSION}`);
    else {
      const doctor = await cli(['doctor', '--json'], FAST_TIMEOUT_MS).catch((e: unknown) => e as Error);
      const report = doctor instanceof Error ? null : jsonOf(doctor.stdout);
      const checks = Array.isArray(report?.checks) ? (report.checks as { name?: string; ok?: boolean; detail?: string; hint?: string }[]) : null;
      if (doctor instanceof Error) missing.push(`hyperframes doctor does not run: ${doctor.message}`);
      else if (checks === null) missing.push('hyperframes doctor printed no report');
      else {
        const chrome = checks.find((c) => c.name === 'Chrome');
        if (!chrome || chrome.ok !== true) missing.push(`Chrome for hyperframes is missing${chrome?.hint ? ` (${chrome.hint})` : ''}`);
      }
    }
    const runs: Record<string, boolean> = {};
    for (const [name, bin, flag] of [['ffmpeg', options.ffmpeg, '-version'], ['ffprobe', options.ffprobe, '-version']] as const) {
      try {
        const r = await runProcess(bin, [flag], { timeoutMs: FAST_TIMEOUT_MS });
        runs[name] = r.code === 0;
        if (r.code !== 0) missing.push(`${name} exited ${r.code}: ${bin}`);
      } catch { runs[name] = false; missing.push(`${name} does not run: ${bin}`); }
    }
    // a missing hardware encoder does not stop a render: it takes the software path, and says so here and in every result
    const fault = encode === 'hardware' && runs.ffmpeg === true ? await hardware() : null;
    const notes = fault === null ? missing : [...missing, softwareNote(fault).replace(/^encoded/, 'renders are encoded')];
    return { ready: missing.length === 0, note: notes.length === 0 ? null : notes.join('; ') };
  }

  return { check, render, ready };
}
