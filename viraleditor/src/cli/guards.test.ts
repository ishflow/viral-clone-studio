// The faults the first review found: stills under the wrong frame number, --out onto a source, the wrong file as
// edit.json, a load fault, the shape stage hiding the rest, the deep check paid twice; and the small ones.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { HYPERFRAMES_VERSION } from '../adapters/renderer.ts';
import { nearest } from './framework.ts';
import { SMALL_ASSETS, STREAMS, ask, fakeContext, fakeSnapshot, fixture, tempProject } from './testing.ts';
import { explain, fromOutput } from './translate.ts';
import { MediaError } from '../adapters/media.ts';

vi.setConfig({ testTimeout: 60_000 });
const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
const small = () => tempProject(fixture('small'), SMALL_ASSETS);
const count = (calls: { tool: string }[], tool: string) => calls.filter((c) => c.tool === tool).length;

describe('frames: every still under its own frame number (C1)', () => {
  const long = () => { const edit = fixture('small'); edit.frames = 150; edit.shots[1].for = 105; delete edit.audio; return tempProject(edit, SMALL_ASSETS); };

  it('pairs pictures and frames by the number in the tool’s file name, also past a hundred pictures', async () => {
    const file = long();
    const wanted = Array.from({ length: 101 }, (_, i) => i);
    const ran = await ask(fakeContext({ exec: { hyperframes: fakeSnapshot } }).context, ['frames', file, '--at', wanted.join(',')]);
    expect(ran.json.issues).toEqual([]);
    expect(ran.json.result.frames).toHaveLength(101);
    for (const frame of [0, 9, 10, 11, 12, 50, 90, 99, 100]) {
      expect(readFileSync(join(dirname(file), '.viraleditor', 'frames', `frame-${String(frame).padStart(4, '0')}.png`), 'utf8'), `frame ${frame}`).toBe(`png ${frame / 30}`);
    }
  });
  it('does not say ok when the tool’s pictures are not exactly the ones asked for', async () => {
    const odd = (names: string[]) => (args: string[]) => {
      const out = args[args.indexOf('--output') + 1]!;
      mkdirSync(out, { recursive: true });
      for (const name of names) writeFileSync(join(out, name), 'png');
      return { code: 0, stdout: '', stderr: '' };
    };
    for (const names of [['frame-00-at-0.1s.png', 'frame-02-at-0.3s.png'], ['frame-00-at-0.1s.png'], ['frame-00-at-0.1s.png', 'frame-01-at-0.2s.png', 'frame-02-at-0.3s.png']]) {
      const ran = await ask(fakeContext({ exec: { hyperframes: odd(names) } }).context, ['frames', small(), '--at', '3,6']);
      expect(ran.exit, names.join(' ')).toBe(3);
      expect(ran.json.issues[0]).toMatchObject({ code: 'stills-failed' });
      expect(ran.json.result).toBeNull();
    }
  });
  it('removes the stills of an earlier run from its folder before it writes new ones', async () => {
    const file = small();
    const { context } = fakeContext({ exec: { hyperframes: fakeSnapshot } });
    await ask(context, ['frames', file, '--at', '12']);
    const frames = join(dirname(file), '.viraleditor', 'frames');
    writeFileSync(join(frames, 'notes.txt'), 'mine');
    await ask(context, ['frames', file, '--at', '48']);
    expect(existsSync(join(frames, 'frame-0012.png'))).toBe(false);
    expect(existsSync(join(frames, 'frame-0048.png'))).toBe(true);
    expect(existsSync(join(frames, 'notes.txt'))).toBe(true);            // only what it wrote itself
  });
});

