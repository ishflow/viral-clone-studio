import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Loudness, Measure, StreamFacts } from '../ports.ts';
import { RenderError } from '../ports.ts';
import { fixtureTimeline } from './fixtures/composition.ts';
import { DELIVERY_BPP, megabits } from './encode.ts';
import type { EncodePath } from './encode.ts';
import { DEFAULT_ENCODE, LOUDNESS_MIN_GAIN, cliStages, createRenderer, loudnessGain, masterPass, progressReader, workerCount } from './renderer.ts';

const FIXTURES = resolve(import.meta.dirname, '../../../docs/reference/fixtures');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
const MASTER = { lufs: -14, peak: -1 };
const FACTS: StreamFacts = {
  width: 720, height: 1280, fps: 30, frames: 60, seconds: 2, audio: true, codec: 'h264', pixelFormat: 'yuv420p',
  colour: { space: null, transfer: null, primaries: null }, keyframes: [0], sound: { codec: 'aac', sampleRate: 48000, channels: 2 }, constantRate: true,
};

/** A temp folder holding a timeline.json (the composition folder as far as the adapter reads it). */
function composition(edit: (t: ReturnType<typeof fixtureTimeline>) => void = () => {}, master: { lufs: number; peak: number } | null = null): string {
  const dir = mkdtempSync(join(tmpdir(), 've-renderer-comp-'));
  const t = fixtureTimeline(master);
  edit(t);
  writeFileSync(join(dir, 'timeline.json'), JSON.stringify(t));
  return dir;
}

type Bodies = { version?: string; doctor?: string; lint?: string; check?: string; render?: string };
const CLEAN_LINT = `echo '{"ok":true,"errorCount":0,"warningCount":0,"infoCount":0,"findings":[],"filesScanned":1}'`;
/** Writes JSON to a file next to the stub and prints it: JSON in a shell script without quoting trouble. */
function cat(file: string): string { return `cat '${join(FIXTURES, file)}'`; }
/** `render` body: prints these progress lines like the real CLI (CR-separated, with escape codes) and writes the output file. */
function renderBody(lines: string[], exit = 0): string {
  return `while [ $# -gt 0 ]; do [ "$1" = "--output" ] && o="$2"; shift; done
${lines.map((l) => `printf '\\033[2K  %s\\r' '${l}'`).join('\n')}
echo "rendered" > "$o"
exit ${exit}`;
}

/** A stub `hyperframes`: logs argv and the switches of every call, then behaves as scripted. */
function stub(bodies: Bodies) {
  const dir = mkdtempSync(join(tmpdir(), 've-renderer-stub-'));
  const calls = join(dir, 'calls');
  mkdirSync(calls);
  const bin = join(dir, 'hyperframes');
  writeFileSync(bin, `#!/bin/sh
n=$(ls "${calls}" | wc -l | tr -d ' ')
{ echo "$1"; for a in "$@"; do printf '%s\\n' "$a"; done; echo "env:$HYPERFRAMES_NO_TELEMETRY$DO_NOT_TRACK$HYPERFRAMES_NO_UPDATE_CHECK"; echo "key:\${MAGNIFIC_API_KEY-unset}"; } > "${calls}/call-$n"
case "$1" in
  --version) ${bodies.version ?? 'echo 0.8.120'} ;;
  doctor) ${bodies.doctor ?? `echo '{"ok":true,"checks":[{"name":"Chrome","ok":true,"detail":"cache"}]}'`} ;;
  lint) ${bodies.lint ?? CLEAN_LINT} ;;
  check) ${bodies.check ?? cat('hf-check-ok.json')} ;;
  render) ${bodies.render ?? renderBody(['Streaming frame 60/60'])} ;;
esac
`);
  chmodSync(bin, 0o755);
  const all = () => readdirSync(calls).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))).map((f) => readFileSync(join(calls, f), 'utf8').split('\n'));
  return {
    bin,
    all,
    /** argv of the n-th call of a command (without the leading command echo and the two trailing lines). */
    call(command: string, n = 0) {
      const c = all().filter((lines) => lines[0] === command)[n]!;
      return { args: c.slice(1, -3), env: c.at(-3)!, key: c.at(-2)! };
    },
  };
}

/** A stub ffmpeg: logs its arguments and copies the input (after -i) to the last argument. */
function ffmpegStub(exit = 0) {
  const dir = mkdtempSync(join(tmpdir(), 've-renderer-ffmpeg-'));
  const log = join(dir, 'args.txt');
  const bin = join(dir, 'ffmpeg');
  writeFileSync(bin, `#!/bin/sh
for a in "$@"; do printf '%s\\n' "$a"; done >> "${log}"
echo "--" >> "${log}"
while [ $# -gt 0 ]; do [ "$1" = "-i" ] && i="$2"; last="$1"; shift; done
[ ${exit} -ne 0 ] && { echo "ffmpeg broke" >&2; exit ${exit}; }
cp "$i" "$last"
`);
  chmodSync(bin, 0o755);
  return { bin, runs: () => (existsSync(log) ? readFileSync(log, 'utf8').split('--\n').filter((s) => s !== '').map((s) => s.trim().split('\n')) : []) };
}

function fakeMeasure(options: { facts?: (file: string, call: number) => StreamFacts; loudness?: Loudness | null } = {}) {
  const seen = { streams: [] as string[], loudness: [] as string[] };
  const measure: Measure = {
    async streams(file) { seen.streams.push(file); return (options.facts ?? (() => FACTS))(file, seen.streams.length); },
    async loudness(file) { seen.loudness.push(file); return options.loudness === undefined ? { integrated: -14, truePeak: -3, range: 5 } : options.loudness; },
    async momentary() { return []; }, async black() { return []; }, async frozen() { return []; }, async picture() { throw new Error('not used'); },
  };
  return { measure, seen };
}

/** The renderer over a stub CLI. The path is 'cli' unless a test names another: the tests of that path stay what they are whatever the default is. */
function setup(bodies: Bodies = {}, extra: { checkTimeoutMs?: number; measure?: Measure; ffmpeg?: string; cpus?: number; workers?: number; quality?: 'draft' | 'looks'; timeoutMs?: number; encode?: EncodePath; verifyRepeat?: boolean } = {}) {
  const s = stub(bodies);
  const m = fakeMeasure();
  const renderer = createRenderer({ bin: s.bin, ffmpeg: extra.ffmpeg ?? 'ffmpeg-not-used', ffprobe: 'ffprobe-not-used', measure: extra.measure ?? m.measure, cpus: extra.cpus ?? 10, workers: extra.workers, quality: extra.quality, timeoutMs: extra.timeoutMs, checkTimeoutMs: extra.checkTimeoutMs, encode: extra.encode ?? 'cli', verifyRepeat: extra.verifyRepeat });
  const out = mkdtempSync(join(tmpdir(), 've-renderer-out-'));
  return { s, m, renderer, out, to: join(out, 'final.mp4') };
}
const noProgress = () => {};
const leftovers = (out: string): string[] => readdirSync(out);

