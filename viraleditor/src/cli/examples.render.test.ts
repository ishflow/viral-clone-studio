// Every example, with the real tools and as an agent runs it: `init` makes the project, then check --deep → frames →
// render --sheet. One process per command, the answer read from stdout.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_NAMES, readExample } from './examples.ts';
import { available } from './fixtures/project.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
const SLOW = 1_500_000;                              // the machine is shared: a render may take minutes

function viraleditor(args: string[]): { status: number | null; json: any; said: string } {
  const run = spawnSync(process.execPath, [MAIN, ...args, '--json'], { encoding: 'utf8', timeout: 1_200_000, maxBuffer: 1 << 26 });
  let json: any = null;
  try { json = JSON.parse(run.stdout); } catch { /* the test fails on the missing answer */ }
  return { status: run.status, json, said: run.stdout + run.stderr };
}
/** Width and height of a PNG, from its header. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe.skipIf(!available)('every example, with the real tools', () => {
  it.each(EXAMPLE_NAMES)('%s: init → check --deep → frames → render --sheet, each exit 0 and without a warning', (name) => {
    const { edit } = readExample(name);
    const { width, height } = edit.canvas;
    const dir = join(mkdtempSync(join(tmpdir(), `ve-cli-example-${name}-`)), 'project');

    const init = viraleditor(['init', dir, '--example', name]);
    expect(init.json, init.said).toMatchObject({ ok: true, command: 'init', issues: [], result: { example: name, frames: edit.frames } });
    expect(init.status).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(['.viraleditor', 'assets', 'edit.json']);                 // nothing else lands in the folder
    expect(readdirSync(join(dir, 'assets')).sort()).toEqual(Object.values(edit.media).map((entry) => entry.file.replace('assets/', '')).sort());

    const check = viraleditor(['check', dir, '--deep']);
    expect(check.json, check.said).toMatchObject({ ok: true, command: 'check', issues: [], warnings: [], result: { deep: true, deepCheck: 'ran', frames: edit.frames, canvas: `${width}x${height}` } });
    expect(check.status).toBe(0);

    const stills: number[] = check.json.result.stills;
    const frames = viraleditor(['frames', dir, '--at', stills.join(',')]);
    expect(frames.json, frames.said).toMatchObject({ ok: true, command: 'frames', issues: [] });
    expect(frames.status).toBe(0);
    expect(frames.json.result.frames.map((still: { frame: number }) => still.frame)).toEqual(stills);
    for (const still of frames.json.result.frames) expect(pngSize(still.file)).toEqual({ width, height });

    const render = viraleditor(['render', dir, '--sheet']);
    expect(render.json, render.said).toMatchObject({ ok: true, command: 'render', issues: [], warnings: [] });
    expect(render.status).toBe(0);
    const sound = edit.audio !== undefined || edit.shots.some((shot) => shot.sound !== undefined);
    expect(render.json.result).toMatchObject({ file: join(dir, '.viraleditor', 'render.mp4'), failed: false, width, height, fps: 30, frames: edit.frames, sound, deepCheck: 'stamp' });
    expect(existsSync(render.json.result.file)).toBe(true);
    expect(render.json.result.sheet.tiles).toHaveLength(12);
    expect(pngSize(render.json.result.sheet.file).width).toBeGreaterThan(width);                      // four tiles across
  }, SLOW);
});
