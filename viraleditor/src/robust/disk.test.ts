// C6 case 3: the disk is full or the target cannot be written. No disk image (hdiutil is out of bounds here): a read-only folder,
// and tools that fail as a full disk makes them fail (part of the file written, "No space left on device", exit 1).
// Expected everywhere: a typed error of the adapter, and nothing half-written left at the target or beside it.
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runProcess } from '../adapters/exec.ts';
import { fixtureTimeline } from '../adapters/fixtures/composition.ts';
import { createMeasure } from '../adapters/measure.ts';
import { MediaError, createMedia } from '../adapters/media.ts';
import { createRenderer } from '../adapters/renderer.ts';
import { RenderError } from '../ports.ts';
import { FFMPEG, FFPROBE } from './harness.ts';

const have = existsSync(FFMPEG) && existsSync(FFPROBE);
const T = 120_000;
const CANVAS = { width: 720, height: 1280, fps: 30, audio: true };
/** root can write into a 0555 folder: the tests that need a folder nobody can write to cannot show anything then. */
const root = process.getuid?.() === 0;
const NO_SPACE = 'av_interleaved_write_frame(): No space left on device';

describe.skipIf(!have)('a full disk or a folder that cannot be written (C6 case 3)', () => {
  const dir = mkdtempSync(join(tmpdir(), 've-robust-disk-'));
  const locked = join(dir, 'locked');
  const measure = createMeasure(FFMPEG, FFPROBE);
  /** An executable shell script in `dir`. */
  const script = (name: string, body: string): string => { const file = join(dir, name); writeFileSync(file, `#!/bin/sh\n${body}\n`); chmodSync(file, 0o755); return file; };
  /** The value after `--output` (hyperframes) or the last argument (ffmpeg), in the shell. */
  const OUTPUT = 'out=""; last=""; while [ $# -gt 0 ]; do [ "$1" = "--output" ] && out="$2"; last="$1"; shift; done; [ -z "$out" ] && out="$last"';
  const composition = (): string => {
    const c = mkdtempSync(join(dir, 'comp-'));
    writeFileSync(join(c, 'timeline.json'), JSON.stringify(fixtureTimeline({ lufs: -14, peak: -1 })));
    return c;
  };
  const everything = (folder: string): string[] => readdirSync(folder);

  beforeAll(async () => {
    const r = await runProcess(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-shortest', '-movflags', '+faststart', join(dir, 'good.mp4')], { timeoutMs: T });
    if (r.code !== 0) throw new Error(r.stderr);
    const good = readFileSync(join(dir, 'good.mp4'));
    writeFileSync(join(dir, 'half.mp4'), good.subarray(0, Math.floor(good.length / 2)));
    mkdirSync(locked);
    chmodSync(locked, 0o555);
  }, T);
  afterAll(() => { chmodSync(locked, 0o755); });                                        // the run's temp root must be removable

  describe('media.normalize', () => {
    const media = createMedia(FFMPEG, FFPROBE);
    it.skipIf(root)('into a read-only folder: tool-failed, nothing written', { timeout: T }, async () => {
      const e = await media.normalize(join(dir, 'good.mp4'), join(locked, 'n.mp4'), CANVAS).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(MediaError);
      expect((e as MediaError).code).toBe('tool-failed');
      expect(everything(locked)).toEqual([]);
    });
    it('ffmpeg writes part of the file and stops on a full disk: tool-failed naming the cause; an older file at `to` is kept; no temp file', { timeout: T }, async () => {
      const out = mkdtempSync(join(dir, 'norm-'));
      writeFileSync(join(out, 'n.mp4'), 'older');
      const full = script('ffmpeg-full', `${OUTPUT}\nhead -c 30000 '${join(dir, 'good.mp4')}' > "$out"\necho '${NO_SPACE}' >&2\nexit 1`);
      const e = await createMedia(full, FFPROBE).normalize(join(dir, 'good.mp4'), join(out, 'n.mp4'), CANVAS).catch((x: unknown) => x);
      expect(e).toMatchObject({ code: 'tool-failed' });
      expect((e as Error).message).toContain('No space left on device');
      expect(everything(out)).toEqual(['n.mp4']);
      expect(readFileSync(join(out, 'n.mp4'), 'utf8')).toBe('older');
    });
  });

  describe('renderer.render', () => {
    const render = (bin: string, ffmpeg: string, to: string) => createRenderer({ bin, ffmpeg, ffprobe: FFPROBE, measure }).render(composition(), to, () => {});
    const cli = (body: string) => script(`hf-${Math.random().toString(36).slice(2, 8)}`, `${OUTPUT}\n${body}`);
    it('the CLI fills the disk: RenderError naming the cause; nothing at the target, no temp file beside it', { timeout: T }, async () => {
      const out = mkdtempSync(join(dir, 'r1-'));
      const e = await render(cli(`head -c 30000 '${join(dir, 'good.mp4')}' > "$out"\necho '${NO_SPACE}' >&2\nexit 1`), FFMPEG, join(out, 'v.mp4')).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(RenderError);
      expect((e as Error).message).toContain('No space left on device');
      expect(everything(out)).toEqual([]);
    });
    it('the CLI exits 0 but its file is cut short (the disk filled as it finished): RenderError, nothing at the target', { timeout: T }, async () => {
      const out = mkdtempSync(join(dir, 'r2-'));
      const e = await render(cli(`cp '${join(dir, 'half.mp4')}' "$out"\nexit 0`), FFMPEG, join(out, 'v.mp4')).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(RenderError);
      expect(everything(out)).toEqual([]);
    });
    it('the loudness pass fills the disk: RenderError naming the cause; the CLI\'s file is removed too', { timeout: T }, async () => {
      const out = mkdtempSync(join(dir, 'r3-'));
      const quiet = join(dir, 'quiet.mp4');                                              // -40 LUFS: the pass has gain to add
      if (!existsSync(quiet)) {
        const r = await runProcess(FFMPEG, ['-y', '-v', 'error', '-i', join(dir, 'good.mp4'), '-af', 'volume=-25dB', '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', quiet], { timeoutMs: T });
        if (r.code !== 0) throw new Error(r.stderr);
      }
      const ffmpegFull = script('ffmpeg-full-2', `for a in "$@"; do [ "$a" = "-af" ] && { ${OUTPUT}; head -c 30000 '${quiet}' > "$out"; echo '${NO_SPACE}' >&2; exit 1; }; done\nexec '${FFMPEG}' "$@"`);
      const e = await render(cli(`cp '${quiet}' "$out"\nexit 0`), ffmpegFull, join(out, 'v.mp4')).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(RenderError);
      expect((e as Error).message).toContain('No space left on device');
      expect(everything(out)).toEqual([]);
    });
    it.skipIf(root)('a target whose folder cannot be made (read-only parent) is a RenderError, not a raw EACCES', { timeout: T }, async () => {
      const e = await render(cli('exit 0'), FFMPEG, join(locked, 'sub', 'v.mp4')).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(RenderError);
    });
    it.skipIf(root)('a target in a read-only folder: RenderError, nothing written', { timeout: T }, async () => {
      const e = await render(cli(`cp '${join(dir, 'good.mp4')}' "$out" || { echo "cannot write $out" >&2; exit 1; }`), FFMPEG, join(locked, 'v.mp4')).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(RenderError);
      expect(everything(locked)).toEqual([]);
    });
  });
});
