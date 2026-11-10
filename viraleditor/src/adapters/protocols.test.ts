import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runProcess } from './exec.ts';
import { createMeasure } from './measure.ts';
import { createMedia } from './media.ts';
import { PROTOCOLS, onlyLocalInputs } from './protocols.ts';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const have = existsSync(FFMPEG) && existsSync(FFPROBE);
const SLOW = 120_000;

describe('onlyLocalInputs', () => {
  it('puts the whitelist before every -i of ffmpeg and at the start for ffprobe; nothing else moves', () => {
    expect(PROTOCOLS).toBe('file,pipe');
    expect(onlyLocalInputs('ffmpeg', ['-y', '-i', 'a.mp4', '-i', 'b.png', '-vf', 'x', 'out.jpg']))
      .toEqual(['-y', '-protocol_whitelist', 'file,pipe', '-i', 'a.mp4', '-protocol_whitelist', 'file,pipe', '-i', 'b.png', '-vf', 'x', 'out.jpg']);
    expect(onlyLocalInputs('ffprobe', ['-v', 'error', 'a.mp4'])).toEqual(['-protocol_whitelist', 'file,pipe', '-v', 'error', 'a.mp4']);
  });
});

/** Wrappers of the real ffmpeg and ffprobe that write each call's arguments to a log (`CALL` before each) and then run the real tool: the flags must be ones the real tools accept. */
function spies() {
  const dir = mkdtempSync(join(tmpdir(), 've-protocols-'));
  const log = join(dir, 'calls.log');
  const wrap = (name: string, real: string): string => {
    const file = join(dir, name);
    writeFileSync(file, `#!/bin/sh\necho CALL >> '${log}'\nfor a in "$@"; do printf '%s\\n' "$a" >> '${log}'; done\nexec ${real} "$@"\n`);
    chmodSync(file, 0o755);
    return file;
  };
  const calls = (): string[][] => readFileSync(log, 'utf8').split('CALL\n').filter(Boolean).map((block) => block.trimEnd().split('\n'));
  return { dir, ffmpeg: wrap('ffmpeg', FFMPEG), ffprobe: wrap('ffprobe', FFPROBE), calls };
}

describe.skipIf(!have)('every ffmpeg / ffprobe call on a file reads local inputs only (SEC2 I4)', () => {
  async function source(dir: string): Promise<string> {
    const file = join(dir, 'src.mp4');
    const r = await runProcess(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-g', '10', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
    if (r.code !== 0) throw new Error(r.stderr);
    return file;
  }
  function allGuarded(calls: string[][]): void {
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      const inputs = args.flatMap((a, i) => (a === '-i' ? [i] : []));
      if (inputs.length === 0) {                                  // an ffprobe call: the file is positional
        expect(args.slice(0, 2)).toEqual(['-protocol_whitelist', PROTOCOLS]);
      }
      for (const i of inputs) expect(args.slice(i - 2, i)).toEqual(['-protocol_whitelist', PROTOCOLS]);
    }
  }

  it('Media: probe, normalize, still, both sheets, cuts', async () => {
    const s = spies();
    const file = await source(s.dir);
    const media = createMedia(s.ffmpeg, s.ffprobe);
    await media.probe(file);
    await media.normalize(file, join(s.dir, 'n.mp4'), { width: 90, height: 160, fps: 10, audio: true });
    await media.still(file, 0.5, join(s.dir, 's.jpg'));
    await media.sheet(file, join(s.dir, 'plain.jpg'), { columns: 2, rows: 2 });
    await media.sheet(file, join(s.dir, 'labelled.jpg'), { columns: 2, rows: 2, labels: true });
    await media.cuts(file);
    const calls = s.calls();
    expect(calls.some((args) => args.includes('-i'))).toBe(true);
    expect(calls.some((args) => !args.includes('-i'))).toBe(true);
    allGuarded(calls);
    expect(existsSync(join(s.dir, 'labelled.jpg'))).toBe(true);   // the real tools took the flag and did the work
  }, SLOW);

  it('Measure: streams, black, frozen, loudness, momentary, picture', async () => {
    const s = spies();
    const file = await source(s.dir);
    const measure = createMeasure(s.ffmpeg, s.ffprobe);
    await measure.streams(file);
    await measure.black(file);
    await measure.frozen(file);
    await measure.loudness(file);
    await measure.momentary(file);
    const picture = await measure.picture(file, 3);
    expect(picture.width).toBe(160);
    allGuarded(s.calls());
  }, SLOW);

  it('the whitelist does stop a network input in the real tool (a local check: a refused address is an error, not a connection)', async () => {
    const r = await runProcess(FFPROBE, ['-protocol_whitelist', PROTOCOLS, '-v', 'error', 'http://127.0.0.1:9/never.mp4'], { timeoutMs: 20_000 });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/not on whitelist/i);
  }, SLOW);
});
