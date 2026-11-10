import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { MediaError } from '../adapters/media.ts';
import { HYPERFRAMES_VERSION } from '../adapters/renderer.ts';
import { COMMANDS } from './commands.ts';
import { toolRunner } from './context.ts';
import { SMALL_ASSETS, STREAMS, ask, fakeContext, fixture, tempProject } from './testing.ts';

vi.setConfig({ testTimeout: 60_000 });      // the machine is shared: never a tight limit
const small = () => tempProject(fixture('small'), SMALL_ASSETS);
const names = (list: { code: string }[]) => list.map((i) => i.code).sort();
/** A fake `hyperframes snapshot`: one PNG per time in the folder after --output, named as the CLI names them. */
const snapshot = (args: string[]) => {
  const out = args[args.indexOf('--output') + 1]!;
  mkdirSync(out, { recursive: true });
  args[args.indexOf('--at') + 1]!.split(',').forEach((second, i) => writeFileSync(join(out, `frame-${String(i).padStart(2, '0')}-at-${second}s.png`), `png ${second}`));
  return { code: 0, stdout: '', stderr: '' };
};

/** Fake answers of the tools `doctor` asks. */
const chrome = (ok: boolean) => JSON.stringify({ ok, checks: [{ name: 'Version', ok: true, detail: '0.8.120' }, ok ? { name: 'Chrome', ok: true, detail: '/cache/chrome' } : { name: 'Chrome', ok: false, detail: 'Not found', hint: 'run: hyperframes browser ensure' }] });
const tools = (version: string, chromeOk: boolean, ffmpeg = 0) => ({
  hyperframes: (args: string[]) => ({ code: 0, stdout: args[0] === '--version' ? `${version}\n` : chrome(chromeOk), stderr: '' }),
  ffmpeg: () => ({ code: ffmpeg, stdout: 'ffmpeg version 8.0', stderr: '' }),
  ffprobe: () => ({ code: 0, stdout: 'ffprobe version 8.0', stderr: '' }),
});

