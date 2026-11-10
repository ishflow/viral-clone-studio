import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { MediaError } from '../adapters/media.ts';
import { ToolUnavailable, createMeasure } from '../adapters/measure.ts';
import type { Timeline } from '../edit/timeline.ts';
import { checkOutput } from './output.ts';
import { FFMPEG, FFPROBE, SLOW, type Box, type VideoSpec, haveFfmpeg, makeOffset, makeTimeline, makeVariableRate, makeVideo } from './samples.ts';

const RECT = { x: 20, y: 200, width: 230, height: 40 };
/** Six "letters": solid bars in the fill colour inside RECT, on frames 20 … 79. */
function letters(colour: string, at = RECT, from = 20, to = 79): Box[] {
  return Array.from({ length: 6 }, (_, i) => ({ x: at.x + 6 + i * 36, y: at.y + 6, width: 24, height: 28, colour, from, to }));
}
/** White "clouds": three bars along the top of RECT, on every frame (footage that has near-white pixels of its own). */
function clouds(): Box[] {
  return [0, 1, 2].map((i) => ({ x: RECT.x + 10 + i * 70, y: RECT.y, width: 60, height: 4, colour: '#ffffff' }));
}
/** Letters drawn as "H" shapes with strokes `w` pixels wide (thin text). */
function strokes(colour: string, w: number): Box[] {
  return Array.from({ length: 6 }, (_, i) => {
    const x = RECT.x + 6 + i * 36;
    const y = RECT.y + 6;
    return [{ x, y, width: w, height: 28 }, { x: x + 24 - w, y, width: w, height: 28 }, { x, y: y + 13, width: 24, height: w }].map((b) => ({ ...b, colour, from: 20, to: 79 }));
  }).flat();
}
/** Hairline letters: one 1 px diagonal per letter (no pixel has an ink neighbour above, below, left or right). */
function diagonals(colour: string): Box[] {
  return Array.from({ length: 6 }, (_, i) => Array.from({ length: 28 }, (_, k) => ({ x: RECT.x + 6 + i * 36 + Math.round(k * 0.85), y: RECT.y + 6 + k, width: 1, height: 1, colour, from: 20, to: 79 }))).flat();
}
/** A dark outline of `w` pixels around those thin letters. */
function outline3(w: number): Box[] {
  return strokes('#000000', 3).map((b) => ({ ...b, x: b.x - w, y: b.y - w, width: b.width + 2 * w, height: b.height + 2 * w }));
}
/** Dark "outline" of `w` pixels around every letter: a black box `w` larger on each side, behind the letters. */
function outline(w: number): Box[] {
  return letters('#000000').map((b) => ({ ...b, x: b.x - w, y: b.y - w, width: b.width + 2 * w, height: b.height + 2 * w }));
}
const withText = (colour: string, rect = RECT): Partial<Timeline> => ({
  texts: [{ id: 'title', line: 0, element: 'title', copy: 'ABCDEF', at: 20, for: 60, rect, size: 28, colour, rest: { at: 30, for: 40 } }],
});
const ALL = { x: 0, y: 0, width: 270, height: 480, colour: 'black' };
const SOUND = { db: -10.3 };                                           // a sine peaking at -10.3 dBFS is about -14 LUFS
const audio: Timeline['audio'] = [{ element: 'music', media: 'music', at: 0, for: 90, from: 0, gain: [[0, 1]] }];
const master = { lufs: -14, peak: -1 };

