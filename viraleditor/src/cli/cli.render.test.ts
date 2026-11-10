// The command line with the real tools, as an agent runs it: one process per command, the answer read from stdout.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { available, barOf, realProject } from './fixtures/project.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
const SLOW = 1_500_000;                              // the machine is shared: a render may take minutes

/** `viraleditor <args> --json` in its own process, with a key of an outside service in the environment it must not pass on. */
function viraleditor(args: string[]): { status: number | null; json: any; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, [MAIN, ...args, '--json'], { encoding: 'utf8', timeout: 1_200_000, maxBuffer: 1 << 26, env: { ...process.env, GEMINI_API_KEY: 'not-a-key' } });
  let json: any = null;
  try { json = JSON.parse(run.stdout); } catch { /* the test fails on the missing answer */ }
  return { status: run.status, json, stdout: run.stdout, stderr: run.stderr };
}
/** Width and height of a PNG, from its header. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe.skipIf(!available)('viraleditor on the small document, with the real tools', () => {
  it('doctor says everything is ready', () => {
    const run = viraleditor(['doctor']);
    expect(run.json, run.stdout + run.stderr).toMatchObject({ ok: true, command: 'doctor', result: { ready: true } });
    expect(run.status).toBe(0);
  }, SLOW);

  it('check --deep → frames → render --sheet: exit 0, stills of the canvas size, a video of the document, a sheet', () => {
    const file = realProject('small');
    const work = join(dirname(file), '.viraleditor');

    const check = viraleditor(['check', file, '--deep']);
    expect(check.json, check.stdout + check.stderr).toMatchObject({ ok: true, command: 'check', issues: [], result: { deep: true, frames: 75, canvas: '720x1280' } });
    expect(check.status).toBe(0);
    expect(check.json.result.stills.length).toBeGreaterThan(0);

    const frames = viraleditor(['frames', file, '--at', check.json.result.stills.join(',')]);
    expect(frames.json, frames.stdout + frames.stderr).toMatchObject({ ok: true, command: 'frames', issues: [] });
    expect(frames.status).toBe(0);
    expect(frames.json.result.frames.map((f: { frame: number }) => f.frame)).toEqual(check.json.result.stills);
    for (const still of frames.json.result.frames) expect(pngSize(still.file)).toEqual({ width: 720, height: 1280 });

    const render = viraleditor(['render', file, '--sheet']);
    expect(render.json, render.stdout + render.stderr).toMatchObject({ ok: true, command: 'render', issues: [] });
    expect(render.status).toBe(0);
    expect(render.stdout.trim().startsWith('{') && render.stdout.trim().endsWith('}')).toBe(true);     // one JSON object, nothing else
    expect(render.stderr).toMatch(/render: frame \d+\/75/);                                             // the progress is on stderr
    const result = render.json.result;
    expect(result).toMatchObject({ file: join(work, 'render.mp4'), failed: false, width: 720, height: 1280, fps: 30, frames: 75, sound: true, quality: 'looks' });
    expect(check.json.result.deepCheck).toBe('ran');
    expect(result.deepCheck).toBe('stamp');                        // `check --deep` just passed for this document: the render does not pay for it again
    expect(result.slowest.seconds).toBeGreaterThan(0);
    expect(result.stages.some((s: { stage: string }) => s.stage.startsWith('render.cli'))).toBe(true);
    expect(result.sheet.tiles).toHaveLength(12);
    expect(pngSize(result.sheet.file).width).toBeGreaterThan(0);

    // the file is what the answer says: read back through the command line itself
    const probe = viraleditor(['probe', result.file]);
    expect(probe.json.result).toMatchObject({ kind: 'video', width: 720, height: 1280, fps: 30, frames: 75 });
    const inspect = viraleditor(['inspect', result.file, '--timeline', result.timeline]);
    expect(inspect.json, inspect.stdout).toMatchObject({ ok: true, result: { errors: 0 } });
  }, SLOW);

  it('near-white text on white with no outline: `low-contrast` is a warning and the render still exits 0', () => {
    const render = viraleditor(['render', realProject('white')]);
    expect(render.json, render.stdout + render.stderr).toMatchObject({ ok: true, issues: [] });
    expect(render.status).toBe(0);
    const warning = render.json.warnings.find((w: { code: string }) => w.code === 'low-contrast');
    expect(warning).toMatchObject({ path: 'texts[0]' });
    expect(warning.fix.length).toBeGreaterThan(10);
    expect(render.json.result.failed).toBe(false);
    expect(render.json.result.deepCheck).toBe('ran');              // no check went before it
  }, SLOW);

  it('frames for more than a hundred frames: every still shows the frame it is named for', () => {
    const file = realProject('bars');
    const wanted = Array.from({ length: 101 }, (_, i) => i);
    const frames = viraleditor(['frames', file, '--at', wanted.join(',')]);
    expect(frames.json, frames.stdout.slice(0, 2000) + frames.stderr.slice(-2000)).toMatchObject({ ok: true, command: 'frames', issues: [] });
    expect(frames.json.result.frames.map((f: { frame: number }) => f.frame)).toEqual(wanted);
    // the clip writes its frame number on every frame: the first still, some of those a sort by name would mix up, the last
    for (const n of [0, 11, 12, 50, 90, 100]) expect(barOf(frames.json.result.frames[n].file), `frame-${n}`).toBe(n);
  }, SLOW);

  it('a missing asset: exit 1 with `media-missing` before any render starts', () => {
    const file = realProject('small', ['clip.mp4']);
    const render = viraleditor(['render', file]);
    expect(render.status).toBe(1);
    expect(render.json.issues).toHaveLength(1);
    expect(render.json.issues[0]).toMatchObject({ code: 'media-missing', path: 'media.clip' });
    expect(existsSync(join(dirname(file), '.viraleditor'))).toBe(false);          // nothing was written, nothing was rendered
  }, SLOW);
});