describe('check', () => {
  it('passes the small document and says what it holds and what to look at next', async () => {
    const file = small();
    const { context, calls } = fakeContext();
    const ran = await ask(context, ['check', file]);
    expect(ran.exit).toBe(0);
    expect(ran.json).toMatchObject({ ok: true, command: 'check', issues: [], warnings: [] });
    expect(ran.json.result).toMatchObject({
      document: file, canvas: '720x1280', fps: 30, frames: 75, seconds: 2.5, deep: false, composition: null,
      elements: { shots: 2, texts: 1, cards: 1, captionGroups: 0, sounds: 1 },
      media: { clip: { file: 'assets/clip.mp4', kind: 'video', width: 720, height: 1280, frames: 90, sound: false }, tone: { kind: 'audio', seconds: 3 } },
    });
    expect(ran.json.result.stills.length).toBeGreaterThan(0);
    expect(ran.json.result.next).toContain(`viraleditor frames ${file} --at ${ran.json.result.stills.join(',')}`);
    expect(calls.some((c) => c.tool === 'renderer.check')).toBe(false);
  });

  it('reports three faults as three issues, each with its place and its fix', async () => {
    const edit = fixture('small');
    edit.shots[0].for = 40;                    // shots-gap: the second shot starts at 45
    edit.texts[0].style = 'hok';               // style-unknown
    edit.cards[0].media = 'prodct';            // media-unknown
    const ran = await ask(fakeContext().context, ['check', tempProject(edit, SMALL_ASSETS)]);
    expect(ran.exit).toBe(1);
    expect(ran.json.ok).toBe(false);
    expect(names(ran.json.issues)).toEqual(['media-unknown', 'shots-gap', 'style-unknown']);
    for (const found of ran.json.issues) {
      expect(found.path).toMatch(/^(shots|texts|cards)\[\d\]/);
      expect(found.message.length).toBeGreaterThan(10);
      expect(found.fix.length).toBeGreaterThan(10);
    }
  });

  it('reports a missing asset once, at its place in the document', async () => {
    const ran = await ask(fakeContext().context, ['check', tempProject(fixture('small'), SMALL_ASSETS.filter((name) => name !== 'clip.mp4'))]);
    expect(ran.exit).toBe(1);
    expect(ran.json.issues).toHaveLength(1);
    expect(ran.json.issues[0]).toMatchObject({ code: 'media-missing', path: 'media.clip' });
  });

  it('reports a clip that is too short once, not under two codes', async () => {
    const { context } = fakeContext({ streams: { ...STREAMS, 'clip.mp4': { ...STREAMS['clip.mp4']!, frames: 50 } } });
    const ran = await ask(context, ['check', small()]);
    expect(names(ran.json.issues)).toEqual(['clip-short']);
  });

  it('gives a video at the wrong rate the exact normalize command as its fix', async () => {
    const file = small();
    const { context } = fakeContext({ streams: { ...STREAMS, 'clip.mp4': { ...STREAMS['clip.mp4']!, fps: 25 } } });
    const ran = await ask(context, ['check', file]);
    const found = ran.json.issues.find((i: { code: string }) => i.code === 'media-fps');
    expect(found.path).toBe('media.clip');
    expect(found.fix).toContain(`viraleditor normalize ${join(dirname(file), 'assets/clip.mp4')} ${join(dirname(file), 'assets/clip-norm.mp4')} --canvas 720x1280`);
    expect(found.fix).toContain('"assets/clip-norm.mp4"');
  });

  it('--deep writes the composition and runs the check of the renderer on it', async () => {
    const file = small();
    const { context, calls } = fakeContext();
    const ran = await ask(context, ['check', file, '--deep']);
    const composition = join(dirname(file), '.viraleditor', 'composition');
    expect(ran.exit).toBe(0);
    expect(ran.json.result).toMatchObject({ deep: true, composition });
    expect(existsSync(join(composition, 'index.html'))).toBe(true);
    expect(JSON.parse(readFileSync(join(composition, 'timeline.json'), 'utf8')).frames).toBe(75);
    expect(calls.filter((c) => c.tool === 'renderer.check').map((c) => c.args[0])).toEqual([composition]);
  });

  it('--deep turns a finding of the renderer into an issue with a place in the document and a fix', async () => {
    const overflow = { code: 'text_box_overflow', message: 'Text extends 12px beyond its container', target: 'hook-1', second: 0.5 };
    const lint = { code: 'missing_timeline', message: 'no timeline registered', target: 'index.html', second: null };
    const first = await ask(fakeContext({ checkIssues: [overflow] }).context, ['check', small(), '--deep']);
    expect(first.exit).toBe(1);
    expect(first.json.issues[0]).toMatchObject({ code: 'layout-overflow', path: 'texts[0]', at: 15 });
    expect(first.json.issues[0].message).toContain('text_box_overflow');
    expect(first.json.issues[0].fix).toContain('texts[0]');
    const second = await ask(fakeContext({ checkIssues: [lint] }).context, ['check', small(), '--deep']);
    expect(second.exit).toBe(3);
    expect(second.json.issues[0]).toMatchObject({ code: 'composition-fault', target: 'index.html' });
  });

  it('names a file that is not there, JSON that is not JSON (with the line), and reads edit.json of a folder', async () => {
    const { context } = fakeContext();
    const missing = await ask(context, ['check', '/nowhere/edit.json']);
    expect(missing.exit).toBe(1);
    expect(missing.json.issues[0]).toMatchObject({ code: 'file-missing', target: '/nowhere/edit.json' });
    const broken = await ask(context, ['check', tempProject('{\n  "version": 1,\n  "frames": 75,,\n}', [])]);
    expect(broken.exit).toBe(1);
    expect(broken.json.issues[0].code).toBe('json-invalid');
    expect(broken.json.issues[0].message).toMatch(/line 3/);
    expect((await ask(context, ['check', dirname(small())])).json.ok).toBe(true);
  });

  it('quotes a path with a space in the commands it proposes', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 've-cli-')), 'my video');
    mkdirSync(join(dir, 'assets'), { recursive: true });
    for (const name of SMALL_ASSETS) writeFileSync(join(dir, 'assets', name), '');
    writeFileSync(join(dir, 'edit.json'), JSON.stringify(fixture('small')));
    const { context } = fakeContext({ streams: { ...STREAMS, 'clip.mp4': { ...STREAMS['clip.mp4']!, fps: 25 } } });
    const failed = await ask(context, ['check', join(dir, 'edit.json')]);
    expect(failed.json.issues[0].fix).toContain(`viraleditor normalize '${dir}/assets/clip.mp4' '${dir}/assets/clip-norm.mp4' --canvas`);
    expect(failed.json.result.next).toContain(`viraleditor check '${dir}/edit.json'`);
    expect((await ask(fakeContext().context, ['check', join(dir, 'edit.json')])).json.result.next).toContain(`viraleditor frames '${dir}/edit.json' --at`);
  });

  it('exits 3 when ffprobe does not start, instead of calling every file damaged', async () => {
    const { context } = fakeContext();
    context.tools.measure.streams = async () => { throw new MediaError('tool-failed', 'cannot start /fake/ffprobe: ENOENT'); };
    const ran = await ask(context, ['check', small()]);
    expect(ran.exit).toBe(3);
    expect(ran.json.issues).toHaveLength(1);
    expect(ran.json.issues[0]).toMatchObject({ code: 'tool-failed' });
    expect(ran.json.issues[0].fix).toContain('viraleditor doctor');
  });
});