describe('check', () => {
  it('passes lint and check the exact arguments, --at at full precision, the three switches and no key', async () => {
    process.env.MAGNIFIC_API_KEY = 'secret-key';
    try {
      const dir = composition((t) => { t.checkAt = [10, 25, 31]; });
      const { s, renderer } = setup();
      const result = await renderer.check(dir);
      expect(result).toEqual({ ok: true, issues: [] });
      const lint = s.call('lint');
      expect(lint.args).toEqual(['lint', dir, '--json']);
      const check = s.call('check');
      expect(check.args.slice(0, 4)).toEqual(['check', dir, '--no-contrast', '--json']);
      expect(check.args[4]).toBe('--at');
      expect(check.args[5]).toBe(`${10 / 30},${25 / 30},${31 / 30}`);
      expect(check.args[5]).toBe('0.3333333333333333,0.8333333333333334,1.0333333333333334');
      expect(check.args).toHaveLength(6);
      for (const c of [lint, check]) { expect(c.env).toBe('env:111'); expect(c.key).toBe('key:unset'); }
    } finally { delete process.env.MAGNIFIC_API_KEY; }
  });

  it('leaves --at out when the timeline has no check frames', async () => {
    const dir = composition((t) => { t.checkAt = []; });
    const { s, renderer } = setup();
    await renderer.check(dir);
    expect(s.call('check').args).toEqual(['check', dir, '--no-contrast', '--json']);
  });

  it('turns one lint error, one runtime error, one overflow warning and one unrelated warning into exactly three issues', async () => {
    const lintError = { code: 'missing_timeline_registry', severity: 'error', file: '/w/index.html', message: 'no timeline' };
    const lintWarning = { code: 'nested_structure_needs_subcomposition', severity: 'warning', file: '/w/index.html', message: 'nested' };
    const section = (findings: unknown[]) => ({ ok: true, errorCount: findings.length, warningCount: 0, infoCount: 0, findings });
    const json = {
      ok: false,
      lint: section([{ ...lintError, selector: '[data-composition-id]', sourceFile: '/w/index.html' }, lintWarning]),
      runtime: section([{ code: 'http_error', severity: 'error', message: '404 loading assets/a.woff2', selector: '#root', time: 0 }]),
      layout: section([
        { code: 'text_overflows_canvas', severity: 'warning', message: 'Text extends outside the composition canvas.', selector: '#t-hook', time: 1 },
        { code: 'content_overlap', severity: 'warning', message: 'Two items overlap.', selector: '#a', time: 1 },
      ]),
    };
    const lintOut = { ok: false, findings: [lintError, lintWarning] };
    const { renderer } = setup({ lint: `echo '${JSON.stringify(lintOut)}'; exit 1`, check: `echo '${JSON.stringify(json)}'; exit 1` });
    const result = await renderer.check(composition());
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      { code: 'missing_timeline_registry', message: 'no timeline', target: '/w/index.html', second: null },
      { code: 'http_error', message: '404 loading assets/a.woff2', target: 'root', second: null },
      { code: 'text_overflows_canvas', message: 'Text extends outside the composition canvas.', target: 't-hook', second: 1 },
    ]);
  });

  it('reads the real CLI output: runtime errors, a text overflow error and the canvas overflow note', async () => {
    const { renderer } = setup({ check: `${cat('hf-check-runtime-layout-errors.json')}; exit 1` });
    const { ok, issues } = await renderer.check(composition());
    expect(ok).toBe(false);
    expect(issues.map((i) => i.code)).toEqual(['console_error', 'page_error', 'http_error', 'request_failed', 'text_box_overflow', 'canvas_overflow']);
    expect(issues[2]).toMatchObject({ message: '404 loading assets/fonts/missing.woff2', target: 'index.html', second: null });
    expect(issues[4]).toMatchObject({ target: 't-hook', second: 1 });
  });

  it('reads a real lint error and names the file when there is no element id', async () => {
    const { renderer } = setup({ lint: `${cat('hf-lint-error.json')}; exit 1`, check: `${cat('hf-check-lint-error.json')}; exit 1` });
    const { ok, issues } = await renderer.check(composition());
    expect(ok).toBe(false);
    expect(issues).toHaveLength(1);                                                      // the same finding comes from lint and from check: once
    expect(issues[0]).toMatchObject({ code: 'missing_local_asset', target: '/work/bad/index.html', second: null });
    expect(issues[0]!.message).toContain('assets/clip-b.mp4');
  });

  it('two elements overflowing at the same second are two issues; lint and check still merge', async () => {
    const report = JSON.parse(fixture('hf-check-runtime-layout-errors.json'));
    const overflow = report.layout.findings.find((f: { code: string }) => f.code === 'text_box_overflow');
    report.layout.findings.push({ ...overflow, selector: '#t-two' });
    const { renderer } = setup({ check: `cat <<'EOF'\n${JSON.stringify(report)}\nEOF\nexit 1` });
    const { issues } = await renderer.check(composition());
    const overflows = issues.filter((i) => i.code === 'text_box_overflow');
    expect(overflows.map((i) => i.target).sort()).toEqual(['t-hook', 't-two']);
  });

  it('a non-zero exit with a report that names nothing is check_failed, not a pass', async () => {
    const quiet = JSON.stringify({ lint: { findings: [] }, runtime: { findings: [] }, layout: { findings: [] } });
    const { renderer } = setup({ check: `echo '${quiet}'; exit 1` });
    const r = await renderer.check(composition());
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual(['check_failed']);
    const fine = setup({ check: `echo '${quiet}'` });
    expect(await fine.renderer.check(composition())).toEqual({ ok: true, issues: [] });
  });

  it('an ok:false answer with no finding we can read is still a fault, never a pass', async () => {
    const json = { ok: false, lint: { findings: [] }, runtime: { findings: [] }, layout: { findings: [] }, contrast: { errorCount: 1 } };
    const { renderer } = setup({ check: `echo '${JSON.stringify(json)}'; exit 1` });
    const { ok, issues } = await renderer.check(composition());
    expect(ok).toBe(false);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('check_failed');
  });

  it('throws RenderError (not an issue) when timeline.json is missing, unreadable or incomplete', async () => {
    const { renderer } = setup();
    const empty = mkdtempSync(join(tmpdir(), 've-renderer-empty-'));
    await expect(renderer.check(empty)).rejects.toBeInstanceOf(RenderError);
    await expect(renderer.check(empty)).rejects.toThrow(/timeline\.json/);
    writeFileSync(join(empty, 'timeline.json'), '{not json');
    await expect(renderer.check(empty)).rejects.toThrow(/timeline\.json/);
    writeFileSync(join(empty, 'timeline.json'), JSON.stringify({ fps: 30 }));
    await expect(renderer.check(empty)).rejects.toThrow(RenderError);
  });

  it('throws RenderError when the CLI cannot start, or fails without a report', async () => {
    const missing = createRenderer({ bin: '/no/such/hyperframes', ffmpeg: 'f', ffprobe: 'p', measure: fakeMeasure().measure });
    await expect(missing.check(composition())).rejects.toThrow(/cannot start/);
    const { renderer } = setup({ check: `${cat('hf-check-no-dir.json')}; echo 'Not a directory: /x' >&2; exit 1` });
    const e = await renderer.check(composition()).catch((x) => x);
    expect(e).toBeInstanceOf(RenderError);
    expect(e.message).toMatch(/Not a directory/);
    const garbled = setup({ check: 'echo garbage; exit 3' });
    await expect(garbled.renderer.check(composition())).rejects.toThrow(/exited 3/);
  });

  it('throws RenderError when the CLI does not finish in time', async () => {
    const { renderer } = setup({ lint: 'sleep 20' }, { checkTimeoutMs: 300 });
    await expect(renderer.check(composition())).rejects.toThrow(/did not finish/);
  });
});