describe('--out is checked before anything is written or removed (I2)', () => {
  it('render --out: a new .mp4 that is neither a folder, nor the document, nor a source of it', async () => {
    const file = small();
    const dir = dirname(file);
    mkdirSync(join(dir, 'folder.mp4'));
    symlinkSync(join(dir, 'assets', 'clip.mp4'), join(dir, 'link.mp4'));
    const wrong: [string, RegExp][] = [
      [join(dir, 'out.mov'), /\.mp4/], [file, /\.mp4/], [join(dir, 'folder.mp4'), /folder/], [join(dir, 'assets', 'new.mp4'), /assets/],
      [join(dir, 'assets', 'clip.mp4'), /assets|media/], [join(dir, 'link.mp4'), /media\.clip/],
    ];
    for (const [out, says] of wrong) {
      const { context, calls } = fakeContext();
      const ran = await ask(context, ['render', file, '--out', out]);
      expect(ran.exit, out).toBe(2);
      expect(ran.json.issues).toHaveLength(1);
      expect(ran.json.issues[0]).toMatchObject({ code: 'flag-value', target: '--out' });
      expect(ran.json.issues[0].message, out).toMatch(says);
      expect(ran.json.issues[0].fix.length).toBeGreaterThan(10);
      expect(calls.some((c) => c.tool.startsWith('renderer.'))).toBe(false);
      expect(existsSync(join(dir, '.viraleditor'))).toBe(false);
    }
    expect(existsSync(join(dir, 'assets', 'clip.mp4'))).toBe(true);
  });
  it('frames --out: a folder, or a name that is free', async () => {
    const file = small();
    const { context, calls } = fakeContext({ exec: { hyperframes: fakeSnapshot } });
    const ran = await ask(context, ['frames', file, '--at', '3', '--out', file]);
    expect(ran.exit).toBe(2);
    expect(ran.json.issues[0]).toMatchObject({ code: 'flag-value', target: '--out' });
    expect(count(calls, 'exec.hyperframes')).toBe(0);
    expect(existsSync(join(dirname(file), '.viraleditor'))).toBe(false);
  });
  it('sheet --out: a .png that is not the video', async () => {
    const video = join(mkdtempSync(join(tmpdir(), 've-cli-')), 'render.mp4');
    writeFileSync(video, 'mp4');
    const { context, calls } = fakeContext();
    for (const out of [video, join(dirname(video), 'sheet.jpg')]) {
      const ran = await ask(context, ['sheet', video, '--out', out]);
      expect(ran.exit, out).toBe(2);
      expect(ran.json.issues[0]).toMatchObject({ code: 'flag-value', target: '--out' });
    }
    expect(count(calls, 'media.sheet')).toBe(0);
    expect(readFileSync(video, 'utf8')).toBe('mp4');
  });
  it('sheet --out never lands in the assets folder of a project (R2fix, C7b minor 9)', async () => {
    const dir = dirname(small());
    const { context, calls } = fakeContext();
    const ran = await ask(context, ['sheet', join(dir, 'assets', 'clip.mp4'), '--out', join(dir, 'assets', 'product.png')]);
    expect(ran.exit).toBe(2);
    expect(ran.json.issues[0]).toMatchObject({ code: 'flag-value', target: '--out' });
    expect(ran.json.issues[0].message).toContain('assets');
    expect(count(calls, 'media.sheet')).toBe(0);
  });
  it('a render without --sheet removes the sheet of the render before it', async () => {
    const file = small();
    const { context } = fakeContext();
    const first = await ask(context, ['render', file, '--sheet']);
    expect(existsSync(first.json.result.sheet.file)).toBe(true);
    await ask(context, ['render', file]);
    expect(existsSync(first.json.result.sheet.file)).toBe(false);
  });
});