describe('frames', () => {
  it('asks the HyperFrames CLI for stills at frame / fps and names one PNG per frame', async () => {
    const file = small();
    const { context, calls } = fakeContext({ exec: { hyperframes: snapshot } });
    const ran = await ask(context, ['frames', file, '--at', '48,12']);
    const work = join(dirname(file), '.viraleditor');
    expect(ran.exit).toBe(0);
    const call = calls.find((c) => c.tool === 'exec.hyperframes')!;
    expect(call.args.slice(0, 7)).toEqual(['snapshot', join(work, 'composition'), '--at', '0.4,1.6', '--no-end', '--describe', 'false']);
    expect(ran.json.result).toMatchObject({
      width: 720, height: 1280, dir: join(work, 'frames'),
      frames: [{ frame: 12, second: 0.4, file: join(work, 'frames', 'frame-0012.png') }, { frame: 48, second: 1.6, file: join(work, 'frames', 'frame-0048.png') }],
    });
    expect(readFileSync(join(work, 'frames', 'frame-0048.png'), 'utf8')).toBe('png 1.6');
  });
  it('writes into --out when given', async () => {
    const out = mkdtempSync(join(tmpdir(), 've-cli-out-'));
    const ran = await ask(fakeContext({ exec: { hyperframes: snapshot } }).context, ['frames', small(), '--at', '0', '--out', out]);
    expect(ran.json.result.frames[0].file).toBe(join(out, 'frame-0000.png'));
    expect(existsSync(join(out, 'frame-0000.png'))).toBe(true);
  });
  it('refuses a frame outside the video and a document with errors before any browser starts', async () => {
    const { context, calls } = fakeContext({ exec: { hyperframes: snapshot } });
    const outside = await ask(context, ['frames', small(), '--at', '12,75']);
    expect(outside.exit).toBe(1);
    expect(outside.json.issues[0]).toMatchObject({ code: 'frame-range', target: '--at' });
    expect(outside.json.issues[0].message).toContain('0 to 74');
    const edit = fixture('small');
    edit.texts[0].style = 'hok';
    expect((await ask(context, ['frames', tempProject(edit, SMALL_ASSETS), '--at', '1'])).exit).toBe(1);
    expect(calls.some((c) => c.tool === 'exec.hyperframes')).toBe(false);
  });
  it('exits 3 when the snapshot fails or writes fewer pictures than asked', async () => {
    const failing = await ask(fakeContext({ exec: { hyperframes: () => ({ code: 1, stdout: '', stderr: 'Chrome did not start' }) } }).context, ['frames', small(), '--at', '1']);
    expect(failing.exit).toBe(3);
    expect(failing.json.issues[0]).toMatchObject({ code: 'stills-failed' });
    expect(failing.json.issues[0].message).toContain('Chrome did not start');
    const none = await ask(fakeContext({ exec: { hyperframes: () => ({ code: 0, stdout: '', stderr: '' }) } }).context, ['frames', small(), '--at', '1']);
    expect(none.json.issues[0]).toMatchObject({ code: 'stills-failed' });
  });
  it('never hands a key of an outside service to the child: its environment is the allow list and the three switches', async () => {
    const bin = join(mkdtempSync(join(tmpdir(), 've-cli-bin-')), 'hyperframes');
    const dump = `${bin}.env.json`;
    writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(dump)}, JSON.stringify({ args, env: process.env }));
const out = args[args.indexOf('--output') + 1];
fs.mkdirSync(out, { recursive: true });
args[args.indexOf('--at') + 1].split(',').forEach((s, i) => fs.writeFileSync(path.join(out, 'frame-0' + i + '-at-' + s + 's.png'), 'png'));
`);
    chmodSync(bin, 0o755);
    const { context } = fakeContext();
    context.tools.exec = toolRunner({ ...context.tools.where, hyperframes: bin });
    const secrets = { GEMINI_API_KEY: 'gemini-secret', MAGNIFIC_API_KEY: 'magnific-secret', ANTHROPIC_API_KEY: 'anthropic-secret', OPENAI_API_KEY: 'openai-secret' };
    const before = { ...process.env };
    Object.assign(process.env, secrets);
    try {
      const ran = await ask(context, ['frames', small(), '--at', '3']);
      expect(ran.json.issues).toEqual([]);
    } finally {
      for (const name of Object.keys(secrets)) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; }
    }
    const seen = JSON.parse(readFileSync(dump, 'utf8')) as { args: string[]; env: Record<string, string> };
    expect(seen.args[0]).toBe('snapshot');
    expect(seen.args).toContain('--describe');                    // and the picture analysis is switched off by name
    expect(seen.args[seen.args.indexOf('--describe') + 1]).toBe('false');
    for (const name of Object.keys(secrets)) expect(seen.env[name]).toBeUndefined();
    expect(Object.keys(seen.env).filter((name) => /KEY|TOKEN|SECRET/i.test(name))).toEqual([]);
    expect(seen.env).toMatchObject({ HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1' });
  });
});

describe('render', () => {
  it('checks deep, renders, checks the result and answers with the file, its facts, the times and the slowest stage', async () => {
    const file = small();
    const { context, calls, logs } = fakeContext();
    const ran = await ask(context, ['render', file]);
    const out = join(dirname(file), '.viraleditor', 'render.mp4');
    expect(ran.exit).toBe(0);
    expect(ran.json).toMatchObject({ ok: true, command: 'render', issues: [] });
    expect(ran.json.result).toMatchObject({
      file: out, failed: false, width: 720, height: 1280, fps: 30, frames: 75, seconds: 2.5, sound: true, quality: 'looks', sheet: null,
      slowest: { stage: 'render.cli.capture', seconds: 3.5 },
    });
    expect(ran.json.result.stages).toContainEqual({ stage: 'render.cli.encode', seconds: 1 });
    expect(ran.json.result.stages.map((s: { stage: string }) => s.stage)).toEqual(expect.arrayContaining(['check', 'render', 'quality']));
    expect(typeof ran.json.result.renderSeconds).toBe('number');
    expect(existsSync(out)).toBe(true);
    const order = calls.map((c) => c.tool).filter((tool) => tool.startsWith('renderer.'));
    expect(order).toEqual(['renderer.check', 'renderer.render']);
    expect(logs.join('\n')).toContain('75/75');                  // progress goes to stderr
  });
  it('takes --quality and --out, and with --sheet writes a contact sheet beside the video', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 've-cli-out-')), 'render.mp4');     // the fake measure knows a render by this name
    const { context, calls } = fakeContext();
    const ran = await ask(context, ['render', small(), '--quality', 'draft', '--out', out, '--sheet']);
    expect(ran.exit).toBe(0);
    expect(calls.find((c) => c.tool === 'renderer.render')!.args.slice(1)).toEqual([out, 'draft']);
    expect(ran.json.result).toMatchObject({ file: out, quality: 'draft', sheet: { file: out.replace(/\.mp4$/, '.sheet.png'), columns: 4, rows: 3 } });
    expect(ran.json.result.sheet.tiles).toHaveLength(12);
    expect(ran.json.result.sheet.tiles[5]).toEqual({ tile: 6, row: 2, column: 2, second: 1.25, frame: 38 });
    expect(existsSync(ran.json.result.sheet.file)).toBe(true);
  });
  it('stops at a missing asset with exit 1 before any render starts', async () => {
    const { context, calls } = fakeContext();
    const ran = await ask(context, ['render', tempProject(fixture('small'), SMALL_ASSETS.filter((name) => name !== 'still.png'))]);
    expect(ran.exit).toBe(1);
    expect(ran.json.issues[0]).toMatchObject({ code: 'media-missing', path: 'media.still' });
    expect(calls.some((c) => c.tool.startsWith('renderer.'))).toBe(false);
  });
  it('makes an error of the quality check an error of the command; the file is kept, named and marked as failed', async () => {
    const { context } = fakeContext({ black: { 'render.mp4': [{ at: 10, for: 6 }] } });
    const ran = await ask(context, ['render', small()]);
    expect(ran.exit).toBe(1);
    expect(ran.json.ok).toBe(false);
    expect(ran.json.issues[0]).toMatchObject({ code: 'black-frames', path: 'shots[0]', at: 10 });
    expect(ran.json.result.failed).toBe(true);
    expect(existsSync(ran.json.result.file)).toBe(true);
  });
  it('keeps a warning of the quality check a warning: exit 0', async () => {
    const ran = await ask(fakeContext({ loudness: { integrated: -22, truePeak: -8, range: 3 } }).context, ['render', small()]);
    expect(ran.exit).toBe(0);
    expect(ran.json.ok).toBe(true);
    expect(names(ran.json.warnings)).toContain('too-quiet');
    expect(ran.json.result.failed).toBe(false);
  });
  it('exits 3 when the renderer fails', async () => {
    const ran = await ask(fakeContext({ renderFails: 'hyperframes render exited 1:\nChrome crashed' }).context, ['render', small()]);
    expect(ran.exit).toBe(3);
    expect(ran.json.issues[0]).toMatchObject({ code: 'render-failed' });
    expect(ran.json.issues[0].message).toContain('Chrome crashed');
    expect(ran.json.issues[0].fix).toContain('viraleditor doctor');
  });
});

describe('sheet, inspect, probe, normalize', () => {
  const video = () => { const file = join(mkdtempSync(join(tmpdir(), 've-cli-')), 'render.mp4'); writeFileSync(file, 'mp4'); return file; };

  it('sheet: a grid of tiles beside the video, with the place and the second of every tile', async () => {
    const file = video();
    const { context, calls } = fakeContext();
    const ran = await ask(context, ['sheet', file]);
    expect(ran.exit).toBe(0);
    expect(calls.find((c) => c.tool === 'media.sheet')!.args).toEqual([file, file.replace(/\.mp4$/, '.sheet.png'), { columns: 4, rows: 3, labels: true }]);
    expect(ran.json.result).toMatchObject({ file: file.replace(/\.mp4$/, '.sheet.png'), video: file, columns: 4, rows: 3 });
    expect(ran.json.result.tiles[4]).toEqual({ tile: 5, row: 2, column: 1, second: 1, frame: 30 });
    const out = join(dirname(file), 'grid.png');
    const custom = await ask(context, ['sheet', file, '--columns', '2', '--rows', '2', '--out', out]);
    expect(custom.json.result).toMatchObject({ file: out, columns: 2, rows: 2 });
    expect(custom.json.result.tiles).toHaveLength(4);
    expect((await ask(context, ['sheet', '/nowhere/x.mp4'])).json.issues[0]).toMatchObject({ code: 'file-missing' });
  });

  it('inspect: the quality check of a finished render against its timeline', async () => {
    const file = small();
    const { context, fakes } = fakeContext();
    await ask(context, ['render', file]);
    const work = join(dirname(file), '.viraleditor');
    const timeline = join(work, 'composition', 'timeline.json');
    const fine = await ask(context, ['inspect', join(work, 'render.mp4'), '--timeline', timeline]);
    expect(fine.exit).toBe(0);
    expect(fine.json.result).toMatchObject({ file: join(work, 'render.mp4'), timeline, errors: 0, warnings: 0 });
    fakes.black['render.mp4'] = [{ at: 10, for: 6 }];
    const black = await ask(context, ['inspect', join(work, 'render.mp4'), '--timeline', timeline]);
    expect(black.exit).toBe(1);
    expect(black.json.issues[0]).toMatchObject({ code: 'black-frames', target: 'one', at: 10 });
    expect(black.json.result.errors).toBe(1);
    const wrong = await ask(context, ['inspect', join(work, 'render.mp4'), '--timeline', file]);
    expect(wrong.exit).toBe(1);
    expect(wrong.json.issues[0]).toMatchObject({ code: 'timeline-invalid', target: file });
    expect((await ask(context, ['inspect', join(work, 'render.mp4')])).json.issues[0]).toMatchObject({ code: 'flag-missing', target: '--timeline' });
  });

  it('probe: the facts of a media file', async () => {
    const { context } = fakeContext();
    const file = join(dirname(small()), 'assets', 'clip.mp4');
    const ran = await ask(context, ['probe', file]);
    expect(ran.exit).toBe(0);
    expect(ran.json.result).toEqual({
      file, kind: 'video', width: 720, height: 1280, fps: 30, frames: 90, seconds: 3, constantRate: true, codec: 'h264', pixelFormat: 'yuv420p',
      colour: { space: 'bt709', transfer: 'bt709', primaries: 'bt709' }, keyframes: { count: 3, largestGap: 30, frames: [0, 30, 60] }, sound: null, loudness: null,
    });
    const tone = await ask(context, ['probe', join(dirname(file), 'tone.mp3')]);
    expect(tone.json.result).toMatchObject({ kind: 'audio', sound: { codec: 'mp3', sampleRate: 48000, channels: 2 }, loudness: { integrated: -14, truePeak: -2, range: 4 } });
    expect((await ask(context, ['probe', join(dirname(file), 'still.png')])).json.result.kind).toBe('image');
    const text = join(dirname(file), 'notes.txt');
    writeFileSync(text, 'hello');
    const not = await ask(context, ['probe', text]);
    expect(not.exit).toBe(1);
    expect(not.json.issues[0]).toMatchObject({ code: 'media-unreadable', target: text });
    expect((await ask(context, ['probe', '/nowhere/a.mp4'])).json.issues[0]).toMatchObject({ code: 'file-missing' });
  });

  it('normalize: a copy on the canvas, at 30 fps, and what to write into the document', async () => {
    const { context, calls } = fakeContext();
    const dir = dirname(small());
    const from = join(dir, 'assets', 'clip.mp4');
    const to = join(dir, 'assets', 'clip-norm.mp4');
    const ran = await ask(context, ['normalize', from, to, '--canvas', '1080x1920']);
    expect(ran.exit).toBe(0);
    expect(calls.find((c) => c.tool === 'media.normalize')!.args).toEqual([from, to, { width: 1080, height: 1920, fps: 30, audio: false }]);
    expect(ran.json.result).toMatchObject({ file: to, from, width: 1080, height: 1920, fps: 30, frames: 90, sound: false });
    const wrong = await ask(context, ['normalize', from, to, '--canvas', '1920x1080']);
    expect(wrong.exit).toBe(2);
    expect(wrong.json.issues[0]).toMatchObject({ code: 'flag-value', target: '--canvas' });
    expect((await ask(context, ['normalize', from, to])).json.issues[0]).toMatchObject({ code: 'flag-missing', target: '--canvas' });
  });
});

describe('doctor', () => {
  it('says ready when the CLI is the pinned version and Chrome, ffmpeg, ffprobe and the fonts are there', async () => {
    const ran = await ask(fakeContext({ exec: tools(HYPERFRAMES_VERSION, true) }).context, ['doctor']);
    expect(ran.exit).toBe(0);
    expect(ran.json.result.ready).toBe(true);
    expect(ran.json.result.checks.map((c: { name: string }) => c.name)).toEqual(['hyperframes', 'chrome', 'ffmpeg', 'ffprobe', 'fonts', 'aligner']);
    expect(ran.json.result.checks.every((c: { ok: boolean; detail: string }) => c.ok && c.detail.length > 0)).toBe(true);
  });
  it('names what is missing and how to get it, with exit 3', async () => {
    const ran = await ask(fakeContext({ exec: tools('0.9.0', false, 1) }).context, ['doctor']);
    expect(ran.exit).toBe(3);
    expect(ran.json.result.ready).toBe(false);
    expect(ran.json.issues.map((i: { target: string }) => i.target)).toEqual(['hyperframes', 'chrome', 'ffmpeg']);
    expect(ran.json.issues[0]).toMatchObject({ code: 'tool-missing' });
    expect(ran.json.issues[0].message).toContain('0.9.0');
    expect(ran.json.issues[0].message).toContain(HYPERFRAMES_VERSION);
    expect(ran.json.issues[1].fix).toContain('hyperframes browser ensure');
    for (const found of ran.json.issues) expect(found.fix.length).toBeGreaterThan(10);
  });
  it('names a missing aligner as a warning: the editor stays ready without it', async () => {
    const aligner = { ready: false, note: 'no Python environment at tools/align/.venv', fails: null, unplaced: [] };
    const ran = await ask(fakeContext({ exec: tools(HYPERFRAMES_VERSION, true), aligner }).context, ['doctor']);
    expect(ran.exit).toBe(0);
    expect(ran.json.result.ready).toBe(true);
    expect(ran.json.result.checks.at(-1)).toMatchObject({ name: 'aligner', ok: false });
    expect(ran.json.warnings[0]).toMatchObject({ code: 'tool-missing', target: 'aligner' });
    expect(ran.json.warnings[0].fix).toContain('tools/align/setup.sh');
  });
});

describe('every command', () => {
  it('is in the table with a summary, and its help comes from there', async () => {
    expect(COMMANDS.map((c) => c.name)).toEqual(expect.arrayContaining(['doctor', 'check', 'frames', 'render', 'sheet', 'inspect', 'probe', 'normalize']));
    for (const command of COMMANDS) expect(command.summary.length).toBeGreaterThan(20);
  });
  it('answers with the same five keys, whatever happens', async () => {
    const file = small();
    const ready = tools(HYPERFRAMES_VERSION, true);
    const { context } = fakeContext({ exec: { ...ready, hyperframes: (args) => (args[0] === 'snapshot' ? snapshot(args) : ready.hyperframes(args)) } });
    const video = join(dirname(file), 'assets', 'clip.mp4');
    const cases = [['doctor'], ['check', file], ['frames', file, '--at', '3'], ['render', file], ['sheet', video], ['inspect', video, '--timeline', file], ['probe', video], ['normalize', video, `${video}.out.mp4`, '--canvas', '720x1280'], ['check'], ['nothing']];
    for (const argv of cases) {
      const ran = await ask(context, argv);
      expect(Object.keys(ran.json), argv.join(' ')).toEqual(['ok', 'command', 'issues', 'warnings', 'result']);
      for (const found of [...ran.json.issues, ...ran.json.warnings]) {
        expect(typeof found.code).toBe('string');
        expect(found.path ?? found.target, `${argv[0]}: ${found.code}`).toBeTypeOf('string');
        expect(found.message.length).toBeGreaterThan(0);
        expect(found.fix.length, `${argv[0]}: ${found.code}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('the program itself', () => {
  const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
  const program = (args: string[]) => spawnSync(process.execPath, [MAIN, ...args], { encoding: 'utf8', timeout: 60_000 });

  it('prints exactly one JSON object on stdout with --json and exits 2 for an unknown command', () => {
    const run = program(['chek', 'x.json', '--json']);
    expect(run.status).toBe(2);
    expect(JSON.parse(run.stdout).issues[0].fix).toContain('"check"');
    expect(run.stdout.trim().startsWith('{') && run.stdout.trim().endsWith('}')).toBe(true);
  });
  it('exits 1 for a document with faults, with every fault on stdout as JSON', () => {
    const edit = fixture('small');
    edit.colour = 'red';                       // an unknown key
    delete edit.language;                      // a missing field
    const run = program(['check', tempProject(edit, []), '--json']);
    expect(run.status).toBe(1);
    const answer = JSON.parse(run.stdout);
    expect(answer.ok).toBe(false);
    expect(answer.issues.map((i: { code: string }) => i.code)).toEqual(['schema', 'schema']);
    expect(answer.issues.map((i: { path: string }) => i.path).sort()).toEqual(['colour', 'language']);
  });
  it('prints the usage and exits 0 for --help', () => {
    const run = program(['--help']);
    expect(run.status).toBe(0);
    for (const command of COMMANDS) expect(run.stdout).toContain(command.name);
  });
});
