import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FFMPEG, FFPROBE, SLOW, ff, haveFfmpeg, makeImage, makeOffset, makeSound, makeVariableRate, makeVideo } from '../quality/samples.ts';
import { barFilter, readBar } from './framebar.ts';
import { MediaError } from './media.ts';
import { ToolUnavailable, createMeasure } from './measure.ts';

describe.skipIf(!haveFfmpeg)('createMeasure with real ffmpeg', () => {
  const measure = createMeasure(FFMPEG, FFPROBE);
  const dir = mkdtempSync(join(tmpdir(), 've-measure-test-'));
  const p = (name: string) => join(dir, name);

  beforeAll(async () => {
    await makeVideo(p('tagged.mp4'), { seconds: 3, sound: { db: -20 } });                       // 90 frames, keyframes every 30
    await makeVideo(p('untagged.mp4'), { seconds: 2, tagged: false, gop: 250 });                // one keyframe, no tags
    await makeVideo(p('black.mp4'), { seconds: 2, boxes: [{ x: 0, y: 0, width: 270, height: 480, colour: 'black', from: 20, to: 29 }] });
    await makeVideo(p('frozen.mp4'), { seconds: 3, freeze: { first: 30, last: 69 } });
    await makeVideo(p('frozen-all.mp4'), { seconds: 1, freeze: { first: 0, last: 29 } });
    await makeVideo(p('peak20.mp4'), { seconds: 3, sound: { db: -20 } });
    await ff(['-f', 'lavfi', '-i', 'testsrc2=size=270x480:rate=24:duration=3', '-vf', barFilter({ width: 270, height: 480, fps: 24 }),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '8', '-g', '7', '-pix_fmt', 'yuv420p', p('bar.mp4')]);   // 72 frames, each names itself
    await makeSound(p('silent.mp3'), { silent: true });
    await ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', '-af', "volume='if(lt(t,2),0.03,0.3)':eval=frame", p('steps.wav')]);   // 2 s at about -52 LUFS, 2 s at -32
    await makeImage(p('img.png'), 200, 100);
    writeFileSync(p('junk.mp4'), 'hello');
    await makeVideo(p('black-end.mp4'), { seconds: 2, boxes: [{ x: 0, y: 0, width: 270, height: 480, colour: 'black', from: 40, to: 59 }] });
    await makeVideo(p('grey.mp4'), { seconds: 1, background: '#202020', noise: 6 });
    await makeOffset(p('offset.mp4'), 0.5, { from: 20, to: 29 });
    await makeVariableRate(p('vfr.mp4'));
  }, SLOW);

  it('streams: size, rate, frames, codec, pixel format, colour tags, keyframes, sound', async () => {
    const s = await measure.streams(p('tagged.mp4'));
    expect(s).toMatchObject({ width: 270, height: 480, fps: 30, frames: 90, codec: 'h264', pixelFormat: 'yuv420p', audio: true });
    expect(s.colour).toEqual({ space: 'bt709', transfer: 'bt709', primaries: 'bt709' });
    expect(s.keyframes).toEqual([0, 30, 60]);
    expect(s.sound).toMatchObject({ codec: 'aac', sampleRate: 48000, channels: 1 });
  }, SLOW);

  it('streams: an untagged clip has null tags, a single keyframe and no sound', async () => {
    const s = await measure.streams(p('untagged.mp4'));
    expect(s.colour).toEqual({ space: null, transfer: null, primaries: null });
    expect(s.keyframes).toEqual([0]);
    expect(s.sound).toBeNull();
    expect(s.audio).toBe(false);
  }, SLOW);

  it('streams: a sound file has a sound stream and no picture; an image is one frame', async () => {
    const a = await measure.streams(p('silent.mp3'));
    expect(a).toMatchObject({ width: 0, height: 0, frames: 0, audio: true });
    expect(a.sound).toMatchObject({ codec: 'mp3', sampleRate: 44100, channels: 2 });
    expect(await measure.streams(p('img.png'))).toMatchObject({ width: 200, height: 100, frames: 1, keyframes: [0] });
  }, SLOW);

  it('streams: typed errors for a missing file, text, and a file cut short', async () => {
    await expect(measure.streams(p('absent.mp4'))).rejects.toMatchObject({ name: 'MediaError', code: 'not-found' });
    await expect(measure.streams(p('junk.mp4'))).rejects.toMatchObject({ code: 'not-media' });
    const bytes = readFileSync(p('tagged.mp4'));
    writeFileSync(p('cut.mp4'), bytes.subarray(0, 9000));                  // faststart file: the header is there, the pictures are not
    await expect(measure.streams(p('cut.mp4'))).rejects.toBeInstanceOf(MediaError);
  }, SLOW);

  it('black: the run of ten black frames, in frames; none on a clip without one', async () => {
    expect(await measure.black(p('black.mp4'))).toEqual([{ at: 20, for: 10 }]);
    expect(await measure.black(p('tagged.mp4'))).toEqual([]);
  }, SLOW);

  it('frozen: the longest run lies inside the frozen frames 30-69 (at crf 14 ultrafast the encoder settles for a few frames and the run may come in pieces; nothing is joined); none on moving footage; a clip frozen from frame 0', async () => {
    const runs = await measure.frozen(p('frozen.mp4'));
    const longest = runs.reduce((a, r) => (r.for > a.for ? r : a));
    expect(longest.for).toBeGreaterThanOrEqual(20);          // 40 frames frozen; about 23 read at this setting
    expect(longest.at).toBeGreaterThanOrEqual(30);
    expect(longest.at + longest.for).toBeLessThanOrEqual(72);
    expect(await measure.frozen(p('tagged.mp4'))).toEqual([]);
    const all = await measure.frozen(p('frozen-all.mp4'));
    expect(all.length).toBeGreaterThan(0);                           // possibly in pieces: nothing is joined
    expect(all[0]!.at).toBeLessThanOrEqual(8);
    expect(all[all.length - 1]!.at + all[all.length - 1]!.for).toBe(30);                       // a freeze that lasts to the last frame is closed at the end of the file
  }, SLOW);

  it('loudness: integrated, true peak and range of a sine; null without sound', async () => {
    const l = await measure.loudness(p('peak20.mp4'));   // a sine peaking at -20 dBFS: about -23.7 LUFS
    expect(l).not.toBeNull();
    expect(l!.integrated).toBeGreaterThan(-25);
    expect(l!.integrated).toBeLessThan(-22);
    expect(l!.truePeak).toBeLessThan(-19);
    expect(l!.truePeak).toBeGreaterThan(-21);
    expect(await measure.loudness(p('untagged.mp4'))).toBeNull();
  }, SLOW);

  it('momentary: a value every 100 ms, stepping up where the tone gets louder; [] without sound', async () => {
    const m = await measure.momentary(p('steps.wav'));
    expect(m.length).toBeGreaterThanOrEqual(39);
    expect(m.length).toBeLessThanOrEqual(41);
    expect(m[10]!).toBeCloseTo(-52, 0);                                       // inside the quiet half
    expect(m[35]!).toBeCloseTo(-32, 0);                                       // inside the loud half
    const step = m.findIndex((value, i) => i > 3 && value > m[i - 1]! + 3);
    expect(step).toBe(20);                                                    // 2 s = value 20: the first window that holds loud sound
    expect(m.slice(0, 3)).toEqual([-Infinity, -Infinity, -Infinity]);         // not a full 400 ms yet
    expect(await measure.momentary(p('untagged.mp4'))).toEqual([]);
  }, SLOW);

  it('loudness: silence is -70 LUFS and a -inf peak', async () => {
    const l = await measure.loudness(p('silent.mp3'));
    expect(l!.integrated).toBeLessThanOrEqual(-70);
    expect(l!.truePeak).toBe(-Infinity);
  }, SLOW);

  it('picture: exactly the asked frame, off keyframes too (read back from the frame bar)', async () => {
    for (const n of [0, 1, 6, 7, 8, 37, 71]) {
      const pic = await measure.picture(p('bar.mp4'), n);
      expect([pic.width, pic.height, pic.rgb.length]).toEqual([270, 480, 270 * 480 * 3]);
      expect(readBar(pic.rgb, pic.width, pic.height), `frame ${n}`).toBe(n);
    }
  }, SLOW);

  it('picture: a frame past the end is a typed error', async () => {
    await expect(measure.picture(p('bar.mp4'), 72)).rejects.toMatchObject({ code: 'tool-failed' });
    await expect(measure.picture(p('absent.mp4'), 0)).rejects.toMatchObject({ code: 'not-found' });
  }, SLOW);

  it('black: a run that reaches the last frame is counted whole (frames 40-59 of 60); the mid-file run stays right', async () => {
    expect(await measure.black(p('black-end.mp4'))).toEqual([{ at: 40, for: 20 }]);
    expect(await measure.black(p('black.mp4'))).toEqual([{ at: 20, for: 10 }]);
  }, SLOW);

  it('black: a dark grey picture (#202020) is not black', async () => {
    expect(await measure.black(p('grey.mp4'))).toEqual([]);
  }, SLOW);

  it('black: frame numbers count from the first picture when the picture starts 0.5 s after the sound', async () => {
    expect((await measure.streams(p('offset.mp4'))).frames).toBe(90);
    expect(await measure.black(p('offset.mp4'))).toEqual([{ at: 20, for: 10 }]);
  }, SLOW);

  it('streams: constantRate is true for an ordinary clip and false for a variable-rate one', async () => {
    expect((await measure.streams(p('tagged.mp4'))).constantRate).toBe(true);
    expect((await measure.streams(p('vfr.mp4'))).constantRate).toBe(false);
  }, SLOW);

  it('one full probe per file: streams, black, frozen, loudness and picture share it; picture alone never counts frames', async () => {
    const log = p('probe.log');
    const wrapper = p('ffprobe-spy.sh');
    writeFileSync(wrapper, `#!/bin/sh\necho "$*" >> '${log}'\nexec ${FFPROBE} "$@"\n`);
    chmodSync(wrapper, 0o755);
    const spy = createMeasure(FFMPEG, wrapper);
    await spy.streams(p('tagged.mp4'));
    await spy.black(p('tagged.mp4'));
    await spy.frozen(p('tagged.mp4'));
    await spy.loudness(p('tagged.mp4'));
    for (const n of [3, 4, 5]) await spy.picture(p('tagged.mp4'), n);
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    expect(calls).toHaveLength(2);                                  // the JSON probe and the keyframe packets, once
    await spy.picture(p('bar.mp4'), 2);                             // a file never probed: one light probe
    const after = readFileSync(log, 'utf8').trim().split('\n');
    expect(after).toHaveLength(3);
    expect(after[2]).not.toContain('count_frames');
  }, SLOW);

  it('a tool that cannot be started is ToolUnavailable (a MediaError that names the tool), not a fault of the file', async () => {
    const broken = createMeasure('/nonexistent/ffmpeg', '/nonexistent/ffprobe');
    const error = await broken.streams(p('tagged.mp4')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolUnavailable);
    expect(error).toBeInstanceOf(MediaError);
    expect(error).toMatchObject({ code: 'tool-failed', bin: '/nonexistent/ffprobe' });
    await expect(broken.streams(p('absent.mp4'))).rejects.toMatchObject({ code: 'not-found' });      // a missing file is still the file's fault
  }, SLOW);
});
