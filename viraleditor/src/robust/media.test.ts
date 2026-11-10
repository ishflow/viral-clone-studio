// C6 case 5: corrupt and odd media through media.probe / normalize, measure and checkInputs.
// Every call ends in a coded refusal (MediaError) or a correct result: never a hang, never a foreign exception, never a quiet wrong answer.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runProcess } from '../adapters/exec.ts';
import { createMeasure } from '../adapters/measure.ts';
import { MediaError, createMedia } from '../adapters/media.ts';
import { shortEdit } from '../compose/fixture.ts';
import { checkInputs } from '../quality/inputs.ts';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const have = existsSync(FFMPEG) && existsSync(FFPROBE);
const T = 120_000;
const CANVAS = { width: 720, height: 1280, fps: 30, audio: true };

describe.skipIf(!have)('odd and broken media (C6 case 5)', () => {
  const dir = mkdtempSync(join(tmpdir(), 've-robust-media-'));
  const at = (name: string) => join(dir, name);
  const media = createMedia(FFMPEG, FFPROBE);
  const measure = createMeasure(FFMPEG, FFPROBE);
  const ff = async (args: string[]) => {
    const r = await runProcess(FFMPEG, ['-y', '-v', 'error', '-nostdin', ...args], { timeoutMs: T });
    if (r.code !== 0) throw new Error(r.stderr);
  };
  /** The error a call ends with, or null when it succeeds. */
  const failure = async (work: () => Promise<unknown>): Promise<unknown> => work().then(() => null, (e: unknown) => e);

  beforeAll(async () => {
    await ff(['-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=3', '-f', 'lavfi', '-i', 'sine=d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', at('good.mp4')]);
    writeFileSync(at('truncated.mp4'), readFileSync(at('good.mp4')).subarray(0, 40_000));                          // moov at the end: never written
    await ff(['-i', at('good.mp4'), '-c', 'copy', '-movflags', '+faststart', at('fast.mp4')]);
    const fast = readFileSync(at('fast.mp4'));
    writeFileSync(at('truncated-fast.mp4'), fast.subarray(0, Math.floor(fast.length / 2)));                          // moov first: the header promises 3 s, half the data is there
    writeFileSync(at('zero.mp4'), '');
    copyFileSync(at('good.mp4'), at('video-named.png'));
    await ff(['-f', 'lavfi', '-i', 'color=c=red@0.5:s=720x1280,format=rgba', '-frames:v', '1', at('alpha.png')]);
    await ff(['-f', 'lavfi', '-i', 'sine=d=3', '-c:a', 'aac', at('no-video.mp4')]);
    await ff(['-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=3', '-vf', "select='gt(n\\,45)+not(eq(mod(n\\,3)\\,0))'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', at('vfr.mp4')]);
    await ff(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', at('landscape.mp4')]);
    await ff(['-display_rotation', '90', '-i', at('landscape.mp4'), '-c', 'copy', at('rotated.mp4')]);                // stored 1280x720, shown 720x1280 (a phone clip)
    await ff(['-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=2', '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1',
      '-x265-params', 'log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', at('hdr10.mp4')]);
    await ff(['-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=2', '-vf', 'scale=721:1281,format=yuv444p', '-c:v', 'libx264', at('odd.mp4')]);   // testsrc2 itself rounds to even
    await ff(['-f', 'lavfi', '-i', 'sine=d=0.1', '-c:a', 'aac', at('short.m4a')]);
    await ff(['-f', 'lavfi', '-i', 'testsrc2=s=8000x8000', '-frames:v', '1', at('huge.png')]);
    copyFileSync(at('good.mp4'), at(`my clip 'q" ñöü.mp4`));
    copyFileSync(at('good.mp4'), at('-dash.mp4'));
  }, T);

  it('a file cut short, a zero-byte file and a sound file are coded refusals of probe, normalize and streams; nothing is written', { timeout: T }, async () => {
    for (const name of ['truncated.mp4', 'truncated-fast.mp4', 'zero.mp4', 'no-video.mp4']) {
      const to = at(`out-${name}`);
      for (const work of [() => media.probe(at(name)), () => media.normalize(at(name), to, CANVAS)]) {
        const e = await failure(work);
        expect(e, name).toBeInstanceOf(MediaError);
        expect((e as MediaError).code, name).toBe('not-media');
      }
      expect(existsSync(to), name).toBe(false);
    }
    for (const name of ['truncated.mp4', 'truncated-fast.mp4', 'zero.mp4']) {
      expect(await failure(() => measure.streams(at(name))), name).toMatchObject({ code: 'not-media' });
    }
    expect(readdirSync(dir).filter((n) => n.includes('.tmp'))).toEqual([]);
  });

  it('a clip whose header promises more than its data holds is refused by probe (before: 44 of 90 frames, 3 s, and normalize made a 1.5 s clip quietly)', { timeout: T }, async () => {
    expect(await failure(() => media.probe(at('truncated-fast.mp4')))).toMatchObject({ code: 'not-media' });
  });

  it('a wrong extension does not matter: the content decides (an mp4 named .png, a png named .mp4)', { timeout: T }, async () => {
    expect(await media.probe(at('video-named.png'))).toMatchObject({ width: 720, height: 1280, fps: 30, frames: 90, audio: true });
    copyFileSync(at('alpha.png'), at('png-named.mp4'));
    expect(await media.probe(at('png-named.mp4'))).toMatchObject({ width: 720, height: 1280, frames: 1, audio: false });
  });

  it('a clip with rotation metadata is described as it is shown: 720x1280, in probe, streams and picture (before: 1280x720, and picture read a 720-wide frame as 1280 wide)', { timeout: T }, async () => {
    expect(await media.probe(at('rotated.mp4'))).toMatchObject({ width: 720, height: 1280, frames: 90 });
    expect(await measure.streams(at('rotated.mp4'))).toMatchObject({ width: 720, height: 1280, frames: 90 });
    const p = await measure.picture(at('rotated.mp4'), 0);
    expect({ width: p.width, height: p.height }).toEqual({ width: 720, height: 1280 });
    expect(await media.normalize(at('rotated.mp4'), at('rotated-norm.mp4'), CANVAS)).toMatchObject({ width: 720, height: 1280, frames: 90 });
  });

  it('a photo with EXIF orientation 6 is described as it is shown (200x400, as ffmpeg decodes it and Chrome draws it), in probe, streams and picture; the orientation lives on the frame, not on the stream (M6 of C6)', { timeout: T }, async () => {
    await ff(['-f', 'lavfi', '-i', 'testsrc2=s=400x200:r=1', '-frames:v', '1', at('plain.jpg')]);
    const tiff = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);   // big-endian TIFF, one entry: Orientation = 6 (turn 90° to show it)
    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const segment = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
    const jpg = readFileSync(at('plain.jpg'));
    writeFileSync(at('exif6.jpg'), Buffer.concat([jpg.subarray(0, 2), segment, jpg.subarray(2)]));
    expect(await media.probe(at('plain.jpg'))).toMatchObject({ width: 400, height: 200, frames: 1 });                  // no orientation: as stored
    expect(await media.probe(at('exif6.jpg'))).toMatchObject({ width: 200, height: 400, frames: 1 });
    expect(await measure.streams(at('exif6.jpg'))).toMatchObject({ width: 200, height: 400, frames: 1 });
    const p = await measure.picture(at('exif6.jpg'), 0);
    expect({ width: p.width, height: p.height }).toEqual({ width: 200, height: 400 });
    expect(p.rgb.length).toBe(200 * 400 * 3);
  });

  it('an untagged SD clip turned by rotation metadata keeps its colour through normalize: the matrix is guessed on the stored size, not the shown one (fix round 1: the shown size flipped 640x480 to 709)', { timeout: T }, async () => {
    await ff(['-f', 'lavfi', '-i', 'color=c=0x288C46:s=640x480:r=30:d=1', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-crf', '1', at('sd.mp4')]);   // BT.601, as ffmpeg converts by default; no tag
    await ff(['-display_rotation', '90', '-i', at('sd.mp4'), '-c', 'copy', at('sd-rotated.mp4')]);
    for (const name of ['sd.mp4', 'sd-rotated.mp4']) {
      const to = at(`colour-${name}`);
      await media.normalize(at(name), to, { ...CANVAS, audio: false });
      const p = await measure.picture(to, 0);
      const i = (640 * p.width + 360) * 3;
      const pixel = [p.rgb[i]!, p.rgb[i + 1]!, p.rgb[i + 2]!];
      expect(pixel.map((c, k) => Math.abs(c - [40, 140, 70][k]!)).every((d) => d <= 3), `${name}: ${pixel.join(',')}`).toBe(true);
    }
  });

  it('a clip whose container lasts longer than its picture (sound runs on) is accepted as it is: no damage, 60 frames, 3 s', { timeout: T }, async () => {
    await ff(['-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=2', '-f', 'lavfi', '-i', 'sine=d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', at('long-sound.mp4')]);
    expect(await media.probe(at('long-sound.mp4'))).toMatchObject({ width: 720, height: 1280, frames: 60, audio: true });
    expect((await media.probe(at('long-sound.mp4'))).seconds).toBeGreaterThan(2.9);
    expect(await measure.streams(at('long-sound.mp4'))).toMatchObject({ frames: 60, constantRate: true });
  });

  it('a file name with spaces, quotes and letters outside ASCII; a relative name that starts with a dash', { timeout: T }, async () => {
    const odd = at(`my clip 'q" ñöü.mp4`);
    expect(await media.probe(odd)).toMatchObject({ width: 720, height: 1280, frames: 90 });
    expect(await measure.streams(odd)).toMatchObject({ frames: 90 });
    expect(await media.normalize(odd, at(`ñöü 'out".mp4`), CANVAS)).toMatchObject({ frames: 90 });
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      expect(await media.probe('-dash.mp4')).toMatchObject({ frames: 90 });            // before: ffprobe read it as an option ("Missing argument for option 'dash.mp4'")
      expect(await measure.streams('-dash.mp4')).toMatchObject({ frames: 90 });
      expect(await media.normalize('-dash.mp4', '-dash-norm.mp4', CANVAS)).toMatchObject({ frames: 90 });
    } finally { process.chdir(cwd); }
  });

  it('an odd size (721x1281, 4:4:4), a PNG with alpha and an 8000x8000 picture normalize to the canvas', { timeout: T }, async () => {
    expect(await media.probe(at('odd.mp4'))).toMatchObject({ width: 721, height: 1281 });
    expect(await media.normalize(at('odd.mp4'), at('odd-norm.mp4'), CANVAS)).toMatchObject({ width: 720, height: 1280, frames: 60 });
    expect(await media.normalize(at('alpha.png'), at('alpha-norm.mp4'), CANVAS)).toMatchObject({ width: 720, height: 1280, frames: 1 });
    expect(await media.probe(at('huge.png'))).toMatchObject({ width: 8000, height: 8000, frames: 1 });
    expect(await media.normalize(at('huge.png'), at('huge-norm.mp4'), CANVAS)).toMatchObject({ width: 720, height: 1280, frames: 1 });
  });

  it('a variable-rate clip: streams says so, and normalize gives a constant 30 fps of the same length', { timeout: T }, async () => {
    const s = await measure.streams(at('vfr.mp4'));
    expect(s.constantRate).toBe(false);
    const n = await media.normalize(at('vfr.mp4'), at('vfr-norm.mp4'), CANVAS);
    expect(n.frames).toBe(89);
    expect((await measure.streams(at('vfr-norm.mp4'))).constantRate).toBe(true);
  });

  it('a 0.1 s sound: probe refuses it as a picture source; streams and loudness answer', { timeout: T }, async () => {
    expect(await failure(() => media.probe(at('short.m4a')))).toMatchObject({ code: 'not-media' });
    expect(await measure.streams(at('short.m4a'))).toMatchObject({ width: 0, audio: true });
    expect(await measure.loudness(at('short.m4a'))).not.toBeNull();
  });

  // FINDING 5: no tone-mapping filter in this ffmpeg (no zscale / libplacebo); normalize reads PQ as BT.709 and tags the result BT.709: washed-out colour, no error.
  it('FINDING 5 (today): normalize converts the HDR clip without an error and tags the result BT.709', { timeout: T }, async () => {
    expect(await media.normalize(at('hdr10.mp4'), at('hdr-today.mp4'), CANVAS)).toMatchObject({ width: 720, height: 1280, frames: 60 });
    expect((await measure.streams(at('hdr-today.mp4'))).colour).toEqual({ space: 'bt709', transfer: 'bt709', primaries: 'bt709' });
  });
  it.fails('FINDING 5: an HDR (PQ, BT.2020, 10-bit) clip is refused by normalize, or tone-mapped; today it is converted quietly with the wrong transfer', { timeout: T }, async () => {
    expect(await failure(() => media.normalize(at('hdr10.mp4'), at('hdr-norm.mp4'), CANVAS))).toBeInstanceOf(MediaError);
  });

  describe('checkInputs', () => {
    /** The issues checkInputs finds for media `a` of the short document (720 canvas) when `a` is `name`. */
    async function issuesFor(name: string) {
      const project = mkdtempSync(join(dir, 'project-'));
      mkdirSync(join(project, 'assets'));
      copyFileSync(at(name), join(project, 'assets', 'a.mp4'));
      return (await checkInputs(shortEdit(720), project, measure)).filter((i) => i.target === 'a');
    }
    it('a broken or empty file is media-corrupt; a sound file declared as video is media-corrupt', { timeout: T }, async () => {
      for (const name of ['truncated.mp4', 'truncated-fast.mp4', 'zero.mp4', 'no-video.mp4']) {
        expect((await issuesFor(name)).map((i) => i.code), name).toContain('media-corrupt');
      }
    });
    // FINDING 6: quality/inputs.ts reads `fps` (r_frame_rate, 30) but never `constantRate`: a variable-rate source passes, and its frame numbers are not its times.
    it('FINDING 6 (today): a variable-rate clip gets no error, and streams says it is not constant', { timeout: T }, async () => {
      expect((await issuesFor('vfr.mp4')).filter((i) => i.severity === 'error')).toEqual([]);
      expect((await measure.streams(at('vfr.mp4'))).constantRate).toBe(false);
    });
    it.fails('FINDING 6: a variable-rate clip gets an issue', { timeout: T }, async () => {
      expect((await issuesFor('vfr.mp4')).filter((i) => i.severity === 'error').map((i) => i.code)).not.toEqual([]);
    });
  });
});