describe('render', () => {
  it('passes the exact arguments, writes beside `to` first, renames at the end, returns the facts', async () => {
    process.env.MAGNIFIC_API_KEY = 'secret-key';
    try {
      const dir = composition();
      const { s, renderer, out, to, m } = setup();
      const facts = await renderer.render(dir, to, noProgress);
      expect(facts).toMatchObject({ width: 720, height: 1280, fps: 30, frames: 60, seconds: 2, audio: true, encode: 'cli', note: null });
      expect(facts.stages.map((stage) => stage.stage)).toEqual(['cli', 'probe']);
      expect(facts.stages.every((stage) => stage.seconds >= 0)).toBe(true);
      const c = s.call('render');
      expect(c.args.slice(0, 9)).toEqual(['render', dir, '--fps', '30', '--quality', 'looks', '--workers', '1', '--output']);
      const temp = c.args[9]!;
      expect(c.args).toHaveLength(10);
      expect(temp).not.toBe(to);
      expect(resolve(temp, '..')).toBe(out);
      expect(temp.endsWith('.mp4')).toBe(true);
      expect(c.env).toBe('env:111');
      expect(c.key).toBe('key:unset');
      expect(existsSync(temp)).toBe(false);
      expect(leftovers(out)).toEqual(['final.mp4']);
      expect(m.seen.streams).toEqual([temp]);                                          // probed before the rename
    } finally { delete process.env.MAGNIFIC_API_KEY; }
  });

  it('reports progress from the CLI lines: never backwards, ending with frames/frames', async () => {
    const lines = ['Streaming frame 1/60', 'Streaming frame 31/60', 'Streaming frame 16/60', 'Streaming frame 31/60', 'Streaming frame 54/60', 'Streaming frame 60/60'];
    const { renderer, to } = setup({ render: renderBody(lines) });
    const seen: { frame: number; frames: number }[] = [];
    await renderer.render(composition(), to, (p) => seen.push(p));
    expect(seen.map((p) => p.frame)).toEqual([1, 31, 54, 60]);
    expect(seen.every((p) => p.frames === 60)).toBe(true);
  });

  it('ends with frames/frames even when the CLI never printed the last line', async () => {
    const { renderer, to } = setup({ render: renderBody(['Streaming frame 1/60']) });
    const seen: number[] = [];
    await renderer.render(composition(), to, (p) => seen.push(p.frame));
    expect(seen).toEqual([1, 60]);
  });

  it('a progress callback that throws does not break the render', async () => {
    const { renderer, to } = setup();
    await expect(renderer.render(composition(), to, () => { throw new Error('page gone'); })).resolves.toBeDefined();
    expect(existsSync(to)).toBe(true);
  });

  it('a non-zero exit is a RenderError with the last lines of the CLI; nothing is left behind', async () => {
    const body = `echo 'Streaming frame 3/60'; echo 'Chrome crashed: out of memory' >&2; echo 'line before' >&2; echo 'half' > "$(echo "$@" | sed 's/.*--output //')"; exit 4`;
    const { renderer, out, to } = setup({ render: body });
    const e = await renderer.render(composition(), to, noProgress).catch((x) => x);
    expect(e).toBeInstanceOf(RenderError);
    expect(e.message).toMatch(/exited 4/);
    expect(e.message).toContain('Chrome crashed: out of memory');
    expect(leftovers(out)).toEqual([]);
  });

  it('exit 0 without an output file is a RenderError', async () => {
    const { renderer, out, to } = setup({ render: 'exit 0' });
    await expect(renderer.render(composition(), to, noProgress)).rejects.toThrow(/wrote no file/);
    expect(leftovers(out)).toEqual([]);
  });

  it('a CLI that cannot start, or hangs, is a RenderError and leaves nothing', async () => {
    const out = mkdtempSync(join(tmpdir(), 've-renderer-out-'));
    const r = createRenderer({ bin: '/no/such/hyperframes', ffmpeg: 'f', ffprobe: 'p', measure: fakeMeasure().measure });
    await expect(r.render(composition(), join(out, 'a.mp4'), noProgress)).rejects.toThrow(/cannot start/);
    const hung = setup({ render: 'sleep 20' }, { timeoutMs: 300 });
    await expect(hung.renderer.render(composition(), hung.to, noProgress)).rejects.toThrow(/did not finish/);
    expect(leftovers(out)).toEqual([]);
    expect(leftovers(hung.out)).toEqual([]);
  });

  it('removes an older file at `to` before the CLI starts: after a failure there is no file at `to`', async () => {
    const { renderer, out, to } = setup({ render: 'exit 1' });
    writeFileSync(to, 'earlier result');
    await expect(renderer.render(composition(), to, noProgress)).rejects.toBeInstanceOf(RenderError);
    expect(leftovers(out)).toEqual([]);
  });

  it('leaves an older file alone when timeline.json cannot be read (nothing started)', async () => {
    const { renderer, to } = setup();
    writeFileSync(to, 'earlier result');
    await expect(renderer.render(mkdtempSync(join(tmpdir(), 've-renderer-empty-')), to, noProgress)).rejects.toThrow(/timeline\.json/);
    expect(readFileSync(to, 'utf8')).toBe('earlier result');
  });

  it('sweeps temp files of a dead writer, keeps those of a live pid and files that are not temp files', async () => {
    const { renderer, out, to } = setup();
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
    const deadPid = Number(dead.stdout);
    writeFileSync(join(out, `.final.mp4.${deadPid}-deadbeef.render.mp4`), 'half');
    writeFileSync(join(out, `.final.mp4.${deadPid}-deadbeef.sound.mp4`), 'half');
    writeFileSync(join(out, `.final.mp4.${process.pid}-cafebabe.render.mp4`), 'another render of this process, still running');
    writeFileSync(join(out, `.final.mp4x.${deadPid}-deadbeef.render.mp4`), 'a sibling target');
    writeFileSync(join(out, '.final.mp4.deadbeef.render.mp4'), 'no pid in the name, fresh: kept');
    writeFileSync(join(out, 'other.mp4'), 'not ours');
    await renderer.render(composition(), to, noProgress);
    expect(leftovers(out).sort()).toEqual([`.final.mp4.${process.pid}-cafebabe.render.mp4`, '.final.mp4.deadbeef.render.mp4', `.final.mp4x.${deadPid}-deadbeef.render.mp4`, 'final.mp4', 'other.mp4'].sort());
  });

  it('sweeps a temp file without a pid only when it is over an hour old', async () => {
    const { renderer, out, to } = setup();
    const old = join(out, '.final.mp4.deadbeef.sound.mp4');
    writeFileSync(old, 'old');
    const past = new Date(Date.now() - 2 * 3600_000);
    utimesSync(old, past, past);
    await renderer.render(composition(), to, noProgress);
    expect(leftovers(out)).toEqual(['final.mp4']);
  });

  it('kills what the CLI left running (a grandchild holding the pipes), after a failing exit too', async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 've-renderer-pid-')), 'pid');
    const { renderer, to } = setup({ render: `sleep 30 & echo $! > '${pidFile}'; echo 'Chrome crashed' >&2; exit 2` });
    const e = await renderer.render(composition(), to, noProgress).catch((x) => x);
    expect(e.message).toMatch(/Chrome crashed/);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    let alive = true;
    for (let i = 0; i < 40 && alive; i++) { try { process.kill(pid, 0); await new Promise((r) => setTimeout(r, 50)); } catch { alive = false; } }
    expect(alive).toBe(false);
  });

  it('a frame line split between stdout chunks survives stderr output in between', async () => {
    const body = `while [ $# -gt 0 ]; do [ "$1" = "--output" ] && o="$2"; shift; done
printf 'Streaming fr'; sleep 0.3; echo 'noise 9/9 frame' >&2; sleep 0.3; printf 'ame 5/60\r'; sleep 0.3
echo x > "$o"`;
    const { renderer, to } = setup({ render: body });
    const seen: number[] = [];
    await renderer.render(composition(), to, (p) => seen.push(p.frame));
    expect(seen).toEqual([5, 60]);
  });

  it('passes the quality option', async () => {
    const { s, renderer, to } = setup({}, { quality: 'draft' });
    await renderer.render(composition(), to, noProgress);
    expect(s.call('render').args.slice(4, 6)).toEqual(['--quality', 'draft']);
  });
});