describe('a fault while the program loads (I1)', () => {
  /** main.ts alone in a folder: the modules it loads are not there. */
  const broken = () => { const to = join(mkdtempSync(join(tmpdir(), 've-cli-load-')), 'main.ts'); copyFileSync(MAIN, to); return to; };
  const program = (main: string, args: string[]) => spawnSync(process.execPath, [main, ...args], { encoding: 'utf8', timeout: 60_000 });

  it('answers `internal` as one JSON object with exit 3, for doctor and --help too', () => {
    const main = broken();
    for (const args of [['doctor', '--json'], ['--help', '--json'], ['check', 'x.json', '--json']]) {
      const run = program(main, args);
      expect(run.status, args.join(' ')).toBe(3);
      const answer = JSON.parse(run.stdout);
      expect(Object.keys(answer)).toEqual(['ok', 'command', 'issues', 'warnings', 'result']);
      expect(answer).toMatchObject({ ok: false, result: null, issues: [{ code: 'internal' }] });
      expect(answer.issues[0].fix).toContain('viraleditor doctor');
      expect(answer.issues[0].fix).toContain('the installation is broken');
      expect(answer.issues[0].fix).toMatch(/Cannot find module|ERR_MODULE_NOT_FOUND/);
      expect(run.stdout).not.toMatch(/\n\s+at /);                   // no stack on stdout
    }
  });
  it('answers with a short text without --json', () => {
    const run = program(broken(), ['doctor']);
    expect(run.status).toBe(3);
    expect(run.stdout).toMatch(/^FAILED doctor \(exit 3\)/);
    expect(run.stdout).toContain('fix: ');
    expect(run.stdout.split('\n').length).toBeLessThan(8);
  });
});

describe('the wrong file as edit.json is named for what it is (I3)', () => {
  const one = async (given: string) => {
    const ran = await ask(fakeContext().context, ['check', given]);
    expect(ran.exit, given).toBe(1);
    expect(ran.json.issues, given).toHaveLength(1);
    expect(ran.json.issues[0]).toMatchObject({ code: 'not-an-edit', target: given });
    return ran.json.issues[0] as { message: string; fix: string };
  };
  it('the timeline.json the editor wrote: says so, and names the edit document of that project', async () => {
    const file = small();
    await ask(fakeContext().context, ['check', file, '--deep']);
    const found = await one(join(dirname(file), '.viraleditor', 'composition', 'timeline.json'));
    expect(found.message).toContain('timeline.json');
    expect(found.fix).toContain(`viraleditor check ${file}`);
  });
  it('a template.json, a list, an object that has nothing of an edit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 've-cli-'));
    const write = (name: string, value: unknown) => { writeFileSync(join(dir, name), JSON.stringify(value)); return join(dir, name); };
    expect((await one(write('template.json', { id: 't1', source: { kind: 'seed' }, mode: 'beats', canvas: { width: 720, height: 1280, fps: 30 }, shots: [] }))).message).toContain('template');
    expect((await one(write('list.json', [1, 2]))).message).toContain('list');
    expect((await one(write('package.json', { name: 'x', scripts: {} }))).message).toContain('name, scripts');
  });
  it('a media file, an HTML file, an empty file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 've-cli-'));
    writeFileSync(join(dir, 'clip.mp4'), Buffer.from([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]));
    writeFileSync(join(dir, 'index.html'), '<!doctype html>\n<html></html>');
    writeFileSync(join(dir, 'empty.json'), '  \n');
    const media = await one(join(dir, 'clip.mp4'));
    expect(media.message).toMatch(/media file|not text/);
    expect(media.fix).not.toContain('comma');
    expect((await one(join(dir, 'index.html'))).message).toContain('HTML');
    expect((await one(join(dir, 'empty.json'))).message).toContain('empty');
  });
  it('a folder without edit.json: says what it holds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 've-cli-'));
    writeFileSync(join(dir, 'draft.json'), '{}');
    const found = await one(dir);
    expect(found.message).toContain('no edit.json');
    expect(found.message).toContain('draft.json');
  });
  it('still gives JSON that is nearly an edit its schema issues', async () => {
    const edit = fixture('small');
    delete edit.version;
    const ran = await ask(fakeContext().context, ['check', tempProject(edit, SMALL_ASSETS)]);
    expect(ran.json.issues.map((i: { code: string }) => i.code)).toEqual(['schema']);
  });
});