describe.skipIf(!haveFfmpeg)('checkOutput with real renders', () => {
  const measure = createMeasure(FFMPEG, FFPROBE);
  const dir = mkdtempSync(join(tmpdir(), 've-output-'));
  const bg = '#404040';
  const specs: Record<string, VideoSpec> = {
    good: { background: bg, boxes: [...letters('#ffffff'), ...letters('#ffe000', { ...RECT, y: 300 })], sound: SOUND },
    black: { background: bg, boxes: [{ ...ALL, from: 40, to: 49 }], sound: SOUND },
    blackLong: { background: bg, boxes: [{ ...ALL, from: 40, to: 60 }], sound: SOUND },
    blackShort: { background: bg, boxes: [{ ...ALL, from: 40, to: 40 }], sound: SOUND },
    blackTwo: { background: bg, boxes: [{ ...ALL, from: 40, to: 41 }], sound: SOUND },
    blackEnd: { background: bg, boxes: [{ ...ALL, from: 80, to: 89 }], sound: SOUND },
    blackEnd1: { background: bg, boxes: [{ ...ALL, from: 89, to: 89 }], sound: SOUND },
    darkGrey: { background: '#202020', noise: 6, sound: SOUND },
    frozen20: { background: bg, freeze: { first: 40, last: 59 }, sound: SOUND },
    hold10: { background: bg, freeze: { first: 30, last: 39 }, crf: 23, preset: 'medium', sound: SOUND },
    hold14: { background: bg, freeze: { first: 30, last: 43 }, crf: 23, preset: 'medium', sound: SOUND },
    hold20: { background: bg, freeze: { first: 30, last: 49 }, crf: 23, preset: 'medium', sound: SOUND },
    twoHolds: { background: bg, freeze: [{ first: 30, last: 35 }, { first: 44, last: 49 }], crf: 23, preset: 'medium', sound: SOUND },
    cut: { background: bg, boxes: [{ x: RECT.x, y: RECT.y, width: 230, height: 16, colour: '#ffffff', from: 0, to: 19 }, ...letters('#ffffff', RECT, 20, 59)], sound: SOUND },
    hair: { background: '#4a7fc0', boxes: [...clouds(), ...strokes('#ffffff', 2)], sound: SOUND },
    thin3: { background: '#d8d8d8', boxes: [...outline3(2), ...strokes('#ffffff', 3)], sound: SOUND },
    thin3bare: { background: '#d8d8d8', boxes: strokes('#ffffff', 3), sound: SOUND },
    thin2: { background: '#d8d8d8', boxes: [...outline3(2), ...strokes('#ffffff', 2)], sound: SOUND },
    diagDark: { background: bg, boxes: diagonals('#ffffff'), sound: SOUND },
    diagBright: { background: '#d8d8d8', boxes: diagonals('#ffffff'), sound: SOUND },
    diagSky: { background: '#4a7fc0', boxes: [...clouds(), ...diagonals('#ffffff')], sound: SOUND },
    brightMissing: { background: '#d8d8d8', sound: SOUND },
    box: { background: bg, noise: 0, filter: 'split[a][b];[a]crop=60:60:100:200,noise=alls=40:allf=t[n];[b][n]overlay=100:200', sound: SOUND },
    pan: { source: 'testsrc2=size=540x480:rate=30:duration=3', filter: "crop=270:480:x='n*0.5':y=0", sound: SOUND },
    skyMissing: { background: '#4a7fc0', boxes: clouds(), sound: SOUND },
    skyText: { background: '#4a7fc0', boxes: [...clouds(), ...letters('#ffffff')], sound: SOUND },
    bright: { background: '#d8d8d8', boxes: letters('#ffffff'), sound: SOUND },
    outline1: { background: '#d8d8d8', boxes: [...outline(1), ...letters('#ffffff')], sound: SOUND },
    outline2: { background: '#d8d8d8', boxes: [...outline(2), ...letters('#ffffff')], sound: SOUND },
    outline4: { background: '#d8d8d8', boxes: [...outline(4), ...letters('#ffffff')], sound: SOUND },
    frozen: { background: bg, freeze: { first: 30, last: 69 }, sound: SOUND },
    frozenShort: { background: bg, freeze: { first: 40, last: 49 }, sound: SOUND },
    whiteOnWhite: { background: '#f0f0f0', boxes: letters('#ffffff'), sound: SOUND },
    whiteOnGrey: { background: '#b4b4b4', boxes: letters('#ffffff'), sound: SOUND },
    plated: { background: '#b4b4b4', boxes: [{ ...RECT, colour: 'black', from: 20, to: 79 }, ...letters('#ffffff')], sound: SOUND },
    noText: { background: bg, sound: SOUND },
    quiet: { background: bg, sound: { db: -26.3 } },
    loud: { background: bg, sound: { db: -2.3 } },
    clipped: { background: bg, sound: { db: 6 } },
    silent: { background: bg, sound: { db: -90 } },
    mute: { background: bg },
  };
  const file = (name: string) => join(dir, `${name}.mp4`);
  const codes = (issues: { code: string }[]) => issues.map((i) => i.code);
  const run = (name: string, over: Partial<Timeline> = {}) => checkOutput(file(name), makeTimeline({ audio, master, ...over }), measure);

  beforeAll(async () => {
    for (const [name, spec] of Object.entries(specs)) await makeVideo(file(name), spec);
    await makeVideo(file('other-size'), { width: 240, height: 480, background: bg, sound: SOUND });
    await makeVideo(file('fps24'), { fps: 24, seconds: 3.75, background: bg, sound: SOUND });
    await makeVideo(file('short'), { seconds: 2.6, background: bg, sound: SOUND });
  }, SLOW * 3);

  it('a good render raises nothing (text and captions seen, loudness -14, no black, no freeze)', async () => {
    const issues = await run('good', {
      ...withText('#ffffff'),
      captions: [{ group: 0, element: 'cap-0', at: 20, for: 60, rect: { ...RECT, y: 300 }, size: 28, colour: '#ffe000', lines: ['ABC'], words: [], rest: { at: 30, for: 40 } }],
    });
    expect(issues).toEqual([]);
  }, SLOW);

  describe('output-mismatch', () => {
    it('width', async () => {
      const issues = await run('other-size');
      expect(codes(issues)).toEqual(['output-mismatch']);
      expect(issues[0]).toMatchObject({ severity: 'error' });
      expect(issues[0]!.message).toContain('240x480');
      expect(issues[0]!.message).toContain('270x480');
    }, SLOW);
    it('rate', async () => {
      const issues = await run('fps24', { frames: 90 });
      expect(codes(issues)).toEqual(['output-mismatch']);
      expect(issues[0]!.message).toContain('24');
    }, SLOW);
    it('frame count', async () => {
      const issues = await run('short');
      expect(codes(issues)).toEqual(['output-mismatch']);
      expect(issues[0]!.message).toContain('78');
      expect(issues[0]!.message).toContain('90');
    }, SLOW);
    it('no sound stream although the timeline has audio', async () => {
      const issues = await run('mute');
      expect(codes(issues)).toEqual(['output-mismatch']);
      expect(issues[0]!.message).toMatch(/sound/i);
    }, SLOW);
    it('a file that is not there or not a video is an error, not a crash', async () => {
      expect(codes(await checkOutput(join(dir, 'absent.mp4'), makeTimeline(), measure))).toEqual(['output-mismatch']);
    }, SLOW);
  });

  describe('black-frames', () => {
    it('ten black frames in the middle are an error that says where', async () => {
      const issues = await run('black');
      expect(codes(issues)).toEqual(['black-frames']);
      expect(issues[0]).toMatchObject({ severity: 'error', at: 40 });
      expect(issues[0]!.message).toContain('10');
    }, SLOW);
    it('a dip over those frames explains them; a dip that covers only a part leaves the rest', async () => {
      const dip = { kind: 'dip', from: 'a', to: 'b', cut: 45, at: 38, for: 14, overlap: false, colour: '#000000' };
      expect(await run('black', { transitions: [dip] })).toEqual([]);
      const issues = await run('blackLong', { transitions: [dip] });         // black 40-60, explained 37-52: 53-60 remain
      expect(codes(issues)).toEqual(['black-frames']);
      expect(issues[0]!.at).toBe(53);
    }, SLOW);
    it('a flash explains black frames too', async () => {
      expect(await run('black', { transitions: [{ kind: 'flash', from: 'a', to: 'b', cut: 45, at: 38, for: 14, overlap: false, colour: '#000000' }] })).toEqual([]);
    }, SLOW);
    it('a single black frame is not reported', async () => {
      expect(await run('blackShort')).toEqual([]);
    }, SLOW);
  });

  describe('frozen-frames', () => {
    it('a stretch of forty frozen frames in a playing video shot is an error', async () => {
      const issues = await run('frozen');
      expect(codes(issues)).toEqual(['frozen-frames']);
      expect(issues[0]).toMatchObject({ severity: 'error', target: 'main' });
      expect(issues[0]!.at).toBeGreaterThanOrEqual(30);
      expect(issues[0]!.at).toBeLessThanOrEqual(45);
      expect(issues[0]!.fix).toMatch(/from|longer|another|replace/i);
    }, SLOW);
    it('ten frozen frames are a held beat, not an error', async () => {
      expect(await run('frozenShort')).toEqual([]);
    }, SLOW);
    it('an image shot over those frames explains them', async () => {
      const shots: Timeline['shots'] = [
        { id: 'a', element: 'shot-a', media: 'clip', kind: 'video', at: 0, for: 30, tail: 0, from: 0 },
        { id: 'b', element: 'shot-b', media: 'still', kind: 'image', at: 30, for: 40, tail: 0, from: 0 },
        { id: 'c', element: 'shot-c', media: 'clip', kind: 'video', at: 70, for: 20, tail: 0, from: 30 },
      ];
      expect(await run('frozen', { shots })).toEqual([]);
    }, SLOW);
    it('a window rest over those frames explains them', async () => {
      const windows: Timeline['windows'] = [{ shot: 'main', behind: 'pic', at: 25, for: 50, frames: 5, rect: { x: 100, y: 300, width: 100, height: 160 }, radius: 0, pictures: [{ behind: 'pic', element: 'main-b1-v', at: 25, for: 50 }] }];   // rest 30-69
      expect(await run('frozen', { windows })).toEqual([]);
    }, SLOW);
  });

  describe('text', () => {
    it('low-contrast: white text on white footage', async () => {
      const issues = await run('whiteOnWhite', withText('#ffffff'));
      expect(codes(issues)).toEqual(['low-contrast']);
      expect(issues[0]).toMatchObject({ severity: 'warning', target: 'title', at: 50 });
      expect(issues[0]!.fix).toMatch(/outline|plate/);
    }, SLOW);
    it('low-contrast: white text on light grey footage, in a caption group as well', async () => {
      const issues = await run('whiteOnGrey', {
        ...withText('#ffffff'),
      });
      expect(codes(issues)).toEqual(['low-contrast']);
      expect(issues[0]!.message).toMatch(/\d\.\d+/);
      const cap = await run('whiteOnGrey', { captions: [{ group: 2, element: 'cap-2', at: 20, for: 60, rect: RECT, size: 28, colour: '#ffffff', lines: ['A'], words: [], rest: { at: 30, for: 40 } }] });
      expect(codes(cap)).toEqual(['low-contrast']);
      expect(cap[0]!.target).toBe('cap-2');
    }, SLOW);
    it('a plate under the same text on the same footage passes', async () => {
      expect(await run('plated', withText('#ffffff'))).toEqual([]);
    }, SLOW);
    it('text-missing: nothing in the rect is the colour of the text', async () => {
      const issues = await run('noText', withText('#ffffff'));
      expect(codes(issues)).toEqual(['text-missing']);
      expect(issues[0]).toMatchObject({ severity: 'error', target: 'title', at: 50 });
    }, SLOW);
    it('text-missing: the wrong colour counts as missing', async () => {
      expect(codes(await run('good', withText('#ff0000')))).toEqual(['text-missing']);
    }, SLOW);
  });

  describe('sound', () => {
    it('too-quiet at about -30 LUFS against a -14 target', async () => {
      const issues = await run('quiet');
      expect(codes(issues)).toEqual(['too-quiet']);
      expect(issues[0]!.severity).toBe('warning');
      expect(issues[0]!.message).toMatch(/-30|-29/);
    }, SLOW);
    it('too-loud at about -6 LUFS against a -14 target', async () => {
      const issues = await run('loud');
      expect(codes(issues)).toEqual(['too-loud']);
      expect(issues[0]!.severity).toBe('warning');
    }, SLOW);
    it('with no master the window is -23 … -9 LUFS', async () => {
      expect(codes(await run('quiet', { master: null }))).toEqual(['too-quiet']);
      expect(codes(await run('loud', { master: null }))).toEqual(['too-loud']);
      expect(await run('good', { master: null })).toEqual([]);
    }, SLOW);
    it('clipping: a clipped sine has a true peak over -0.3 dBTP', async () => {
      const issues = await run('clipped', { master: null });
      expect(codes(issues)).toContain('clipping');
      expect(issues.find((i) => i.code === 'clipping')).toMatchObject({ severity: 'error' });
    }, SLOW);
    it('silent: audio in the timeline and nothing to hear', async () => {
      const issues = await run('silent');
      expect(codes(issues)).toEqual(['silent']);
      expect(issues[0]!.severity).toBe('error');
    }, SLOW);
    it('no sound checks when the timeline has no audio', async () => {
      expect(await checkOutput(file('mute'), makeTimeline(), measure)).toEqual([]);
    }, SLOW);
  });

  describe('fix round 1', () => {
    const dipAt = (colour: string | null, kind = 'dip') => ({ kind, from: 'a', to: 'b', cut: 45, at: 38, for: 14, overlap: false, colour });
    it('3: black under a white flash is an error; under a #101010 dip, or a dip with no colour, it is explained', async () => {
      expect(codes(await run('black', { transitions: [dipAt('#ffffff', 'flash')] }))).toEqual(['black-frames']);
      expect(await run('black', { transitions: [dipAt('#101010')] })).toEqual([]);
      expect(await run('black', { transitions: [dipAt(null, 'flash')] })).toEqual([]);
      expect(codes(await run('black', { transitions: [dipAt('#404040')] }))).toEqual(['black-frames']);
    }, SLOW);
    it('2/7: two black frames are reported, one is not; black that reaches the last frame is counted whole', async () => {
      expect(codes(await run('blackTwo'))).toEqual(['black-frames']);
      const end = await run('blackEnd');
      expect(codes(end)).toEqual(['black-frames']);
      expect(end[0]!.at).toBe(80);
      expect(end[0]!.message).toContain('10 black frames');
      expect(await run('blackEnd1')).toEqual([]);                                  // one frame
    }, SLOW);
    it('7: a dark grey picture (#202020) is not black', async () => {
      expect(await run('darkGrey')).toEqual([]);
    }, SLOW);
    it('8: black that is in the source footage is dark-footage (a warning) when sources are given; black that the source does not have stays an error', async () => {
      const source = file('source');
      await makeVideo(source, { background: bg, boxes: [{ ...ALL, from: 50, to: 59 }] });
      const shots = (from: number): Timeline['shots'] => [{ id: 'main', element: 'shot-main', media: 'clip', kind: 'video', at: 0, for: 80, tail: 0, from }];
      const timeline = makeTimeline({ frames: 90, shots: shots(10), audio, master });
      const issues = await checkOutput(file('black'), timeline, measure, { clip: source });         // output 40-49 = source 50-59
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: 'dark-footage', severity: 'warning', target: 'main' });
      expect(issues[0]!.message).toContain('source frames 50-59');
      expect(codes(await checkOutput(file('black'), timeline, measure))).toEqual(['black-frames']);   // no sources: as before
      expect(codes(await checkOutput(file('black'), makeTimeline({ shots: shots(0), audio, master }), measure, { clip: source }))).toEqual(['black-frames']);
    }, SLOW);
    it('10: the black-frames fix names the source frame and the shot, and says what to set', async () => {
      const shots: Timeline['shots'] = [{ id: 'main', element: 'shot-main', media: 'clip', kind: 'video', at: 0, for: 90, tail: 0, from: 5 }];
      const issues = await run('black', { shots, frames: 90 });
      expect(issues[0]!.fix).toMatch(/source frame 45 /i);
      expect(issues[0]!.fix).toContain('shot main');
      expect(issues[0]!.fix).toContain('"from": 55');
    }, SLOW);
    it('1: a static background with a small moving box raises nothing; a calm pan raises nothing; a real 20-frame freeze at crf 23 medium is caught', async () => {
      expect(await run('box')).toEqual([]);
      expect(await run('pan')).toEqual([]);
      expect(codes(await run('hold20'))).toEqual(['frozen-frames']);              // crf 23 medium: read at its full length
    }, SLOW);
    it('documented limit: at crf 14 ultrafast over noisy footage a 20-frame freeze reads shorter (about 13) and is not an error; nothing is added to the detector\'s answer', async () => {
      const read = await measure.frozen(file('frozen20'));
      expect(Math.max(...read.map((r) => r.for))).toBeLessThan(20);
      expect(await run('frozen20')).toEqual([]);
    }, SLOW);
    it('4: text that did not render is missing even over footage with near-white pixels; the same footage with the text raises nothing', async () => {
      expect(codes(await run('skyMissing', withText('#ffffff')))).toEqual(['text-missing']);
      expect(await run('skyText', withText('#ffffff'))).toEqual([]);
    }, SLOW);
    it('11: white text on bright footage with no outline is low-contrast; a dark outline of 4 px (wider than the 3 px ring) or 2 px passes', async () => {
      expect(codes(await run('bright', withText('#ffffff')))).toEqual(['low-contrast']);
      expect(await run('outline4', withText('#ffffff'))).toEqual([]);
      expect(await run('outline2', withText('#ffffff'))).toEqual([]);
    }, SLOW);
    it('11: an outline of 1 px covers only a third of the 3 px ring; the rest of the ring is bright, so it is still low-contrast (a 1 px outline barely helps)', async () => {
      expect(codes(await run('outline1', withText('#ffffff')))).toEqual(['low-contrast']);
    }, SLOW);
    it('5: a variable-rate file is an output-mismatch', async () => {
      await makeVariableRate(file('vfr'));
      const issues = await run('vfr', { frames: 59 });
      expect(codes(issues)).toEqual(['output-mismatch']);
      expect(issues[0]!.message).toMatch(/variable|constant/i);
    }, SLOW);
    it('5: frame numbers count from the first picture when the picture starts after the sound', async () => {
      await makeOffset(file('offset'), 0.5, { from: 20, to: 29 });
      const issues = await run('offset', { master: null });
      expect(codes(issues)).toEqual(['black-frames']);
      expect(issues[0]!.at).toBe(20);
    }, SLOW);
  });

  describe('fix round 2', () => {
    it('1: holds of 10 and 14 frames at crf 23 medium raise nothing; a 20-frame hold is read at its full length', async () => {
      expect(await run('hold10')).toEqual([]);
      expect(await run('hold14')).toEqual([]);
      const read = await measure.frozen(file('hold20'));
      expect(read.map((r) => r.for)).toContain(20);
    }, SLOW);
    it('2: two 6-frame holds 8 frames apart are two short holds, not one long freeze', async () => {
      expect(await run('twoHolds')).toEqual([]);
    }, SLOW);
    it('3: frozen source -> still-footage warning; moving source -> frozen-frames error; no sources -> error', async () => {
      const shot = (from: number): Partial<Timeline> => ({ shots: [{ id: 'main', element: 'shot-main', media: 'clip', kind: 'video', at: 0, for: 90, tail: 0, from }], audio, master });
      const warn = await checkOutput(file('frozen'), makeTimeline(shot(0)), measure, { clip: file('frozen') });
      expect(codes(warn)).toEqual(['still-footage']);
      expect(warn[0]).toMatchObject({ severity: 'warning', target: 'main' });
      expect(warn[0]!.message).toMatch(/does not move on source frames \d+-\d+/);
      expect(codes(await checkOutput(file('frozen'), makeTimeline(shot(0)), measure, { clip: file('good') }))).toEqual(['frozen-frames']);
      expect(codes(await run('frozen'))).toEqual(['frozen-frames']);
    }, SLOW);
    it('4: a missing or unreadable source gives no information; the other findings still arrive', async () => {
      const junk = join(dir, 'junk.mp4');
      writeFileSync(junk, 'not a video');
      for (const bad of [join(dir, 'nowhere.mp4'), junk]) {
        expect(codes(await checkOutput(file('black'), makeTimeline({ audio, master }), measure, { clip: bad }))).toEqual(['black-frames']);
        expect(codes(await checkOutput(file('frozen'), makeTimeline({ audio, master }), measure, { clip: bad }))).toEqual(['frozen-frames']);
      }
    }, SLOW);
    it('5: a cut exactly at the text start with a bright previous shot, and rendered text, raise nothing', async () => {
      const shots: Timeline['shots'] = [
        { id: 'a', element: 'shot-a', media: 'clip', kind: 'video', at: 0, for: 20, tail: 0, from: 0 },
        { id: 'b', element: 'shot-b', media: 'clip', kind: 'video', at: 20, for: 70, tail: 0, from: 20 },
      ];
      const text: Partial<Timeline> = { shots, texts: [{ id: 'title', line: 0, element: 'title', copy: 'ABCDEF', at: 20, for: 40, rect: RECT, size: 28, colour: '#ffffff', rest: { at: 30, for: 20 } }] };
      expect(await run('cut', text)).toEqual([]);
    }, SLOW);
    it('5: hairline text (2 px strokes) over bright footage raises nothing when rendered, and text-missing when it is not', async () => {
      expect(await run('hair', withText('#ffffff'))).toEqual([]);
      expect(codes(await run('skyMissing', withText('#ffffff')))).toEqual(['text-missing']);
    }, SLOW);
    it('6: thin text with a 2 px outline on bright footage raises nothing (3 px and 2 px strokes); without the outline it is low-contrast', async () => {
      expect(await run('thin3', withText('#ffffff'))).toEqual([]);
      expect(await run('thin2', withText('#ffffff'))).toEqual([]);
      expect(codes(await run('thin3bare', withText('#ffffff')))).toEqual(['low-contrast']);
    }, SLOW);
  });

  describe('fix round 3', () => {
    it('1: 1 px diagonal hairline text rendered raises no text-missing over dark footage, over bright specky footage, and over footage with clouds', async () => {
      for (const name of ['diagDark', 'diagBright', 'diagSky']) {
        expect(codes(await run(name, withText('#ffffff'))).filter((c) => c === 'text-missing'), name).toEqual([]);
      }
      expect(await run('diagDark', withText('#ffffff'))).toEqual([]);
    }, SLOW);
    it('1: hairline text that did not render over bright footage is text-missing', async () => {
      expect(codes(await run('brightMissing', withText('#ffffff')))).toEqual(['text-missing']);
      expect(codes(await run('skyMissing', withText('#ffffff')))).toEqual(['text-missing']);
    }, SLOW);
    it('2: a MediaError from a source measurement is "no information"; any other error is a bug and propagates', async () => {
      const source = file('good');
      const failing = (error: Error) => ({ ...measure, black: (f: string) => (f === source ? Promise.reject(error) : measure.black(f)) });
      const timeline = makeTimeline({ audio, master });
      const ok = await checkOutput(file('black'), timeline, failing(new MediaError('not-media', 'unreadable')), { clip: source });
      expect(codes(ok)).toEqual(['black-frames']);
      await expect(checkOutput(file('black'), timeline, failing(new TypeError('bug')), { clip: source })).rejects.toBeInstanceOf(TypeError);
    }, SLOW);
  });
});

describe('checkOutput when the tools cannot start (no ffmpeg needed)', () => {
  const refusing = (error: Error) => {
    const never = () => Promise.reject(new Error('measure called after the first failure'));
    return { streams: () => Promise.reject(error), black: never, frozen: never, loudness: never, momentary: never, picture: never };
  };
  it('ToolUnavailable from the first measurement is one tool-failed error, not a throw and not an output-mismatch', async () => {
    const issues = await checkOutput('x.mp4', makeTimeline(), refusing(new ToolUnavailable('ffprobe', 'spawn ENOENT')));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'tool-failed', severity: 'error', at: null, target: null });
    expect(issues[0]!.message).toContain('ffprobe');
  });
  it('any other MediaError is output-mismatch (the render cannot be read); an error that is not a MediaError propagates', async () => {
    const issues = await checkOutput('x.mp4', makeTimeline(), refusing(new MediaError('not-media', 'unreadable')));
    expect(issues.map((i) => i.code)).toEqual(['output-mismatch']);
    await expect(checkOutput('x.mp4', makeTimeline(), refusing(new TypeError('bug')))).rejects.toBeInstanceOf(TypeError);
  });
});