describe('worker count', () => {
  const animated = (t: ReturnType<typeof fixtureTimeline>) => { t.animations = [{ element: 't-hook', property: 'opacity', at: 0, for: 10, from: 0, to: 1, ease: 'linear', hold: 'after' }]; };
  const workersOf = async (edit: (t: ReturnType<typeof fixtureTimeline>) => void, extra: { cpus?: number; workers?: number }) => {
    const { s, renderer, to } = setup({}, extra);
    await renderer.render(composition(edit), to, noProgress);
    return s.call('render').args[7];
  };
  it('is 1 for a static timeline and 4 for an animated one', async () => {
    expect(await workersOf(() => {}, { cpus: 10 })).toBe('1');
    expect(await workersOf(animated, { cpus: 10 })).toBe('4');
  });
  it('never exceeds max(1, cpus - 2), also for a worker count that was asked for', async () => {
    expect(await workersOf(animated, { cpus: 4 })).toBe('2');
    expect(await workersOf(animated, { cpus: 2 })).toBe('1');
    expect(await workersOf(animated, { cpus: 1 })).toBe('1');
    expect(await workersOf(() => {}, { cpus: 10, workers: 8 })).toBe('8');
    expect(await workersOf(() => {}, { cpus: 6, workers: 8 })).toBe('4');
  });
  it('the rule as a function', () => {
    expect(workerCount({ animated: false }, undefined, 10)).toBe(1);
    expect(workerCount({ animated: true }, undefined, 10)).toBe(4);
    expect(workerCount({ animated: true }, undefined, 5)).toBe(3);
    expect(workerCount({ animated: true }, 0, 10)).toBe(1);
  });
});

describe('verification of the rendered file', () => {
  const wrong = (patch: Partial<StreamFacts>) => fakeMeasure({ facts: () => ({ ...FACTS, ...patch }) });
  it.each([
    ['frame count', { frames: 59 }, /frames: 59, the timeline says 60/],
    ['width', { width: 1080 }, /width: 1080, the timeline says 720/],
    ['height', { height: 1920 }, /height: 1920, the timeline says 1280/],
    ['rate', { fps: 25 }, /rate: 25, the timeline says 30/],
    ['sound', { audio: false }, /no sound stream/],
  ])('a different %s is a RenderError saying what differed; nothing is left', async (_name, patch, message) => {
    const m = wrong(patch);
    const { renderer, out, to } = setup({}, { measure: m.measure });
    const e = await renderer.render(composition(), to, noProgress).catch((x) => x);
    expect(e).toBeInstanceOf(RenderError);
    expect(e.message).toMatch(message);
    expect(leftovers(out)).toEqual([]);
  });
  it('lists every difference at once', async () => {
    const { renderer, to } = setup({}, { measure: wrong({ frames: 59, width: 100 }).measure });
    const e = await renderer.render(composition(), to, noProgress).catch((x) => x);
    expect(e.message).toMatch(/frames: 59/);
    expect(e.message).toMatch(/width: 100/);
  });
  it('wants no sound stream when the timeline has no audio', async () => {
    const { renderer, to } = setup({}, { measure: wrong({ audio: false, sound: null }).measure });
    const facts = await renderer.render(composition((t) => { t.audio = []; }), to, noProgress);
    expect(facts.audio).toBe(false);
  });
  it('an unreadable result is a RenderError', async () => {
    const measure = fakeMeasure().measure;
    measure.streams = async () => { throw new Error('not a readable media file'); };
    const { renderer, out, to } = setup({}, { measure });
    await expect(renderer.render(composition(), to, noProgress)).rejects.toThrow(/not a readable media file/);
    expect(leftovers(out)).toEqual([]);
  });
});

describe('loudness gain rule', () => {
  const L = (integrated: number, truePeak: number): Loudness => ({ integrated, truePeak, range: 6 });
  it.each([
    ['quiet file, room under the peak', L(-20, -8), MASTER, 6],
    ['peak-limited: the gain would push the peak over the ceiling, 0.5 dB kept', L(-20, -3), MASTER, 1.5],
    ['loud file is turned down', L(-10, -0.5), MASTER, -4],
    ['already on target', L(-14, -3), MASTER, 0],
    ['peak already over the ceiling: turned down to it, 0.5 dB kept', L(-14, 0.5), MASTER, -2],
    ['a target needing +30 dB is capped at +20', L(-44, -40), MASTER, 20],
    ['just above the floor is still lifted (capped)', L(-49, -45), MASTER, 20],
    ['another target', L(-23, -10), { lufs: -16, peak: -2 }, 7],
  ])('%s', (_name, loudness, master, gain) => {
    expect(loudnessGain(loudness, master)).toBeCloseTo(gain, 9);
  });
  it('is null for silence and near-silence (never amplified by 50 dB)', () => {
    expect(loudnessGain(L(-Infinity, -Infinity), MASTER)).toBeNull();
    expect(loudnessGain(L(-70, -60), MASTER)).toBeNull();
    expect(loudnessGain(L(-50.5, -40), MASTER)).toBeNull();
    expect(loudnessGain(L(NaN, -3), MASTER)).toBeNull();
  });
  it('the threshold', () => { expect(LOUDNESS_MIN_GAIN).toBe(0.1); });
});

describe('master pass rule (the limiter)', () => {
  const L = (integrated: number, truePeak: number): Loudness => ({ integrated, truePeak, range: 6 });
  it.each([
    ['the gain fits under the ceiling: no limiter', L(-20, -8), { gain: 6, limit: null }],
    ['loud file is turned down: no limiter', L(-10, -0.5), { gain: -4, limit: null }],
    ['the peak leaves the mix 3.5 dB short: the missing gain goes through the limiter, held LIMIT_HEADROOM under the gain ceiling', L(-24, -8), { gain: 10, limit: -2.5 }],
    ['exactly 1 dB short: not more than 1, no limiter', L(-20, -6.5), { gain: 5, limit: null }],
    ['just over 1 dB short', L(-20, -5.4), { gain: 3.9 + 2.1, limit: -2.5 }],
    ['7.5 dB short: within the bound', L(-30, -10), { gain: 16, limit: -2.5 }],
    ['exactly 8 dB short: still within the bound', L(-30, -9.5), { gain: 16, limit: -2.5 }],
    ['9.5 dB short: more than 8 dB stays as it was, gain only', L(-32, -10), { gain: 8.5, limit: null }],
    ['the +20 dB cap still holds', L(-44, -40), { gain: 20, limit: null }],
  ])('%s', (_name, loudness, want) => {
    const pass = masterPass(loudness, MASTER)!;
    expect(pass.gain).toBeCloseTo(want.gain, 9);
    expect(pass.limit).toBe(want.limit);
  });
  it('is null where the gain rule is', () => { expect(masterPass(L(-70, -60), MASTER)).toBeNull(); });
  it('an unlimited pass keeps today\'s gain exactly', () => {
    for (const l of [L(-20, -8), L(-10, -0.5), L(-23, -10), L(-32, -10)]) expect(masterPass(l, MASTER)!.gain).toBe(loudnessGain(l, MASTER));
  });
});