describe('the shape stage says that the rest has not run (I4)', () => {
  it('names the stage and what has not been checked yet, in check, frames and render', async () => {
    const edit = fixture('small');
    edit.shots[0].medai = edit.shots[0].media;         // one mistyped field …
    delete edit.shots[0].media;
    edit.texts[0].style = 'hok';                       // … beside a fault of the rules
    const file = tempProject(edit, SMALL_ASSETS);
    for (const argv of [['check', file], ['frames', file, '--at', '3'], ['render', file]]) {
      const ran = await ask(fakeContext().context, argv);
      expect(ran.exit).toBe(1);
      expect(ran.json.issues.every((i: { code: string }) => i.code === 'schema')).toBe(true);
      expect(ran.json.result).toMatchObject({ document: file, stage: 'schema' });
      expect(ran.json.result.next).toContain('have not run yet');
    }
  });
});

describe('render does not repeat a deep check that just passed (I6)', () => {
  it('takes the check from the stamp of `check --deep`, and says so', async () => {
    const file = small();
    const { context, calls } = fakeContext();
    const checked = await ask(context, ['check', file, '--deep']);
    expect(checked.json.result.deepCheck).toBe('ran');
    const rendered = await ask(context, ['render', file]);
    expect(rendered.exit).toBe(0);
    expect(rendered.json.result.deepCheck).toBe('stamp');
    expect(count(calls, 'renderer.check')).toBe(1);
    expect(count(calls, 'renderer.render')).toBe(1);
  });
  it('checks again after any change: a byte of the document, a media file', async () => {
    const file = small();
    const { context, calls } = fakeContext();
    await ask(context, ['check', file, '--deep']);
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n`);
    expect((await ask(context, ['render', file])).json.result.deepCheck).toBe('ran');
    expect(count(calls, 'renderer.check')).toBe(2);
    expect((await ask(context, ['render', file])).json.result.deepCheck).toBe('stamp');     // a render that checked leaves a stamp too
    writeFileSync(join(dirname(file), 'assets', 'still.png'), 'changed');
    expect((await ask(context, ['render', file])).json.result.deepCheck).toBe('ran');
    expect(count(calls, 'renderer.check')).toBe(3);
  });
  it('leaves no stamp when the deep check found something, and `check --deep` always checks', async () => {
    const file = small();
    const { context, calls, fakes } = fakeContext({ checkIssues: [{ code: 'missing_timeline', message: 'no timeline', target: 'index.html', second: null }] });
    expect((await ask(context, ['check', file, '--deep'])).exit).toBe(3);
    fakes.checkIssues = [];
    expect((await ask(context, ['render', file])).json.result.deepCheck).toBe('ran');
    await ask(context, ['check', file, '--deep']);
    await ask(context, ['check', file, '--deep']);
    expect(count(calls, 'renderer.check')).toBe(4);
  });
});

describe('the small ones', () => {
  it('suggests a word only when one is near', async () => {
    expect(nearest('validate', ['doctor', 'check', 'frames'])).toBeNull();
    expect(nearest('output', ['out', 'at'])).toBe('out');               // one begins with the other
    const ran = await ask(fakeContext().context, ['validate', 'x.json']);
    expect(ran.exit).toBe(2);
    expect(ran.json.issues[0].fix).not.toContain('Did you mean');
    expect(ran.json.issues[0].fix).toContain('check');
    const flag = await ask(fakeContext().context, ['check', small(), '--bogus']);
    expect(flag.json.issues[0].fix).not.toContain('Did you mean');
    expect(flag.json.issues[0].fix).toContain('--deep');
  });
  it('understands help and --version, for the program and for a command, and a flag before the command', async () => {
    const { context } = fakeContext();
    const help = await ask(context, ['help']);
    expect(help.exit).toBe(0);
    expect(help.json.result.commands.length).toBeGreaterThan(7);
    expect((await ask(context, ['help', 'check'])).json.result.commands.map((c: { name: string }) => c.name)).toEqual(['check']);
    for (const argv of [['--version'], ['check', '--version'], ['version']]) {
      const version = await ask(context, argv);
      expect(version.exit).toBe(0);
      expect(version.json).toMatchObject({ ok: true, command: 'version', result: { edit: 1, hyperframes: HYPERFRAMES_VERSION } });
    }
    expect((await ask(context, ['--deep', 'check', small()])).json).toMatchObject({ ok: true, command: 'check', result: { deep: true } });
  });
  it('probe of a folder and normalize into a folder that is not there are usage faults with their own words', async () => {
    const { context, calls } = fakeContext();
    const dir = dirname(small());
    const folder = await ask(context, ['probe', dir]);
    expect(folder.exit).toBe(2);
    expect(folder.json.issues[0]).toMatchObject({ code: 'argument-value', target: '<file>' });
    expect(folder.json.issues[0].message).toContain('folder');
    const nowhere = await ask(context, ['normalize', join(dir, 'assets', 'clip.mp4'), join(dir, 'nowhere', 'out.mp4'), '--canvas', '720x1280']);
    expect(nowhere.exit).toBe(2);
    expect(nowhere.json.issues[0]).toMatchObject({ code: 'argument-value', target: '<out>' });
    expect(nowhere.json.issues[0].message).toContain(join(dir, 'nowhere'));
    expect(count(calls, 'media.normalize')).toBe(0);
  });
  it('normalize never writes over its own source, and writes only an .mp4 (R2fix, C7b I4)', async () => {
    const { context, calls } = fakeContext();
    const dir = dirname(small());
    const clip = join(dir, 'assets', 'clip.mp4');
    for (const out of [clip, join(dir, 'assets', '.', 'clip.mp4'), join(dir, 'edit.json'), join(dir, 'assets', 'clip-norm.mov')]) {
      const ran = await ask(context, ['normalize', clip, out, '--canvas', '720x1280']);
      expect(ran.exit, out).toBe(2);
      expect(ran.json.issues[0], out).toMatchObject({ code: 'argument-value', target: '<out>' });
    }
    expect(count(calls, 'media.normalize')).toBe(0);
  });
  it('a missing timeline sends the agent to check --deep or render, not to init; a file that is not media is named (R2fix, C7b minors 10, 11)', async () => {
    const dir = dirname(small());
    const ran = await ask(fakeContext().context, ['inspect', join(dir, 'assets', 'clip.mp4'), '--timeline', join(dir, 'nothere.json')]);
    expect(ran.json.issues[0]).toMatchObject({ code: 'file-missing', target: join(dir, 'nothere.json') });
    expect(ran.json.issues[0].fix).not.toContain('init');
    expect(ran.json.issues[0].fix).toContain('check');
    expect(explain(new MediaError('not-media', 'not a media file: /x/a.mp4'))).toMatchObject({ code: 'media-unreadable', target: '/x/a.mp4' });
    expect(explain(new MediaError('not-media', 'no video stream in /x/b.mp4'))).toMatchObject({ code: 'media-unreadable', target: '/x/b.mp4' });
  });
  it('a mistyped project folder names the folders beside it that hold an edit.json; a missing script file does not send to init (R2fix, trial S10)', async () => {
    const dir = dirname(small());
    const parent = mkdtempSync(join(tmpdir(), 've-cli-'));
    mkdirSync(join(parent, 'demo'));
    writeFileSync(join(parent, 'demo', 'edit.json'), '{}');
    const { context } = fakeContext();
    const ran = await ask(context, ['check', join(parent, 'demoo')]);
    expect(ran.json.issues[0]).toMatchObject({ code: 'file-missing', target: join(parent, 'demoo') });
    expect(ran.json.issues[0].fix).toContain('demo');
    const script = await ask(context, ['words', join(dir, 'assets', 'tone.mp3'), '--script', join(dir, 'nothere.txt')]);
    expect(script.json.issues[0].code).toBe('file-missing');
    expect(script.json.issues[0].fix).not.toContain('init');
  });
  it('check does not measure a media file outside assets/ (R2fix, C7b minor 6)', async () => {
    const edit = fixture('small');
    edit.media.clip.file = 'assets/../outside.mp4';
    const file = tempProject(edit, SMALL_ASSETS);
    writeFileSync(join(dirname(file), 'outside.mp4'), '');
    const ran = await ask(fakeContext({ streams: { ...STREAMS, 'outside.mp4': { ...STREAMS['clip.mp4']!, frames: 3, seconds: 0.1 } } }).context, ['check', file]);
    expect(ran.json.issues.map((i: { code: string; path: string }) => [i.code, i.path])).toEqual([['media-file', 'media.clip.file']]);
    expect(ran.json.result.media.clip).toEqual({ file: 'assets/../outside.mp4', kind: 'video', readable: false });
  });
  it('reports a media file outside assets/ once', async () => {
    const edit = fixture('small');
    edit.media.clip.file = 'clip.mp4';
    const ran = await ask(fakeContext().context, ['check', tempProject(edit, SMALL_ASSETS)]);
    expect(ran.json.issues.map((i: { code: string; path: string }) => [i.code, i.path])).toEqual([['media-file', 'media.clip.file']]);
  });
  it('gives a card that overflows a fix about its box, a text one about its copy', async () => {
    const file = small();
    await ask(fakeContext().context, ['check', file, '--deep']);
    const timeline = JSON.parse(readFileSync(join(dirname(file), '.viraleditor', 'composition', 'timeline.json'), 'utf8'));
    const finding = (target: string) => [{ code: 'element_overflow', message: 'extends beyond the canvas', target, second: 1.9 }];
    const card = (await ask(fakeContext({ checkIssues: finding(timeline.cards[0].element) }).context, ['check', file, '--deep'])).json.issues[0];
    expect(card).toMatchObject({ code: 'layout-overflow', path: 'cards[0]' });
    expect(card.fix).toContain('box');
    expect(card.fix).not.toContain('copy');
    const text = (await ask(fakeContext({ checkIssues: finding(timeline.texts[0].element) }).context, ['check', file, '--deep'])).json.issues[0];
    expect(text.fix).toContain('copy');
  });
  it('inspect --edit: black footage is a warning as in render, and issues name places', async () => {
    const file = small();
    const black = [{ at: 10, for: 6 }];
    const { context } = fakeContext({ black: { 'render.mp4': black, 'clip.mp4': black } });
    const rendered = await ask(context, ['render', file]);
    expect(rendered.json.warnings[0]).toMatchObject({ code: 'dark-footage', path: 'shots[0]' });
    const { file: video, timeline } = rendered.json.result;
    const withEdit = await ask(context, ['inspect', video, '--timeline', timeline, '--edit', file]);
    expect(withEdit.exit).toBe(0);
    expect(withEdit.json.warnings[0]).toMatchObject({ code: 'dark-footage', path: 'shots[0]' });
    expect(withEdit.json.result.next.length).toBeGreaterThan(10);
    const without = await ask(context, ['inspect', video, '--timeline', timeline]);
    expect(without.json.issues[0]).toMatchObject({ code: 'black-frames', target: 'one' });
  });
  it('reads a relative path from the folder the caller stands in (INIT_CWD of pnpm)', () => {
    const edit = fixture('small');
    edit.colour = 'red';
    const file = tempProject(edit, []);
    const run = spawnSync(process.execPath, [MAIN, 'check', 'edit.json', '--json'], { encoding: 'utf8', timeout: 60_000, cwd: tmpdir(), env: { ...process.env, INIT_CWD: dirname(file) } });
    expect(JSON.parse(run.stdout).issues.map((i: { code: string }) => i.code)).toEqual(['schema']);
  });
  it('names its own command where a fix of the quality check names a check of the composition', () => {
    const found = (fix: string) => ({ code: 'text-missing', severity: 'error' as const, message: 'm', fix, at: 3, target: 'hook-1' });
    const again = 'viraleditor check /p/edit.json --deep';
    const fix = 'run `viraleditor check <edit.json> --deep` and render again.';
    expect(fromOutput(found(fix), () => 'texts[0]', again).issue.fix).toContain('`viraleditor check /p/edit.json --deep`');
    expect(fromOutput(found(fix), () => undefined, null).issue.fix).toBe(fix);                   // without a document it is passed on as it is
  });
  it('has STREAMS for every small asset (the fakes of this file)', () => { for (const name of SMALL_ASSETS) expect(STREAMS[name]).toBeDefined(); });
});

// ── fix round 2 ──
/** Every file under a folder with its checksum. */
const sums = (dir: string): Record<string, string> => {
  const found: Record<string, string> = {};
  const walk = (d: string) => { for (const entry of readdirSync(d, { withFileTypes: true })) { const f = join(d, entry.name); if (entry.isDirectory()) walk(f); else found[f] = createHash('sha256').update(readFileSync(f)).digest('hex'); } };
  walk(dir);
  return found;
};

describe('the same file in another letter case is the same file (I2, round 2)', () => {
  it('render --out in another case of a source is refused, nothing changes (on a volume that ignores case)', async () => {
    const file = small();
    const dir = dirname(file);
    const folds = existsSync(join(dir, 'ASSETS'));                              // this volume ignores the case of names
    const before = sums(dir);
    for (const out of [join(dir, 'ASSETS', 'clip.mp4'), join(dir, 'Assets', 'NEW.mp4')]) {
      const { context } = fakeContext();
      const ran = await ask(context, ['render', file, '--out', out]);
      if (folds) {
        expect(ran.exit, out).toBe(2);
        expect(ran.json.issues[0]).toMatchObject({ code: 'flag-value', target: '--out' });
        expect(sums(dir), out).toEqual(before);
      } else {                                                                  // a case-sensitive volume: a different, new folder, so it is allowed; no source is touched
        for (const [name, sum] of Object.entries(before)) expect(sums(dir)[name], name).toBe(sum);
      }
    }
  });
  it('frames --out and sheet --out use the same comparison', async () => {
    const file = small();
    const dir = dirname(file);
    if (!existsSync(join(dir, 'ASSETS'))) return;                               // only on a volume that ignores case
    const { context } = fakeContext({ exec: { hyperframes: fakeSnapshot } });
    const ran = await ask(context, ['frames', file, '--at', '3', '--out', join(dir, 'ASSETS')]);
    expect(ran.exit).toBe(2);
    const video = join(dir, 'assets', 'clip.mp4');
    const sheet = await ask(context, ['sheet', video, '--out', join(dir, 'ASSETS', 'CLIP.MP4')]);
    expect(sheet.exit).toBe(2);
  });
});

describe('frames --out removes only stills it wrote itself (N1)', () => {
  it('refuses the assets folder and a folder that holds a file the document names', async () => {
    const edit = fixture('small');
    edit.media.still.file = 'assets/frame-0005.png';
    const file = tempProject(edit, ['clip.mp4', 'frame-0005.png', 'product.png', 'tone.mp3']);
    const dir = dirname(file);
    mkdirSync(join(dir, 'assets', 'sub'));
    mkdirSync(join(dir, 'other'));
    writeFileSync(join(dir, 'other', 'x.png'), 'x');
    const before = sums(dir);
    for (const out of [join(dir, 'assets'), join(dir, 'assets', 'sub')]) {
      const { context, calls } = fakeContext({ exec: { hyperframes: fakeSnapshot } });
      const ran = await ask(context, ['frames', file, '--at', '3', '--out', out]);
      expect(ran.exit, out).toBe(2);
      expect(ran.json.issues[0]).toMatchObject({ code: 'flag-value', target: '--out' });
      expect(count(calls, 'exec.hyperframes')).toBe(0);
      expect(sums(dir), out).toEqual(before);
    }
    // a folder outside assets/ that holds a file named by the document
    const doc = fixture('small');
    doc.media.still.file = 'other/frame-0005.png';
    const second = tempProject(doc, ['clip.mp4', 'product.png', 'tone.mp3']);
    mkdirSync(join(dirname(second), 'other'));
    writeFileSync(join(dirname(second), 'other', 'frame-0005.png'), 'mine');
    const ran = await ask(fakeContext({ exec: { hyperframes: fakeSnapshot } }).context, ['frames', second, '--at', '3', '--out', join(dirname(second), 'other')]);
    expect(ran.exit).toBe(2);
    expect(readFileSync(join(dirname(second), 'other', 'frame-0005.png'), 'utf8')).toBe('mine');
  });
  it('a foreign frame-0009.png survives two runs, the stills of the first run are gone after the second', async () => {
    const file = small();
    const out = join(mkdtempSync(join(tmpdir(), 've-cli-')), 'stills');
    mkdirSync(out);
    writeFileSync(join(out, 'frame-0009.png'), 'foreign');
    const { context } = fakeContext({ exec: { hyperframes: fakeSnapshot } });
    expect((await ask(context, ['frames', file, '--at', '3', '--out', out])).exit).toBe(0);
    expect(existsSync(join(out, 'frame-0003.png'))).toBe(true);
    expect((await ask(context, ['frames', file, '--at', '6', '--out', out])).exit).toBe(0);
    expect(existsSync(join(out, 'frame-0003.png'))).toBe(false);
    expect(existsSync(join(out, 'frame-0006.png'))).toBe(true);
    expect(readFileSync(join(out, 'frame-0009.png'), 'utf8')).toBe('foreign');
  });
});

describe('sheet labels are the command line’s choice (N7)', () => {
  it('sheet and render --sheet ask for labels', async () => {
    const file = small();
    const video = join(dirname(file), 'v.mp4');
    writeFileSync(video, 'mp4');
    const { context, calls } = fakeContext();
    await ask(context, ['render', file, '--sheet']);
    await ask(context, ['sheet', video]).catch(() => undefined);
    const asked = calls.filter((c) => c.tool === 'media.sheet');
    expect(asked.length).toBeGreaterThan(0);
    for (const c of asked) expect(JSON.stringify(c)).toContain('"labels":true');
  });
});

describe('three paths that were answered with `internal` (N3)', () => {
  it('sheet --out in a folder that is not there, or a folder; render --out beside a folder X.sheet.png', async () => {
    const file = small();
    const dir = dirname(file);
    const video = join(dir, 'v.mp4');
    writeFileSync(video, 'mp4');
    mkdirSync(join(dir, 'x.png'));
    mkdirSync(join(dir, 'X.sheet.png'));
    const { context } = fakeContext();
    for (const argv of [['sheet', video, '--out', join(dir, 'no', 'dir', 's.png')], ['sheet', video, '--out', join(dir, 'x.png')], ['render', file, '--out', join(dir, 'X.mp4')]]) {
      const ran = await ask(context, argv);
      expect(ran.exit, argv.join(' ')).toBe(2);
      expect(ran.json.issues[0].code, argv.join(' ')).not.toBe('internal');
      expect(ran.json.issues[0]).toMatchObject({ code: 'flag-value', target: '--out' });
    }
    expect(readdirSync(join(dir, 'X.sheet.png'))).toEqual([]);                  // the folder is still there
  });
});
