import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createMeasure } from '../adapters/measure.ts';
import type { Edit, Shot } from '../edit/types.ts';
import { checkInputs } from './inputs.ts';
import { FFMPEG, FFPROBE, SLOW, haveFfmpeg, makeImage, makeSound, makeVariableRate, makeVideo } from './samples.ts';

const W = 720;
const H = 1280;

type Media = Edit['media'];
function edit(media: Media, shots: Shot[], rest: Partial<Edit> = {}): Edit {
  return { version: 1, language: 'en', canvas: { width: W, height: H, fps: 30 }, frames: shots.reduce((n, s) => n + s.for, 0), media, shots, ...rest };
}
const shot = (id: string, at: number, length: number, media: string, more: Partial<Shot> = {}): Shot => ({ id, at, for: length, media, ...more });

describe.skipIf(!haveFfmpeg)('checkInputs with real files', () => {
  const measure = createMeasure(FFMPEG, FFPROBE);
  const dir = mkdtempSync(join(tmpdir(), 've-inputs-'));
  const assets = join(dir, 'assets');
  const clipSpec = { width: W, height: H, seconds: 2 };                        // 60 frames, 720x1280, 30 fps, keyframe every 30, BT.709 tags

  beforeAll(async () => {
    mkdirSync(assets);
    await makeVideo(join(assets, 'good.mp4'), clipSpec);
    await makeVideo(join(assets, 'fps24.mp4'), { ...clipSpec, fps: 24 });
    await makeVideo(join(assets, 'size.mp4'), { ...clipSpec, width: 704, height: 1264 });
    await makeVideo(join(assets, 'onekey.mp4'), { ...clipSpec, gop: 250 });
    await makeVideo(join(assets, 'untagged.mp4'), { ...clipSpec, tagged: false });
    await makeVideo(join(assets, 'fadein.mp4'), { ...clipSpec, boxes: [{ x: 0, y: 0, width: W, height: H, colour: 'black', from: 0, to: 4 }] });
    await makeVideo(join(assets, 'fadeout.mp4'), { ...clipSpec, boxes: [{ x: 0, y: 0, width: W, height: H, colour: 'black', from: 54, to: 59 }] });
    await makeVideo(join(assets, 'short.mp4'), { ...clipSpec, seconds: 1.2 });   // 36 frames
    writeFileSync(join(assets, 'cut.mp4'), readFileSync(join(assets, 'good.mp4')).subarray(0, 9000));
    await makeImage(join(assets, 'big.png'), 1080, 1920);
    await makeImage(join(assets, 'tiny.png'), 300, 300);
    await makeSound(join(assets, 'music.mp3'), { db: -12 });
    await makeSound(join(assets, 'silent.mp3'), { silent: true });
    await makeSound(join(assets, 'blip.wav'), { seconds: 0.1, db: -12 });
    await makeSound(join(assets, 'blip-silent.wav'), { seconds: 0.1, silent: true });
    await makeVariableRate(join(assets, 'vfr.mp4'));
  }, SLOW);

  const one = (kind: 'video' | 'image' | 'audio', file: string) => ({ clip: { file: `assets/${file}`, kind } });
  const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

  it('a good set of files raises nothing', async () => {
    const e = edit({ ...one('video', 'good.mp4'), still: { file: 'assets/big.png', kind: 'image' }, card: { file: 'assets/big.png', kind: 'image' }, music: { file: 'assets/music.mp3', kind: 'audio' } },
      [shot('a', 0, 30, 'clip'), shot('b', 30, 30, 'still', { in: { kind: 'crossfade', frames: 8 } }), shot('c', 60, 30, 'clip', { from: 30 })],
      { cards: [{ id: 'proof', at: 5, for: 20, media: 'card', box: { left: 10, top: 30, right: 90, bottom: 60 } }] });
    expect(await checkInputs(e, dir, measure)).toEqual([]);
  }, SLOW);

  it('media-missing: error, the fix names the path expected', async () => {
    const issues = await checkInputs(edit(one('video', 'gone.mp4'), [shot('a', 0, 30, 'clip')]), dir, measure);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'media-missing', severity: 'error', target: 'clip' });
    expect(issues[0]!.fix).toContain(join(dir, 'assets/gone.mp4'));
  }, SLOW);

  it('media-corrupt: a file cut short, and text named .mp4, are errors that say to make the file again', async () => {
    for (const name of ['cut.mp4']) {
      const issues = await checkInputs(edit(one('video', name), [shot('a', 0, 30, 'clip')]), dir, measure);
      expect(codes(issues)).toEqual(['media-corrupt']);
      expect(issues[0]).toMatchObject({ severity: 'error', target: 'clip' });
      expect(issues[0]!.fix).toMatch(/again|re-?generate|replace/i);
    }
    writeFileSync(join(assets, 'words.png'), 'not a picture');
    expect(codes(await checkInputs(edit(one('image', 'words.png'), [shot('a', 0, 30, 'clip')]), dir, measure))).toEqual(['media-corrupt']);
  }, SLOW);

  it('media-corrupt: a sound file declared as a picture, and a clip with no sound declared as sound', async () => {
    expect(codes(await checkInputs(edit(one('image', 'music.mp3'), [shot('a', 0, 30, 'clip')]), dir, measure))).toEqual(['media-corrupt']);
    expect(codes(await checkInputs(edit(one('audio', 'good.mp4'), [shot('a', 0, 30, 'clip')]), dir, measure))).toEqual(['media-corrupt']);   // no sound in it
  }, SLOW);

  it('media-fps: 24 fps clip on a 30 fps canvas is an error that says to normalise it', async () => {
    const issues = await checkInputs(edit(one('video', 'fps24.mp4'), [shot('a', 0, 30, 'clip')]), dir, measure);
    expect(codes(issues)).toEqual(['media-fps']);
    expect(issues[0]).toMatchObject({ severity: 'error', target: 'clip' });
    expect(issues[0]!.fix).toContain('viraleditor normalize');
    expect(issues[0]!.message).toContain('24');
  }, SLOW);

  it('media-size: a clip of another size is a warning that names both sizes', async () => {
    const issues = await checkInputs(edit(one('video', 'size.mp4'), [shot('a', 0, 30, 'clip')]), dir, measure);
    expect(codes(issues)).toEqual(['media-size']);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.message).toContain('704x1264');
    expect(issues[0]!.message).toContain(`${W}x${H}`);
    expect(issues[0]!.fix).toContain('viraleditor normalize');
  }, SLOW);

  it('media-keyframes: one keyframe in two seconds is a warning', async () => {
    const issues = await checkInputs(edit(one('video', 'onekey.mp4'), [shot('a', 0, 30, 'clip')]), dir, measure);
    expect(codes(issues)).toEqual(['media-keyframes']);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.fix).toContain('viraleditor normalize');
  }, SLOW);

  it('media-colour: a clip with no BT.709 tags is a warning', async () => {
    const issues = await checkInputs(edit(one('video', 'untagged.mp4'), [shot('a', 0, 30, 'clip')]), dir, measure);
    expect(codes(issues)).toEqual(['media-colour']);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.fix).toContain('viraleditor normalize');
  }, SLOW);

  it('media-short: from + for + tail frames are needed; the issue says needed and available; a cut needs no tail', async () => {
    const media = { ...one('video', 'short.mp4'), other: { file: 'assets/good.mp4', kind: 'video' as const } };   // clip: 36 frames
    expect(await checkInputs(edit(media, [shot('a', 0, 30, 'clip'), shot('b', 30, 30, 'other', { in: { kind: 'cut' } })]), dir, measure)).toEqual([]);
    const issues = await checkInputs(edit(media, [shot('a', 0, 30, 'clip'), shot('b', 30, 30, 'other', { in: { kind: 'crossfade', frames: 8 } })]), dir, measure);
    expect(codes(issues)).toEqual(['media-short']);
    expect(issues[0]).toMatchObject({ severity: 'error', target: 'clip', at: 0 });
    expect(issues[0]!.message).toContain('38');
    expect(issues[0]!.message).toContain('36');
    expect(issues[0]!.fix).toMatch(/longer|from|shorten|2 more/i);
    const late = await checkInputs(edit(media, [shot('a', 0, 30, 'clip', { from: 10 })]), dir, measure);   // from 10 + 30 = 40 > 36
    expect(codes(late)).toEqual(['media-short']);
  }, SLOW);

  it('media-black-edge: black frames at the start or the end of the part a shot uses are a warning that gives the from or the frames to cut', async () => {
    const head = await checkInputs(edit(one('video', 'fadein.mp4'), [shot('a', 0, 30, 'clip')]), dir, measure);
    expect(codes(head)).toEqual(['media-black-edge']);
    expect(head[0]).toMatchObject({ severity: 'warning', target: 'clip', at: 0 });
    expect(head[0]!.fix).toContain('"from" to 5');
    const tail = await checkInputs(edit(one('video', 'fadeout.mp4'), [shot('a', 0, 30, 'clip', { from: 30 })]), dir, measure);   // uses source frames 30-59; 54-59 are black
    expect(codes(tail)).toEqual(['media-black-edge']);
    expect(tail[0]!.fix).toContain('by 6 frames');
    expect(tail[0]!.fix).toMatch(/template/);                    // a template-driven run cannot move "from": it is told what it can do
    expect(tail[0]!.fix).toMatch(/last part/);
    expect(head[0]!.fix).not.toMatch(/template/);
    // the used part is black from start to end: no impossible "from"
    const whole = await checkInputs(edit(one('video', 'fadein.mp4'), [shot('a', 0, 3, 'clip')]), dir, measure);
    expect(codes(whole)).toEqual(['media-black-edge']);
    expect(whole[0]!.message).toContain('black from start to end');
    expect(whole[0]!.fix).toMatch(/another clip/);
    expect(whole[0]!.fix).not.toMatch(/"from" to \d/);
    // the black is in a part the shot does not use
    expect(await checkInputs(edit(one('video', 'fadein.mp4'), [shot('a', 0, 30, 'clip', { from: 10 })]), dir, measure)).toEqual([]);
    expect(await checkInputs(edit(one('video', 'fadeout.mp4'), [shot('a', 0, 30, 'clip', { from: 10 })]), dir, measure)).toEqual([]);
  }, SLOW);

  it('image-small: an image smaller than the box it fills is a warning with the pixels needed', async () => {
    const e = edit({ ...one('video', 'good.mp4'), card: { file: 'assets/tiny.png', kind: 'image' } }, [shot('a', 0, 30, 'clip')],
      { cards: [{ id: 'proof', at: 5, for: 20, media: 'card', box: { left: 10, top: 30, right: 90, bottom: 60 } }] });
    const issues = await checkInputs(e, dir, measure);
    expect(codes(issues)).toEqual(['image-small']);
    expect(issues[0]).toMatchObject({ severity: 'warning', target: 'card' });
    expect(issues[0]!.message).toContain('300x300');
    expect(issues[0]!.message).toContain('576x384');
    expect(issues[0]!.fix).toContain('576x384');
  }, SLOW);

  it('image-small: a small image as a full-frame shot is too small for the canvas', async () => {
    const issues = await checkInputs(edit(one('image', 'tiny.png'), [shot('a', 0, 30, 'clip')]), dir, measure);
    expect(codes(issues)).toEqual(['image-small']);
    expect(issues[0]!.message).toContain(`${W}x${H}`);
  }, SLOW);

  it('audio-silent: a silent music file is a warning that asks for another file', async () => {
    const e = edit({ ...one('video', 'good.mp4'), music: { file: 'assets/silent.mp3', kind: 'audio' } }, [shot('a', 0, 30, 'clip')], { audio: { music: { media: 'music', gain: 1 } } });
    const issues = await checkInputs(e, dir, measure);
    expect(codes(issues)).toEqual(['audio-silent']);
    expect(issues[0]).toMatchObject({ severity: 'warning', target: 'music' });
    expect(issues[0]!.fix).toMatch(/another|different|new/i);
  }, SLOW);

  it('audio shorter than the loudness window is not judged silent (its integrated loudness reads the floor, -70 LUFS)', async () => {
    const as = (file: string) => edit({ ...one('video', 'good.mp4'), music: { file: `assets/${file}`, kind: 'audio' } }, [shot('a', 0, 30, 'clip')], { audio: { music: { media: 'music', gain: 1 } } });
    expect(await checkInputs(as('blip.wav'), dir, measure)).toEqual([]);              // audible, 0.1 s
    expect(await checkInputs(as('blip-silent.wav'), dir, measure)).toEqual([]);       // not judged either way: too short to measure
  }, SLOW);

  it('a variable frame rate is a warning that says so and names the normalise command', async () => {
    const issues = (await checkInputs(edit(one('video', 'vfr.mp4'), [shot('a', 0, 30, 'clip')]), dir, measure)).filter((i) => /variable frame rate/.test(i.message));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'media-vfr', severity: 'warning', target: 'clip' });
    expect(issues[0]!.fix).toContain('viraleditor normalize');
  }, SLOW);

  it('the normalise fix is the real command: input, output and the canvas', async () => {
    const issues = await checkInputs(edit(one('video', 'fps24.mp4'), [shot('a', 0, 30, 'clip')]), dir, measure);
    expect(issues[0]!.fix).toContain(`viraleditor normalize ${join(dir, 'assets/fps24.mp4')} ${join(dir, 'assets/fps24-norm.mp4')} --canvas 720x1280`);
    expect(issues[0]!.fix).not.toMatch(/hyperframes/);
  }, SLOW);

  it('when ffprobe itself cannot start, that is ONE issue about the tool, not a corrupt file for every media entry', async () => {
    const broken = createMeasure('/nonexistent/ffmpeg', '/nonexistent/ffprobe');
    const e = edit({ ...one('video', 'good.mp4'), still: { file: 'assets/big.png', kind: 'image' }, music: { file: 'assets/music.mp3', kind: 'audio' } }, [shot('a', 0, 30, 'clip'), shot('b', 30, 30, 'still')]);
    const issues = await checkInputs(e, dir, broken);
    expect(codes(issues)).toEqual(['tool-failed']);
    expect(issues[0]).toMatchObject({ severity: 'error', target: null });
    expect(issues[0]!.message).toMatch(/ffprobe/);
    expect(issues[0]!.fix).toMatch(/viraleditor doctor|install/i);
  }, SLOW);
});