describe('loudness pass', () => {
  function withMeasure(loudness: Loudness | null, facts?: (file: string, call: number) => StreamFacts) {
    const m = fakeMeasure({ loudness, facts });
    const f = ffmpegStub();
    const r = setup({}, { measure: m.measure, ffmpeg: f.bin });
    return { ...r, m, f };
  }
  it('applies the gain with ffmpeg: video copied, sound re-encoded as AAC 48 kHz, into a second temp file', async () => {
    const { s, renderer, out, to, m, f } = withMeasure({ integrated: -20, truePeak: -8, range: 4 });
    const facts = await renderer.render(composition(undefined, MASTER), to, noProgress);
    const temp = s.call('render').args[9]!;
    const runs = f.runs();
    expect(runs).toHaveLength(1);
    const a = runs[0]!;
    expect(a.slice(0, 6)).toEqual(['-y', '-v', 'error', '-nostdin', '-i', temp]);
    expect(a.slice(6, 12)).toEqual(['-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy']);
    expect(a).toContain('volume=6dB');
    expect(a.slice(a.indexOf('-c:a'), a.indexOf('-c:a') + 4)).toEqual(['-c:a', 'aac', '-ar', '48000']);
    const second = a.at(-1)!;
    expect(second).not.toBe(temp);
    expect(second.endsWith('.mp4')).toBe(true);
    expect(resolve(second, '..')).toBe(out);
    expect(m.seen.loudness).toEqual([temp]);
    expect(m.seen.streams).toEqual([temp, second]);                                    // the frame count is checked again on the result
    expect(leftovers(out)).toEqual(['final.mp4']);
    expect(facts.frames).toBe(60);
  });
  it('lowers the gain when the true peak would pass the ceiling and more than 8 dB are missing: no limiter', async () => {
    const { renderer, to, f } = withMeasure({ integrated: -32, truePeak: -10, range: 4 });
    await renderer.render(composition(undefined, MASTER), to, noProgress);
    expect(f.runs()[0]).toContain('volume=8.5dB');
  });
  it('turns a loud file down', async () => {
    const { renderer, to, f } = withMeasure({ integrated: -10, truePeak: -5, range: 4 });
    await renderer.render(composition(undefined, MASTER), to, noProgress);
    expect(f.runs()[0]).toContain('volume=-4dB');
  });
  it('does nothing below 0.1 dB, when master is null, when there is no sound, or when the sound cannot be measured', async () => {
    const near = withMeasure({ integrated: -14.05, truePeak: -3, range: 4 });
    await near.renderer.render(composition(undefined, MASTER), near.to, noProgress);
    expect(near.f.runs()).toEqual([]);
    expect(near.m.seen.loudness).toHaveLength(1);

    const noMaster = withMeasure({ integrated: -30, truePeak: -8, range: 4 });
    await noMaster.renderer.render(composition(undefined, null), noMaster.to, noProgress);
    expect(noMaster.f.runs()).toEqual([]);
    expect(noMaster.m.seen.loudness).toEqual([]);

    const silent = withMeasure({ integrated: -30, truePeak: -8, range: 4 }, () => ({ ...FACTS, audio: false, sound: null }));
    await silent.renderer.render(composition((t) => { t.audio = []; }, MASTER), silent.to, noProgress);
    expect(silent.f.runs()).toEqual([]);
    expect(silent.m.seen.loudness).toEqual([]);

    const unmeasurable = withMeasure(null);
    await unmeasurable.renderer.render(composition(undefined, MASTER), unmeasurable.to, noProgress);
    expect(unmeasurable.f.runs()).toEqual([]);
  });
  it('a changed frame count after the gain is a RenderError; nothing is left', async () => {
    const { renderer, out, to } = withMeasure({ integrated: -20, truePeak: -8, range: 4 }, (_file, call) => ({ ...FACTS, frames: call === 1 ? 60 : 58 }));
    await expect(renderer.render(composition(undefined, MASTER), to, noProgress)).rejects.toThrow(/frames: 58/);
    expect(leftovers(out)).toEqual([]);
  });
  it('a changed length after the gain is a RenderError; nothing is left', async () => {
    const { renderer, out, to } = withMeasure({ integrated: -20, truePeak: -8, range: 4 }, (_file, call) => ({ ...FACTS, seconds: call === 1 ? 2 : 2.2 }));
    await expect(renderer.render(composition(undefined, MASTER), to, noProgress)).rejects.toThrow(/length/);
    expect(leftovers(out)).toEqual([]);
    const ok = withMeasure({ integrated: -20, truePeak: -8, range: 4 }, (_file, call) => ({ ...FACTS, seconds: call === 1 ? 2 : 2.04 }));
    await expect(ok.renderer.render(composition(undefined, MASTER), ok.to, noProgress)).resolves.toBeDefined();
  });
  it('near-silence is not amplified and a +30 dB wish is capped at +20', async () => {
    const quiet = withMeasure({ integrated: -70, truePeak: -60, range: 1 });
    await quiet.renderer.render(composition(undefined, MASTER), quiet.to, noProgress);
    expect(quiet.f.runs()).toEqual([]);
    const low = withMeasure({ integrated: -44, truePeak: -40, range: 1 });
    await low.renderer.render(composition(undefined, MASTER), low.to, noProgress);
    expect(low.f.runs()[0]).toContain('volume=20dB');
  });
  it('a mix the peak holds under the target gets volume and the limiter in the same pass', async () => {
    const { renderer, to, f } = withMeasure({ integrated: -24, truePeak: -8, range: 4 });
    await renderer.render(composition(undefined, MASTER), to, noProgress);
    const a = f.runs()[0]!;
    expect(a[a.indexOf('-af') + 1]).toBe('volume=10dB,aresample=192000,alimiter=limit=0.7499:level=0,aresample=48000');
  });
  it('a failing ffmpeg is a RenderError with its message; nothing is left', async () => {
    const m = fakeMeasure({ loudness: { integrated: -20, truePeak: -8, range: 4 } });
    const f = ffmpegStub(1);
    const { renderer, out, to } = setup({}, { measure: m.measure, ffmpeg: f.bin });
    const e = await renderer.render(composition(undefined, MASTER), to, noProgress).catch((x) => x);
    expect(e).toBeInstanceOf(RenderError);
    expect(e.message).toMatch(/ffmpeg broke/);
    expect(leftovers(out)).toEqual([]);
  });
});

/** Stub ffmpeg and ffprobe for the hardware path. ffmpeg logs every call; the encoder probe (lavfi input) exits `probe`; any other call copies its input to its last argument. ffprobe prints `facts` as the container's numbers. */
function hardwareTools(options: { probe?: number; facts?: Partial<StreamFacts> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 've-renderer-hw-'));
  const log = join(dir, 'args.txt');
  const ffmpeg = join(dir, 'ffmpeg');
  writeFileSync(ffmpeg, `#!/bin/sh
for a in "$@"; do printf '%s\\n' "$a"; done >> "${log}"
echo "--" >> "${log}"
case "$*" in *lavfi*) [ ${options.probe ?? 0} -ne 0 ] && echo "Error while opening encoder" >&2; exit ${options.probe ?? 0} ;; esac
while [ $# -gt 0 ]; do [ "$1" = "-i" ] && i="$2"; last="$1"; shift; done
cp "$i" "$last"
`);
  const f = { ...FACTS, ...options.facts };
  const streams = [{ codec_type: 'video', width: f.width, height: f.height, r_frame_rate: `${f.fps}/1`, nb_frames: String(f.frames) }, ...(f.audio ? [{ codec_type: 'audio' }] : [])];
  const ffprobe = join(dir, 'ffprobe');
  writeFileSync(join(dir, 'facts.json'), JSON.stringify({ streams, format: { duration: String(f.seconds) } }));
  writeFileSync(ffprobe, `#!/bin/sh\nfor a in "$@"; do last="$a"; done\nprintf '%s\\n' "$last" >> "${join(dir, 'probed.txt')}"\ncat "${join(dir, 'facts.json')}"\n`);
  chmodSync(ffmpeg, 0o755);
  chmodSync(ffprobe, 0o755);
  const runs = () => (existsSync(log) ? readFileSync(log, 'utf8').split('--\n').filter((s) => s !== '').map((s) => s.trim().split('\n')) : []);
  return {
    ffmpeg, ffprobe, runs, probes: () => runs().filter((a) => a.includes('lavfi')), passes: () => runs().filter((a) => !a.includes('lavfi')),
    probed: () => (existsSync(join(dir, 'probed.txt')) ? readFileSync(join(dir, 'probed.txt'), 'utf8').trim().split('\n') : []),
  };
}

describe('hardware path', () => {
  const QUIET: Loudness = { integrated: -20, truePeak: -8, range: 4 };
  function hardware(options: { probe?: number; facts?: Partial<StreamFacts>; loudness?: Loudness | null; quality?: 'draft' | 'looks'; render?: string } = {}) {
    const m = fakeMeasure({ loudness: options.loudness === undefined ? QUIET : options.loudness });
    const tools = hardwareTools(options);
    const s = stub(options.render === undefined ? {} : { render: options.render });
    const renderer = createRenderer({ bin: s.bin, ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe, measure: m.measure, cpus: 10, quality: options.quality, encode: 'hardware' });
    const out = mkdtempSync(join(tmpdir(), 've-renderer-out-'));
    return { s, m, tools, renderer, out, to: join(out, 'final.mp4') };
  }
  /** A CLI that fails when it is asked for its hardware encoder and renders without it. */
  const GPU_FAILS = `case "$*" in *--gpu*) echo "VideoToolbox session could not be created" >&2; exit 1 ;; esac\n${renderBody(['Streaming frame 60/60'])}`;

  it('a mix the peak holds under the target gets the same sound filter as on the CLI path (volume, then the limiter)', async () => {
    const { renderer, to, tools } = hardware({ loudness: { integrated: -24, truePeak: -8, range: 4 } });
    await renderer.render(composition(undefined, MASTER), to, noProgress);
    const pass = tools.passes().at(-1)!;
    expect(pass[pass.indexOf('-af') + 1]).toBe('volume=10dB,aresample=192000,alimiter=limit=0.7499:level=0,aresample=48000');   // as in 'loudness pass' above
  });

  it('the CLI encodes with its hardware encoder at the delivery bitrate; one pass of ours copies the picture, tags it and applies the gain; nothing decodes the picture', async () => {
    const { s, renderer, out, to, m, tools } = hardware();
    const facts = await renderer.render(composition(undefined, MASTER), to, noProgress);
    const c = s.call('render');
    expect(c.args.slice(0, 9)).toEqual(['render', expect.any(String), '--fps', '30', '--quality', 'looks', '--workers', '1', '--output']);
    expect(c.args.slice(10)).toEqual(['--gpu', '--video-bitrate', `${megabits({ width: 720, height: 1280, fps: 30 }, DELIVERY_BPP)}M`]);
    const temp = c.args[9]!;
    expect(tools.probes()).toHaveLength(1);
    expect(tools.passes()).toHaveLength(2);
    const [sound, pass] = tools.passes();
    expect(sound!.slice(4, 6)).toEqual(['-i', temp]);
    expect(sound).toContain('-vn');
    expect(m.seen.loudness).toEqual([sound!.at(-1)]);                                  // the sound alone, never the file with the picture
    expect(pass!.slice(4, 6)).toEqual(['-i', temp]);
    expect(pass!.slice(pass!.indexOf('-c:v'), pass!.indexOf('-c:v') + 3)).toEqual(['-c:v', 'copy', '-bsf:v']);
    expect(pass).toContain('volume=6dB');
    const written = pass!.at(-1)!;
    expect(resolve(written, '..')).toBe(out);
    expect(m.seen.streams).toEqual([]);                                                // no decoding count
    expect(tools.probed()).toEqual([written]);                                         // the container's numbers of the file that is delivered
    expect(leftovers(out)).toEqual(['final.mp4']);
    expect(facts).toMatchObject({ width: 720, height: 1280, fps: 30, frames: 60, seconds: 2, audio: true, encode: 'hardware', note: null });
    expect(facts.stages.map((stage) => stage.stage)).toEqual(['cli', 'loudness', 'pass', 'verify']);
  });

  it('the CLI child of the hardware path encodes while it captures; the one of the cli path is started as before', async () => {
    const SWITCH = `echo "stream:\${HF_CAPTURE_PARALLEL_STREAM-unset}" > "$0.stream"\n${renderBody(['Streaming frame 60/60'])}`;
    const hw = hardware({ render: SWITCH });
    await hw.renderer.render(composition(), hw.to, noProgress);
    expect(readFileSync(`${hw.s.bin}.stream`, 'utf8').trim()).toBe('stream:true');
    expect(hw.s.call('render').env).toBe('env:111');
    const plain = setup({ render: SWITCH });
    await plain.renderer.render(composition(), plain.to, noProgress);
    expect(readFileSync(`${plain.s.bin}.stream`, 'utf8').trim()).toBe('stream:unset');
  });

  it('without a master, or with a gain under 0.1 dB, the pass still runs (the tags) and copies the sound', async () => {
    const plain = hardware();
    await plain.renderer.render(composition(undefined, null), plain.to, noProgress);
    expect(plain.m.seen.loudness).toEqual([]);
    expect(plain.tools.passes()).toHaveLength(1);
    const a = plain.tools.passes()[0]!;
    expect(a.slice(a.indexOf('-c:a'), a.indexOf('-c:a') + 2)).toEqual(['-c:a', 'copy']);
    expect(a.some((x) => x.startsWith('volume='))).toBe(false);

    const near = hardware({ loudness: { integrated: -14.05, truePeak: -3, range: 4 } });
    await near.renderer.render(composition(undefined, MASTER), near.to, noProgress);
    expect(near.tools.passes().at(-1)!.some((x) => x.startsWith('volume='))).toBe(false);
  });

  it('a missing hardware encoder is found once; the render takes the cli path and its note says why', async () => {
    const { s, renderer, to, tools } = hardware({ probe: 1 });
    const facts = await renderer.render(composition(), to, noProgress);
    expect(s.call('render').args).toHaveLength(10);                                    // no --gpu
    expect(facts.encode).toBe('cli');
    expect(facts.note).toMatch(/software path/);
    expect(facts.note).toMatch(/h264_videotoolbox does not work/);
    await renderer.render(composition(), to, noProgress);
    expect(tools.probes()).toHaveLength(1);
  });

  it('a CLI that fails with its hardware encoder: the same render is done again on the cli path, and the renders after it start there', async () => {
    const { s, renderer, out, to } = hardware({ render: GPU_FAILS });
    const renders = () => s.all().filter((lines) => lines[0] === 'render');
    const facts = await renderer.render(composition(), to, noProgress);
    expect(renders()).toHaveLength(2);
    expect(s.call('render', 0).args).toContain('--gpu');
    expect(s.call('render', 1).args).not.toContain('--gpu');
    expect(facts).toMatchObject({ frames: 60, encode: 'cli' });
    expect(facts.note).toMatch(/software path.*the CLI failed with its hardware encoder \(hyperframes render exited 1/);
    expect(facts.note).not.toMatch(/\n/);
    expect(leftovers(out)).toEqual(['final.mp4']);
    const again = await renderer.render(composition(), to, noProgress);
    expect(renders()).toHaveLength(3);
    expect(s.call('render', 2).args).not.toContain('--gpu');
    expect(again.note).toMatch(/software path/);
  });

  it('a composition the CLI cannot render on either path is a RenderError with the CLI\'s words; the hardware path is tried again next time', async () => {
    const { s, renderer, out, to } = hardware({ render: renderBody(['boom: composition broken'], 3) });
    const e = await renderer.render(composition(), to, noProgress).catch((x) => x);
    expect(e).toBeInstanceOf(RenderError);
    expect(e.message).toMatch(/exited 3/);
    expect(leftovers(out)).toEqual([]);
    await renderer.render(composition(), to, noProgress).catch(() => {});
    expect(s.call('render', 2).args).toContain('--gpu');
  });

  it('a CLI that does not finish is a RenderError at once: no second render', async () => {
    const m = fakeMeasure();
    const tools = hardwareTools();
    const s = stub({ render: 'sleep 5' });
    const out = mkdtempSync(join(tmpdir(), 've-renderer-out-'));
    const renderer = createRenderer({ bin: s.bin, ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe, measure: m.measure, cpus: 10, encode: 'hardware', timeoutMs: 2000 });   // long enough for the stub shell to record its call first, also under load
    await expect(renderer.render(composition(), join(out, 'final.mp4'), noProgress)).rejects.toThrow(/did not finish/);
    expect(s.all().filter((lines) => lines[0] === 'render').length, `render calls recorded: ${JSON.stringify(s.all().map((l) => l[0]))}`).toBe(1);
    expect(leftovers(out)).toEqual([]);
  });

  it('quality draft always takes the cli path', async () => {
    const { s, renderer, to, tools } = hardware({ quality: 'draft' });
    const facts = await renderer.render(composition(), to, noProgress);
    expect(s.call('render').args).toHaveLength(10);
    expect(tools.runs()).toEqual([]);
    expect(facts).toMatchObject({ encode: 'cli', note: null });
  });

  it('the delivered file is checked against the timeline; a wrong one is a RenderError and leaves nothing', async () => {
    const short = hardware({ facts: { frames: 59 } });
    await expect(short.renderer.render(composition(), short.to, noProgress)).rejects.toThrow(/frames: 59, the timeline says 60/);
    expect(leftovers(short.out)).toEqual([]);
    const long = hardware({ facts: { seconds: 2.2 } });
    await expect(long.renderer.render(composition(), long.to, noProgress)).rejects.toThrow(/length/);
    expect(leftovers(long.out)).toEqual([]);
    const silent = hardware({ facts: { audio: false } });
    await expect(silent.renderer.render(composition(), silent.to, noProgress)).rejects.toThrow(/no sound stream/);
  });

  it('reports frames/frames only when the file is in place', async () => {
    const { renderer, to } = hardware();
    const seen: { frame: number; at: boolean }[] = [];
    await renderer.render(composition(), to, (p) => seen.push({ frame: p.frame, at: existsSync(to) }));
    expect(seen.at(-1)).toEqual({ frame: 60, at: true });
    expect(seen.filter((p) => p.frame === 60)).toHaveLength(1);
  });

  it('ready: says when renders will take the software path, and stays ready', async () => {
    const missing = hardwareTools({ probe: 1 });
    writeFileSync(missing.ffmpeg, '#!/bin/sh\ncase "$*" in *lavfi*) echo "no encoder" >&2; exit 1 ;; esac\necho "tool 1.0"\n');
    const a = await createRenderer({ bin: stub({}).bin, ffmpeg: missing.ffmpeg, ffprobe: missing.ffprobe, measure: fakeMeasure().measure, encode: 'hardware' }).ready();
    expect(a.ready).toBe(true);
    expect(a.note).toMatch(/software path.*no encoder/s);
    const there = hardwareTools();
    writeFileSync(there.ffmpeg, '#!/bin/sh\necho "tool 1.0"\n');
    expect(await createRenderer({ bin: stub({}).bin, ffmpeg: there.ffmpeg, ffprobe: there.ffprobe, measure: fakeMeasure().measure, encode: 'hardware' }).ready()).toEqual({ ready: true, note: null });
  });

  it('the default path', () => {
    expect(DEFAULT_ENCODE).toBe('cli');
  });
});

describe('cliStages', () => {
  it('reads the closing line of the real CLI output', () => {
    expect(cliStages(fixture('hf-render-stdout.txt'))).toEqual([
      { stage: 'compile', seconds: 0.2 }, { stage: 'extract', seconds: 0.3 }, { stage: 'audio', seconds: 0.2 }, { stage: 'probe', seconds: 0.1 },
      { stage: 'setup', seconds: 0.3 }, { stage: 'capture', seconds: 2.3 }, { stage: 'encode (during capture)', seconds: 2.3 }, { stage: 'assemble', seconds: 0.3 },
    ]);
  });
  it('reads minutes', () => {
    const stages = cliStages('   screenshot capture · hardware gpu · compile 2.1s · capture 59.7s · encode 1m 21.8s · assemble 1.5s\n');
    expect(stages).toEqual([{ stage: 'compile', seconds: 2.1 }, { stage: 'capture', seconds: 59.7 }, { stage: 'encode', seconds: 81.8 }, { stage: 'assemble', seconds: 1.5 }]);
  });
  it('is empty when the CLI printed no such line', () => {
    expect(cliStages('Streaming frame 60/60\nrendered')).toEqual([]);
  });
  it('the stages of a render carry them as cli.<name>, inside cli', async () => {
    const line = 'screenshot capture · hardware gpu · compile 0.2s · capture 2.3s · encode 1.1s · assemble 0.3s';
    const { renderer, to } = setup({ render: `${renderBody(['Streaming frame 60/60']).replace(/exit 0$/, '')}echo '   ${line}'\nexit 0` });
    const facts = await renderer.render(composition(), to, noProgress);
    expect(facts.stages.map((stage) => stage.stage)).toEqual(['cli', 'cli.compile', 'cli.capture', 'cli.encode', 'cli.assemble', 'probe']);
  });
});

describe('progressReader', () => {
  it('finds a frame line split between two chunks, and strips escape codes', () => {
    const seen: number[] = [];
    const read = progressReader(60, (p) => seen.push(p.frame));
    read('\u001b[2K  ██░  26%  Streaming fr');
    read('ame 1');
    read('6/60\r  ██  40%  Streaming frame 31/60\r');
    expect(seen).toEqual([16, 31]);
  });
  it('reads the real CLI output', () => {
    const seen: number[] = [];
    progressReader(60, (p) => seen.push(p.frame))(fixture('hf-render-stdout.txt'));
    expect(seen).toEqual([1, 16, 31, 43, 54, 60]);
  });
  it('never reports past the timeline length', () => {
    const seen: number[] = [];
    progressReader(60, (p) => seen.push(p.frame))('Streaming frame 75/75');
    expect(seen).toEqual([60]);
  });
});

describe('ready', () => {
  it('is ready when the CLI, its Chrome, ffmpeg and ffprobe answer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 've-renderer-tools-'));
    const tool = join(dir, 'tool');
    writeFileSync(tool, '#!/bin/sh\necho "tool 1.0"\n');
    chmodSync(tool, 0o755);
    const s = stub({});
    const r = createRenderer({ bin: s.bin, ffmpeg: tool, ffprobe: tool, measure: fakeMeasure().measure });
    expect(await r.ready()).toEqual({ ready: true, note: null });
    expect(s.call('doctor').args).toEqual(['doctor', '--json']);
    expect(s.call('doctor').env).toBe('env:111');
  });
  it('says what is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 've-renderer-tools-'));
    const tool = join(dir, 'tool');
    writeFileSync(tool, '#!/bin/sh\necho "tool 1.0"\n');
    chmodSync(tool, 0o755);
    const noChrome = stub({ doctor: `echo '{"ok":false,"checks":[{"name":"Chrome","ok":false,"detail":"Not found","hint":"npx hyperframes browser ensure"}]}'` });
    const a = await createRenderer({ bin: noChrome.bin, ffmpeg: tool, ffprobe: tool, measure: fakeMeasure().measure }).ready();
    expect(a.ready).toBe(false);
    expect(a.note).toMatch(/Chrome/);
    const noCli = await createRenderer({ bin: '/no/such/hyperframes', ffmpeg: tool, ffprobe: tool, measure: fakeMeasure().measure }).ready();
    expect(noCli.ready).toBe(false);
    expect(noCli.note).toMatch(/hyperframes/);
    const s = stub({});
    const noFf = await createRenderer({ bin: s.bin, ffmpeg: '/no/ffmpeg', ffprobe: '/no/ffprobe', measure: fakeMeasure().measure }).ready();
    expect(noFf.ready).toBe(false);
    expect(noFf.note).toMatch(/ffmpeg/);
    expect(noFf.note).toMatch(/ffprobe/);
    const other = stub({ version: 'echo 0.8.121' });
    const o = await createRenderer({ bin: other.bin, ffmpeg: tool, ffprobe: tool, measure: fakeMeasure().measure }).ready();
    expect(o.ready).toBe(false);
    expect(o.note).toMatch(/0\.8\.121/);
    expect(o.note).toMatch(/0\.8\.120/);
    const broken = stub({ version: 'exit 2' });
    expect((await createRenderer({ bin: broken.bin, ffmpeg: tool, ffprobe: tool, measure: fakeMeasure().measure }).ready()).ready).toBe(false);
    const garbled = stub({ doctor: 'echo not-json' });
    const g = await createRenderer({ bin: garbled.bin, ffmpeg: tool, ffprobe: tool, measure: fakeMeasure().measure }).ready();
    expect(g.ready).toBe(false);
    expect(g.note).toMatch(/doctor/);
  });
});

describe('opt-in picture verification', () => {
  function fingerprints(hashes: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 've-verify-'));
    const bin = join(dir, 'ffmpeg');
    writeFileSync(bin, `#!/bin/sh
counter='${join(dir, 'count')}'
n=0; [ -f "$counter" ] && n=$(cat "$counter")
n=$((n+1)); echo "$n" > "$counter"
case "$n" in
${hashes.map((h, i) => `${i + 1}) hash='${h.repeat(32)}' ;;`).join('\n')}
*) hash='${'d'.repeat(32)}' ;;
esac
frame=0
while [ "$frame" -lt 60 ]; do echo "0, $frame, $frame, 1, 42, $hash"; frame=$((frame+1)); done
`);
    chmodSync(bin, 0o755);
    return bin;
  }
  it('retries a mismatch once and publishes only after two consecutive identical pictures', async () => {
    const { renderer, s } = setup({}, { ffmpeg: fingerprints(['a', 'b', 'b']), verifyRepeat: true });
    const dir = composition();
    const result = await renderer.render(dir, join(dir, 'verified.mp4'), () => {});
    expect(s.all().filter(c => c[0] === 'render')).toHaveLength(3);
    expect(result.note).toContain('picture mismatch');
  });
  it('fails closed after two mismatches and publishes no video', async () => {
    const { renderer } = setup({}, { ffmpeg: fingerprints(['a', 'b', 'c']), verifyRepeat: true });
    const dir = composition(), out = join(dir, 'unstable.mp4');
    await expect(renderer.render(dir, out, () => {})).rejects.toThrow('render-picture-unstable');
    expect(existsSync(out)).toBe(false);
  });
  it('publishes the third render when it repeats the first one: two of three pictures agree', async () => {
    const { renderer, s } = setup({}, { ffmpeg: fingerprints(['a', 'b', 'a']), verifyRepeat: true });
    const dir = composition(), out = join(dir, 'majority.mp4');
    const result = await renderer.render(dir, out, () => {});
    expect(s.all().filter(c => c[0] === 'render')).toHaveLength(3);
    expect(existsSync(out)).toBe(true);
    expect(result.note).toContain('picture mismatch');
  });
  it('three renders at most: three different pictures fail closed even when a fourth render would repeat the third', async () => {
    const { renderer, s } = setup({}, { ffmpeg: fingerprints(['a', 'b', 'c', 'c']), verifyRepeat: true });
    const dir = composition(), out = join(dir, 'three.mp4');
    await expect(renderer.render(dir, out, () => {})).rejects.toThrow('render-picture-unstable');
    expect(s.all().filter(c => c[0] === 'render')).toHaveLength(3);
    expect(existsSync(out)).toBe(false);
  });
  it('a repeat render that exits 0 and writes no file fails the render: the file of the first render is not read again as the repeat', async () => {
    const once = join(mkdtempSync(join(tmpdir(), 've-verify-once-')), 'written');
    const render = `while [ $# -gt 0 ]; do [ "$1" = "--output" ] && o="$2"; shift; done
[ -f '${once}' ] && exit 0
touch '${once}'; echo "rendered" > "$o"`;
    const { renderer, s } = setup({ render }, { ffmpeg: fingerprints(['a', 'a']), verifyRepeat: true });
    const dir = composition(), out = join(dir, 'stale.mp4');
    await expect(renderer.render(dir, out, () => {})).rejects.toThrow('wrote no file');
    expect(s.all().filter(c => c[0] === 'render')).toHaveLength(2);
    expect(existsSync(out)).toBe(false);
  });
  it('a mismatch that the third render settles leaves one line in the error log, with the file and the render it repeats; two renders that agree leave none', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const lines = () => errors.mock.calls.map(c => String(c[0])).filter(line => line.startsWith('render-picture-mismatch'));
      const dir = composition();
      await setup({}, { ffmpeg: fingerprints(['a', 'a']), verifyRepeat: true }).renderer.render(dir, join(dir, 'same.mp4'), () => {});
      expect(lines()).toEqual([]);
      await setup({}, { ffmpeg: fingerprints(['a', 'b', 'b']), verifyRepeat: true }).renderer.render(dir, join(dir, 'second.mp4'), () => {});
      expect(lines()).toEqual([`render-picture-mismatch: ${join(dir, 'second.mp4')} render 3 repeats render 2, published`]);
      await setup({}, { ffmpeg: fingerprints(['a', 'b', 'a']), verifyRepeat: true }).renderer.render(dir, join(dir, 'first.mp4'), () => {});
      expect(lines().slice(1)).toEqual([`render-picture-mismatch: ${join(dir, 'first.mp4')} render 3 repeats render 1, published`]);
      await expect(setup({}, { ffmpeg: fingerprints(['a', 'b', 'c']), verifyRepeat: true }).renderer.render(dir, join(dir, 'none.mp4'), () => {})).rejects.toThrow('render-picture-unstable');
      expect(lines()).toHaveLength(2);   // the render that failed says so itself, as the reason of the stop
    } finally { errors.mockRestore(); }
  });
  it('one call asks for the repeat on a renderer that does not verify by itself: that call renders twice, the next one once', async () => {
    const { renderer, s } = setup({}, { ffmpeg: fingerprints(['a', 'a']) });
    const dir = composition();
    await renderer.render(dir, join(dir, 'paid.mp4'), () => {}, { verifyRepeat: true });
    expect(s.all().filter(c => c[0] === 'render')).toHaveLength(2);
    await renderer.render(dir, join(dir, 'preview.mp4'), () => {});
    expect(s.all().filter(c => c[0] === 'render')).toHaveLength(3);
  });
});
