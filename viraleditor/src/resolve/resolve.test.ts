import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Edit } from '../edit/types.ts';
import { validate } from '../edit/validate.ts';
import type { Word } from '../ports.ts';
import { beatsFill, beatsTemplate, continuingFill, continuingTemplate, speechFill, speechTemplate } from '../template/fixture.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';
import { ResolveError, resolve } from './index.ts';
import type { ResolveMedia } from './index.ts';
import { placeholderFacts, placeholderMedia } from './placeholder.ts';

type Json = Record<string, any>;
interface Case { template: Json; fill: Json; media: ResolveMedia }

/** The words of a segment as a recogniser would hand them over: the texts at the given seconds. */
const heard = (...words: [string, number, number][]): Word[] => words.map(([text, start, end]) => ({ text, start, end }));
const beatsCase = (): Case => {
  const template = beatsTemplate(), fill = beatsFill();
  return { template, fill, media: placeholderMedia(template as unknown as TemplateJson, fill as FillJson) };
};
const speechCase = (): Case => {
  const template = speechTemplate(), fill = speechFill();
  return { template, fill, media: placeholderMedia(template as unknown as TemplateJson, fill as FillJson) };
};
const run = ({ template, fill, media }: Case): Edit => resolve(template as unknown as TemplateJson, fill as FillJson, media);
const codeOf = (given: Case): string => {
  try { run(given); } catch (error) { if (error instanceof ResolveError) return error.code; throw error; }
  return 'ok';
};
const changed = (base: Case, change: (c: Case) => void): Case => { change(base); return base; };
const freeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

describe('resolve, beats', () => {
  it('keeps the frames of the template, takes the copy of the fill and names the media', () => {
    expect(run(beatsCase())).toEqual({
      version: 1, language: 'en', canvas: { width: 1080, height: 1920, fps: 30 }, frames: 90,
      styles: { main: { font: 'Inter', weight: 700, size: 48, align: 'center', fill: '#fff', shadows: [] } },
      media: { 'clip-s1': { file: 'assets/clip-s1.mp4', kind: 'video' }, music: { file: 'assets/music.mp3', kind: 'audio' } },
      shots: [{ id: 's1', at: 0, for: 90, media: 'clip-s1' }],
      texts: [{ id: 'x1', at: 0, for: 90, box: { left: 10, top: 20, right: 80, bottom: 40 }, style: 'main', copy: 'Hi Glow Serum' }],
      audio: { music: { media: 'music', gain: 0.5 } },
    });
  });
  it('copies the optional fields as they are, and leaves out the ones the template does not give', () => {
    const given = changed(beatsCase(), ({ template }) => {
      template.safe = 'tiktok';
      template.shots[0].motion = { kind: 'push-in', to: 1.1 };
      template.shots.push({ id: 's2', at: 90, for: 60, products: [], still_prompt: 'b', motion_prompt: 'm', clip_seconds: 4, action: 'two', in: { kind: 'whip', to: 'left', frames: 8 } });
      template.texts[0] = { ...template.texts[0], lines: 1, enter: { kind: 'pop', frames: 8 }, exit: { kind: 'none' } };
      template.audio.music = { prompt: 'p', gain: 0.4, fadeOut: 20, duck: { to: 0.1, under: [{ at: 0, for: 30 }] } };
    });
    given.fill.shots.s2 = { still_prompt: 'b', motion_prompt: 'm' };
    given.media.clips.s2 = { file: 'assets/clip-s2.mp4', frames: 120 };
    const edit = run(given);
    expect(edit.safe).toBe('tiktok');
    expect(edit.frames).toBe(150);
    expect(edit.shots).toEqual([
      { id: 's1', at: 0, for: 90, media: 'clip-s1', motion: { kind: 'push-in', to: 1.1 } },
      { id: 's2', at: 90, for: 60, media: 'clip-s2', in: { kind: 'whip', to: 'left', frames: 8 } },
    ]);
    expect(edit.texts![0]).toMatchObject({ lines: 1, enter: { kind: 'pop', frames: 8 }, exit: { kind: 'none' } });
    expect(edit.audio).toEqual({ music: { media: 'music', gain: 0.4, fadeOut: 20, duck: { to: 0.1, under: [{ at: 0, for: 30 }] } } });
    expect(JSON.stringify(run(beatsCase()))).not.toMatch(/undefined|"safe"|"in"|"motion"|"enter"|"lines"|"duck"/);
  });
  it('has no audio when there is no music file', () => {
    const edit = run(changed(beatsCase(), ({ media }) => { media.music = null; }));
    expect(edit.audio).toBeUndefined();
    expect(Object.keys(edit.media)).toEqual(['clip-s1']);
  });
  it('media-missing: a shot without a clip, or a clip without a frame count', () => {
    expect(codeOf(changed(beatsCase(), ({ media }) => { media.clips = {}; }))).toBe('media-missing');
    expect(codeOf(changed(beatsCase(), ({ media }) => { media.clips.s1!.frames = Number.NaN; }))).toBe('media-missing');
    expect(codeOf(changed(beatsCase(), ({ template, fill, media }) => { template.shots[0].id = 'constructor'; template.texts = []; fill.texts = {}; media.clips = {}; }))).toBe('fill-missing');
  });
  it('template-invalid: a beats shot that lost its frames', () => {
    expect(codeOf(changed(beatsCase(), ({ template }) => { delete template.shots[0].for; }))).toBe('template-invalid');
  });

  describe('shots that continue a clip (s2 and s3 continue s1; every shot is 30 frames)', () => {
    const partsCase = (): Case => {
      const template = continuingTemplate(), fill = continuingFill();
      return { template, fill, media: placeholderMedia(template as unknown as TemplateJson, fill as FillJson) };
    };
    it('the media has one clip per shot that owns a clip, as long as it is billed', () => {
      expect(partsCase().media.clips).toEqual({
        s1: { file: 'assets/clip-s1.mp4', frames: 120 }, s4: { file: 'assets/clip-s4.mp4', frames: 120 }, s5: { file: 'assets/clip-s5.mp4', frames: 120 },
      });
      expect(partsCase().media.music?.frames).toBe(150);
    });
    it('a part shows the owner\'s clip from where it lies in it: the owner from 0, the last part up to the clip\'s last frame, evenly between', () => {
      const given = partsCase();
      const edit = run(given);
      expect(edit.shots.map((shot) => [shot.id, shot.at, shot.for, shot.media, shot.from])).toEqual([
        ['s1', 0, 30, 'clip-s1', undefined], ['s2', 30, 30, 'clip-s1', 45], ['s3', 60, 30, 'clip-s1', 90],   // 30 unused frames: gaps of 15
        ['s4', 90, 30, 'clip-s4', undefined], ['s5', 120, 30, 'clip-s5', undefined],
      ]);
      expect('from' in edit.shots[0]!).toBe(false);
      expect(Object.keys(edit.media)).toEqual(['clip-s1', 'clip-s4', 'clip-s5', 'music']);
      expect(validate(edit, placeholderFacts(edit, given.media))).toEqual([]);
    });
    it('the parts lie in the clip as it came: a longer clip spreads them, the next shot\'s transition counts to the last', () => {
      const longer = changed(partsCase(), ({ media }) => { media.clips.s1!.frames = 125; });
      expect(run(longer).shots.slice(0, 3).map((shot) => shot.from ?? 0)).toEqual([0, 48, 95]);                   // 35 unused: 18 and 17
      const faded = changed(partsCase(), ({ template }) => { template.shots[3].in = { kind: 'crossfade', frames: 8 }; });
      const edit = run(faded);
      expect(edit.shots.slice(0, 3).map((shot) => shot.from ?? 0)).toEqual([0, 41, 82]);                            // 22 unused: 11 and 11; 82 + 30 + 8 = 120
      expect(validate(edit, placeholderFacts(edit, faded.media))).toEqual([]);
    });
    it('a clip shorter than its parts: the parts follow each other and the edit\'s check says the clip is short', () => {
      const short = changed(partsCase(), ({ media }) => { media.clips.s1!.frames = 80; });
      const edit = run(short);
      expect(edit.shots.slice(0, 3).map((shot) => shot.from ?? 0)).toEqual([0, 30, 60]);
      expect(validate(edit, placeholderFacts(edit, short.media)).map((issue) => `${issue.code} ${issue.path}`)).toEqual(['clip-short shots[2]']);
    });
  });
});

describe('resolve, speech', () => {
  /** Two segments of 180 and 150 frames; segment 1 at frames 0 … 179, segment 2 at 180 … 329. */
  const timed = (): Case => changed(speechCase(), ({ media }) => {
    media.clips = { s1: { file: 'assets/clip-s1.mp4', frames: 180 }, s2: { file: 'assets/clip-s2.mp4', frames: 150 } };
    media.words = {
      //       [hook] I tried Glow Serum for two weeks. [/hook]                                                      [proof] Look at this. [/proof]
      open: heard(['I', 0.2, 0.3], ['try', 0.3, 0.6], ['Glow', 0.6, 0.9], ['Serum', 0.9, 1.3], ['for', 1.3, 1.5], ['two', 1.5, 1.8], ['weeks', 1.8, 2.4],
        ['Look', 3.4, 3.7], ['at', 3.7, 3.8], ['this', 3.8, 4.4]),
      //        It is [name] the Glow Serum. [/name]
      close: heard(['It', 0.5, 0.6], ['is', 0.6, 0.8], ['the', 0.8, 1], ['Glow', 1, 1.3], ['Serum', 1.3, 4.8]),
    };
  });


  it('coalesces a final one-frame window swap onto the last resting frame', () => {
    const given = changed(timed(), ({ template, fill, media }) => {
      fill.script.open = '[hook]I tried Glow Serum for two weeks.[/hook] Look at [proof]this.[/proof]';
      media.words.open = heard(['I', .2, .3], ['tried', .3, .6], ['Glow', .6, .9], ['Serum', .9, 1.3], ['for', 1.3, 1.5], ['two', 1.5, 1.8], ['weeks.', 1.8, 5.6], ['Look', 5.7, 5.8], ['at', 5.8, 179 / 30], ['this.', 179 / 30, 6]);
      template.windows.push({ mark: 'hook', corner: 'top-right', behind: 'product:1' });
    });
    const windows = run(given).shots[0]!.windows!;
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ frames: 1, swaps: [{ at: 178, behind: 'still-skin' }] });
  });

  it('lays the segments end to end, each as long as its clip, with its own sound', () => {
    const edit = run(timed());
    expect(edit.shots.map(({ id, at, for: length, media, sound }) => [id, at, length, media, sound])).toEqual([
      ['s1', 0, 180, 'clip-s1', { gain: 1 }], ['s2', 180, 150, 'clip-s2', { gain: 1 }],
    ]);
    expect(edit.frames).toBe(330);
  });
  it('captions: the words of the script, each once, timed by what was heard and rounded to frames', () => {
    const { captions } = run(timed());
    expect(captions!.box).toEqual({ left: 14, top: 51, right: 86, bottom: 64 });
    expect(captions!.words).toEqual([
      { text: 'I', at: 6, for: 3 }, { text: 'tried', at: 9, for: 9 }, { text: 'Glow', at: 18, for: 9 }, { text: 'Serum', at: 27, for: 12 },
      { text: 'for', at: 39, for: 6 }, { text: 'two', at: 45, for: 9 }, { text: 'weeks.', at: 54, for: 18 },
      { text: 'Look', at: 102, for: 9 }, { text: 'at', at: 111, for: 3 }, { text: 'this.', at: 114, for: 18 },
      { text: 'It', at: 195, for: 3 }, { text: 'is', at: 198, for: 6 }, { text: 'the', at: 204, for: 6 }, { text: 'Glow', at: 210, for: 9 }, { text: 'Serum.', at: 219, for: 105 },
    ]);
  });
  it('a text is on screen for the frames of its mark, and 12 frames more when the next word is far', () => {
    const edit = run(timed());
    // the last word of [hook] ends at frame 72; the next word begins at 102
    expect(edit.texts).toEqual([{ id: 'x1', at: 6, for: 78, box: { left: 14, top: 14, right: 86, bottom: 24 }, style: 'main', copy: 'I tried Glow Serum' }]);
  });
  it('an element on a one-word mark before a pause is not a flash', () => {
    const edit = run(changed(timed(), ({ fill, media }) => {
      fill.script.close = 'It is the [name]Glow[/name] Serum.';
      media.words.close = heard(['It', 0.5, 0.6], ['is', 0.6, 0.8], ['the', 0.8, 1], ['Glow', 1, 1.05], ['Serum', 3, 3.5]);   // "Glow" is heard for 2 frames, then a pause
    }));
    expect(edit.captions!.words[13]).toEqual({ text: 'Glow', at: 210, for: 2 });
    expect(edit.cards![0]).toMatchObject({ id: 'c1', at: 210, for: 14 });
  });
  it('a card is on screen for the frames of its mark: to the cut when the mark ends the segment and the cut is close', () => {
    const edit = run(timed());
    // [name] begins at 204; its last word ends at 324, 6 frames before the cut at 330
    expect(edit.cards).toEqual([{ id: 'c1', at: 204, for: 126, media: 'product-1', box: { left: 60, top: 27, right: 86, bottom: 50 } }]);
    expect(edit.media['product-1']).toEqual({ file: 'assets/product-1-1.png', kind: 'image' });
  });
  it('a window sits on the shot of its segment for the frames of its mark, over its picture', () => {
    const edit = run(timed());
    // the words of [proof] are on frames 102 … 131; the cut of segment 1 is at 180, far away
    expect(edit.shots[0]!.windows).toEqual([{ at: 102, for: 42, corner: 'top-right', behind: 'still-skin' }]);
    expect(edit.shots[1]!.windows).toBeUndefined();
    expect(edit.media['still-skin']).toEqual({ file: 'assets/still-skin.png', kind: 'image' });
  });
  it('a window on a short mark shrinks and returns faster; one under 3 frames is left out', () => {
    /** [proof] is the one word "Look", heard for `frames` frames; the next word follows at once. */
    const short = (frames: number) => run(changed(timed(), ({ fill, media, template }) => {
      template.windows[0].frames = 12;
      fill.script.open = '[hook]I tried Glow Serum for two weeks.[/hook] [proof]Look[/proof] at this.';
      media.words.open = heard(['I', 0.2, 0.3], ['tried', 0.3, 0.6], ['Glow', 0.6, 0.9], ['Serum', 0.9, 1.3], ['for', 1.3, 1.5], ['two', 1.5, 1.8], ['weeks', 1.8, 2.4],
        ['Look', 3, 3 + frames / 30], ['at', 3 + frames / 30, 3.5 + frames / 30], ['this', 3.5 + frames / 30, 4 + frames / 30]);
    }));
    expect(short(40).shots[0]!.windows).toEqual([{ at: 90, for: 40, corner: 'top-right', behind: 'still-skin', frames: 12 }]);
    expect(short(11).shots[0]!.windows).toEqual([{ at: 90, for: 11, corner: 'top-right', behind: 'still-skin', frames: 5 }]);
    expect(short(3).shots[0]!.windows).toEqual([{ at: 90, for: 3, corner: 'top-right', behind: 'still-skin', frames: 1 }]);
    expect(short(2).shots[0]!.windows).toBeUndefined();
    expect(short(2).media['still-skin']).toBeUndefined();            // a picture nothing shows is not listed
  });
  it('an element on a mark too short for its animations fades quickly in and out instead, and the lines of a text come in together', () => {
    /** The text and the card sit on [name], one word heard for `frames` frames; the next word follows at once. */
    const onMark = (frames: number): Edit => run(changed(timed(), ({ template, fill, media }) => {
      template.texts[0] = { ...template.texts[0], mark: 'name', enter: { kind: 'pop', frames: 8 }, exit: { kind: 'fade', frames: 6 } };
      template.cards[0].enter = { kind: 'pop', frames: 7 };
      fill.script.open = 'I tried Glow Serum for two weeks. [proof]Look at this.[/proof]';
      template.script.segments[0].lines = 'I tried {product}. [proof]Look.[/proof]';
      fill.script.close = 'It is [name]this.[/name] Now go.';
      media.words.close = heard(['It', 0.5, 0.6], ['is', 0.6, 0.8], ['this', 1, 1 + frames / 30], ['Now', 1 + frames / 30, 1.3 + frames / 30], ['go', 1.3 + frames / 30, 1.6 + frames / 30]);
    }));
    const motionOf = (edit: Edit) => ({ text: [edit.texts![0]!.enter, edit.texts![0]!.exit, edit.texts![0]!.stagger], card: [edit.cards![0]!.enter, edit.cards![0]!.exit] });
    const quick = (frames: number) => ({ kind: 'fade', frames });
    expect(motionOf(onMark(40))).toEqual({ text: [{ kind: 'pop', frames: 8 }, { kind: 'fade', frames: 6 }, undefined], card: [{ kind: 'pop', frames: 7 }, undefined] });
    expect(motionOf(onMark(21))).toEqual({ text: [{ kind: 'pop', frames: 8 }, { kind: 'fade', frames: 6 }, undefined], card: [{ kind: 'pop', frames: 7 }, undefined] });
    expect(motionOf(onMark(20))).toEqual({ text: [quick(3), quick(3), 0], card: [{ kind: 'pop', frames: 7 }, undefined] });        // 8 + 6 and room for the lines
    expect(motionOf(onMark(15))).toEqual({ text: [quick(3), quick(3), 0], card: [quick(3), quick(3)] });                             // 7 + the default exit of 8
    expect(motionOf(onMark(5))).toEqual({ text: [quick(2), quick(2), 0], card: [quick(2), quick(2)] });
    expect(motionOf(onMark(2))).toEqual({ text: [{ kind: 'none' }, { kind: 'none' }, 0], card: [{ kind: 'none' }, { kind: 'none' }] });
    expect(onMark(1).cards![0]).toMatchObject({ for: 1, enter: { kind: 'none' }, exit: { kind: 'none' } });
  });
  it('an element that names no animation keeps the defaults of the editor on a mark long enough for them', () => {
    const edit = run(timed());
    expect(edit.texts![0]).not.toHaveProperty('enter');
    expect(edit.cards![0]).not.toHaveProperty('exit');
  });
  describe('windows on marks that follow each other become one window whose picture changes', () => {
    /** A window on [hook] over the product and one on [proof] over the still; "Look", the first word of [proof], is heard at `second` s. */
    const two = (second = 3.4, change: (c: Case) => void = () => {}): Edit => run(changed(timed(), (given) => {
      given.template.windows = [{ mark: 'proof', corner: 'top-right', behind: 'still:skin' }, { mark: 'hook', corner: 'top-right', behind: 'product:1' }];
      given.media.words.open = heard(['I', 0.2, 0.3], ['tried', 0.3, 0.6], ['Glow', 0.6, 0.9], ['Serum', 0.9, 1.3], ['for', 1.3, 1.5], ['two', 1.5, 1.8], ['weeks', 1.8, 2.4],
        ['Look', second, second + 0.3], ['at', second + 0.3, second + 0.4], ['this', second + 0.4, second + 1]);
      change(given);
    }));
    it('one window from the first mark to the end of the last; the picture changes on the first frame of the later mark', () => {
      // [hook] 6 … 83 (its last word ends at 72), [proof] 102 … 143: 18 frames apart
      expect(two().shots[0]!.windows).toEqual([{ at: 6, for: 138, corner: 'top-right', behind: 'product-1', swaps: [{ at: 102, behind: 'still-skin' }] }]);
      expect(Object.keys(two().media)).toEqual(expect.arrayContaining(['product-1', 'still-skin']));
    });
    it('fewer than 30 frames apart: one window; 30 or more: two windows, in time order', () => {
      expect(two(113 / 30).shots[0]!.windows).toHaveLength(1);                                // [hook] ends at 84, [proof] begins at 113
      expect(two(114 / 30).shots[0]!.windows).toEqual([
        { at: 6, for: 78, corner: 'top-right', behind: 'product-1' },
        { at: 114, for: 42, corner: 'top-right', behind: 'still-skin' },
      ]);
    });
    it('the place, the speed and the motion come from the first window', () => {
      const edit = two(3.4, ({ template }) => {
        template.windows[1] = { ...template.windows[1], width: 30, radius: 3, frames: 8, behindMotion: { kind: 'push-in', to: 1.06 } };
        template.windows[0] = { ...template.windows[0], corner: 'bottom-left', width: 44, frames: 20 };
      });
      expect(edit.shots[0]!.windows).toEqual([{ at: 6, for: 138, corner: 'top-right', width: 30, radius: 3, frames: 8, behind: 'product-1', behindMotion: { kind: 'push-in', to: 1.06 }, swaps: [{ at: 102, behind: 'still-skin' }] }]);
    });
    it('three marks in a row: two changes of the picture', () => {
      const edit = two(3.4, ({ template, fill }) => {
        template.script.segments[0].lines = '[hook]I tried {product}[/hook] [mid]for two weeks.[/mid] [proof]Look at this.[/proof]';
        fill.script.open = '[hook]I tried Glow Serum[/hook] [mid]for two weeks.[/mid] [proof]Look at this.[/proof]';
        template.windows.push({ mark: 'mid', corner: 'top-right', behind: 'still:skin' });
      });
      expect(edit.shots[0]!.windows).toEqual([{ at: 6, for: 138, corner: 'top-right', behind: 'product-1', swaps: [{ at: 39, behind: 'still-skin' }, { at: 102, behind: 'still-skin' }] }]);
    });
    it('the picture changes while the window rests: on a short first mark the window shrinks faster', () => {
      const edit = two(3.4, ({ fill }) => { fill.script.open = '[hook]I[/hook] [proof]tried Glow Serum for two weeks. Look at this.[/proof]'; });
      // [hook] is frames 6 … 8, the picture changes on 9: the shrink may take 3 frames
      expect(edit.shots[0]!.windows).toEqual([{ at: 6, for: 138, corner: 'top-right', behind: 'product-1', frames: 3, swaps: [{ at: 9, behind: 'still-skin' }] }]);
    });
    it('a later picture the customer did not give is no change; a first one not given leaves the later window alone', () => {
      const later = two(3.4, ({ template }) => { template.windows[0].behind = 'product:1.2'; });
      expect(later.shots[0]!.windows).toEqual([{ at: 6, for: 78, corner: 'top-right', behind: 'product-1' }]);
      const first = two(3.4, ({ template }) => { template.windows[1].behind = 'product:1.2'; });
      expect(first.shots[0]!.windows).toEqual([{ at: 102, for: 42, corner: 'top-right', behind: 'still-skin' }]);
    });
  });
  it('copies caption, card and music fields as they are, and has no captions when the template has none', () => {
    const edit = run(changed(timed(), ({ template }) => {
      template.captions = { ...template.captions, style: 'main', group: { words: 2, lines: 1 }, active: { kind: 'pill', colour: '#b76e79' }, enter: { kind: 'fade', frames: 3 } };
      template.cards[0] = { ...template.cards[0], radius: 4, enter: { kind: 'pop', frames: 7 }, exit: { kind: 'fade' }, motion: { kind: 'push-in' }, safe: false };
      template.windows[0] = { ...template.windows[0], width: 30, radius: 3, behindMotion: { kind: 'push-in', to: 1.06 } };
      template.audio.music = { prompt: 'p', gain: 0.1, fadeOut: 21, duck: { to: 0.05, under: 'sound' } };
      template.shots[1].in = { kind: 'flash', frames: 6 };
      template.shots[1].motion = { kind: 'pull-out' };
    }));
    expect(edit.captions).toMatchObject({ style: 'main', group: { words: 2, lines: 1 }, active: { kind: 'pill', colour: '#b76e79' }, enter: { kind: 'fade', frames: 3 } });
    expect(edit.cards![0]).toMatchObject({ radius: 4, enter: { kind: 'pop', frames: 7 }, exit: { kind: 'fade' }, motion: { kind: 'push-in' }, safe: false });
    expect(edit.shots[0]!.windows![0]).toEqual({ at: 102, for: 42, corner: 'top-right', behind: 'still-skin', width: 30, radius: 3, behindMotion: { kind: 'push-in', to: 1.06 } });
    expect(edit.audio).toEqual({ music: { media: 'music', gain: 0.1, fadeOut: 21, duck: { to: 0.05, under: 'sound' } } });
    expect(edit.shots[1]).toMatchObject({ in: { kind: 'flash', frames: 6 }, motion: { kind: 'pull-out' } });
    const bare = run(changed(timed(), ({ template }) => { delete template.captions; template.cards = []; }));
    expect(bare.captions).toBeUndefined();
    expect(bare.cards).toBeUndefined();
  });
  it('a card shows its whole picture; only a card that fills the frame is cropped to it (fit: cover)', () => {
    const edit = run(changed(timed(), ({ template }) => {
      template.cards.push({ id: 'c2', mark: 'hook', image: 'still:skin', box: { left: 0, top: 0, right: 100, bottom: 100 }, radius: 0, safe: false });
    }));
    expect(edit.cards![0]).not.toHaveProperty('fit');
    expect(edit.cards![1]).toMatchObject({ id: 'c2', fit: 'cover', safe: false, radius: 0 });
  });
  it('the music goes down under the voice by default: to its gain, and never above 0.15', () => {
    expect(run(timed()).audio).toEqual({ music: { media: 'music', gain: 0.1, duck: { to: 0.1, under: 'sound' } } });
    expect(run(changed(timed(), ({ template }) => { template.audio.music.gain = 0.6; })).audio).toEqual({ music: { media: 'music', gain: 0.6, duck: { to: 0.15, under: 'sound' } } });
    expect(run(changed(timed(), ({ template }) => { template.audio.music.duck = { to: 0.3, ramp: 4, under: 'captions' }; template.audio.music.gain = 0.6; })).audio!.music!.duck).toEqual({ to: 0.3, ramp: 4, under: 'captions' });
  });
  it('a card or a window on a product or a photograph the customer did not give is left out', () => {
    const more = (image: string) => (given: Case) => { given.template.cards.push({ id: 'c2', mark: 'hook', image, box: { left: 60, top: 27, right: 86, bottom: 50 } }); };
    expect(run(changed(timed(), more('product:1.2'))).cards!.map((card) => card.id)).toEqual(['c1']);
    expect(run(changed(timed(), more('product:2'))).cards!.map((card) => card.id)).toEqual(['c1']);       // the template takes 1 to 2 products
    expect(run(changed(timed(), ({ template }) => { template.windows[0].behind = 'product:1.3'; })).shots[0]!.windows).toBeUndefined();
    const given = changed(timed(), (c) => {
      more('product:1.2')(c);
      c.template.cards.push({ id: 'c3', mark: 'proof', image: 'product:2', box: { left: 60, top: 27, right: 86, bottom: 50 } });
      c.fill.products = [{ name: 'Glow Serum', images: ['uploads/u1/a.png', 'uploads/u1/b.png'] }, { name: 'Glow Cream', images: ['uploads/u1/c.png'] }];
      c.media.images['product:1.2'] = 'assets/product-1-2.png';
      c.media.images['product:2'] = 'assets/product-2-1.png';
    });
    const edit = run(given);
    expect(edit.cards!.map((card) => [card.id, card.media])).toEqual([['c1', 'product-1'], ['c2', 'product-1-2'], ['c3', 'product-2']]);
    expect(edit.media['product-1-2']).toEqual({ file: 'assets/product-1-2.png', kind: 'image' });
  });
  it('media-missing: a photograph the customer gave that the run did not hand over', () => {
    const given = changed(timed(), ({ template, fill }) => {
      template.cards.push({ id: 'c2', mark: 'hook', image: 'product:1.2', box: { left: 60, top: 27, right: 86, bottom: 50 } });
      fill.products[0].images.push('uploads/u1/b.png');
    });
    expect(codeOf(given)).toBe('media-missing');
  });
  it('media-missing: a first photograph, a still, a clip or the words of a segment', () => {
    expect(codeOf(changed(timed(), ({ media }) => { delete media.images['product:1']; }))).toBe('media-missing');
    expect(codeOf(changed(timed(), ({ media }) => { delete media.images['still:skin']; }))).toBe('media-missing');
    expect(codeOf(changed(timed(), ({ media }) => { delete media.clips.s2; }))).toBe('media-missing');
    expect(codeOf(changed(timed(), ({ media }) => { delete media.words.close; }))).toBe('media-missing');
  });
  it('mark-unknown: a text, a card or a window names a mark that no script has', () => {
    expect(codeOf(changed(timed(), ({ template }) => { template.texts[0].mark = 'ghost'; }))).toBe('mark-unknown');
    expect(codeOf(changed(timed(), ({ template }) => { template.cards[0].mark = 'ghost'; }))).toBe('mark-unknown');
    expect(codeOf(changed(timed(), ({ template }) => { template.windows[0].mark = 'ghost'; }))).toBe('mark-unknown');
    expect(codeOf(changed(timed(), ({ template }) => { delete template.texts[0].mark; }))).toBe('mark-unknown');
  });
  it('mark-unbalanced: the lines of the fill open a mark and never close it', () => {
    expect(codeOf(changed(timed(), ({ fill }) => { fill.script.close = 'It is [name]the Glow Serum.'; }))).toBe('mark-unbalanced');
  });
  it('refuses a fill that lost a mark of the template’s script (mark-lost), before it looks at any media', () => {
    const lost = changed(timed(), ({ fill, media }) => { fill.script.open = 'I tried Glow Serum for two weeks. [proof]Look at this.[/proof]'; media.clips = {}; });
    expect(codeOf(lost)).toBe('mark-lost');
  });
  it('refuses what checkFill refuses, with its first code: a copy that repeats the reference, an entry the template does not have', () => {
    expect(codeOf(changed(timed(), ({ fill }) => { fill.texts.x1 = 'i tried  RIVALBRAND'; }))).toBe('copy-is-source');
    expect(codeOf(changed(timed(), ({ fill }) => { fill.texts.x9 = 'Hello'; }))).toBe('fill-unknown');
    expect(codeOf(changed(timed(), ({ fill }) => { fill.texts.x1 = 'Try {Product-1}'; }))).toBe('unfilled:Product-1');
  });
  it('segment-short: a clip with fewer frames than its segment has words', () => {
    expect(codeOf(changed(timed(), ({ media }) => { media.clips.s2!.frames = 4; }))).toBe('segment-short');
  });
  it('nothing heard at all: every word still gets its frames inside its segment', () => {
    const edit = run(changed(timed(), ({ media }) => { media.words = { open: [], close: [] }; }));
    expect(edit.captions!.words).toHaveLength(15);
    expect(edit.captions!.words[10]!.at).toBeGreaterThanOrEqual(180);
  });

  it('whatever the recogniser heard: words in order and not overlapping, every element inside the video, every window inside its shot', () => {
    const anyWord = fc.record({ text: fc.constantFrom('I', 'tried', 'glow', 'serum', 'look', 'this', 'the', 'banana', ''), start: fc.double({ min: -1, max: 12, noNaN: true }), end: fc.double({ min: -1, max: 12, noNaN: true }) });
    const anyWords = fc.array(anyWord, { maxLength: 20 });
    fc.assert(fc.property(anyWords, anyWords, fc.integer({ min: 20, max: 420 }), fc.integer({ min: 20, max: 420 }), (open, close, first, second) => {
      const edit = run(changed(timed(), ({ media, template }) => {
        template.windows.push({ mark: 'hook', corner: 'top-right', behind: 'product:1' });
        media.words = { open, close };
        media.clips.s1!.frames = first; media.clips.s2!.frames = second;
        media.music!.frames = first + second;                    // the music is as long as the video, as in placeholderMedia
      }));
      expect(edit.frames).toBe(first + second);
      let free = 0;
      for (const word of edit.captions!.words) {
        expect(word.at).toBeGreaterThanOrEqual(free);
        expect(word.for).toBeGreaterThanOrEqual(1);
        free = word.at + word.for;
      }
      expect(free).toBeLessThanOrEqual(edit.frames);
      for (const element of [...edit.texts!, ...edit.cards!]) {
        expect(element.for).toBeGreaterThanOrEqual(1);
        expect(element.at + element.for).toBeLessThanOrEqual(edit.frames);
      }
      for (const shot of edit.shots) {
        let open = shot.at;
        for (const window of shot.windows ?? []) {
          const move = window.frames ?? 10;
          expect(window.at).toBeGreaterThanOrEqual(open);                              // inside the shot, after the window before it
          open = window.at + window.for;
          expect(open).toBeLessThanOrEqual(shot.at + shot.for);
          expect(window.for).toBeGreaterThanOrEqual(2 * move + 1);
          let changed = window.at + move - 1;
          for (const swap of window.swaps ?? []) {                                     // ascending, while the window rests
            expect(swap.at).toBeGreaterThan(changed);
            expect(swap.at).toBeLessThan(window.at + window.for - move);
            expect(edit.media[swap.behind]!.kind).toBe('image');
            changed = swap.at;
          }
        }
      }
    }), { numRuns: 300 });
  });
  it('whatever the recogniser heard and however long the clips are: the editor accepts the document', () => {
    const anyWord = fc.record({ text: fc.constantFrom('I', 'tried', 'glow', 'serum', 'look', 'this', 'the', 'banana'), start: fc.double({ min: 0, max: 14, noNaN: true }), end: fc.double({ min: 0, max: 14, noNaN: true }) });
    const anyWords = fc.array(anyWord, { maxLength: 20 });
    const animated = (given: Case): Case => changed(given, ({ template }) => {
      template.texts[0] = { ...template.texts[0], enter: { kind: 'pop', frames: 12 }, exit: { kind: 'slide', to: 'top', frames: 10 } };
      template.texts.push({ id: 'x2', mark: 'name', box: { left: 14, top: 26, right: 86, bottom: 34 }, style: 'main', copy: '{product}', source_copy: '' });
      template.cards[0].exit = { kind: 'blur', frames: 9 };
      template.windows[0].frames = 14;
      template.shots[1].in = { kind: 'dip', frames: 10 };
    });
    fc.assert(fc.property(anyWords, anyWords, fc.integer({ min: 30, max: 420 }), fc.integer({ min: 30, max: 420 }), (open, close, first, second) => {
      const given = changed(animated(timed()), ({ media, fill }) => {
        fill.texts.x2 = 'Glow Serum';
        media.words = { open, close };
        media.clips.s1!.frames = first; media.clips.s2!.frames = second;
        media.music!.frames = first + second;                    // the music is as long as the video, as in placeholderMedia
      });
      const edit = run(given);
      expect(validate(edit, placeholderFacts(edit, given.media))).toEqual([]);
    }), { numRuns: 300 });
  });
});

describe('resolve: what reaches the edit document', () => {
  const marked = (given: Case): Case => changed(given, ({ template, fill }) => {
    template.texts[0].source_copy = 'Rivalbrand Lash Booster, the original';
    template.texts[0].copy = 'PATTERN {product}';
    template.title = 'TITLE-OF-TEMPLATE';
    template.description = 'DESCRIPTION-OF-TEMPLATE';
    template.audio.music.prompt = 'PROMPT-T-MUSIC';
    for (const shot of template.shots) { shot.motion_prompt = 'PROMPT-T-MOTION'; if (shot.still_prompt) shot.still_prompt = 'PROMPT-T-STILL'; shot.action = 'ACTION-OF-SHOT'; }
    fill.music.prompt = 'PROMPT-F-MUSIC';
    for (const shot of Object.values<Json>(fill.shots)) { shot.motion_prompt = 'PROMPT-F-MOTION'; if (shot.still_prompt) shot.still_prompt = 'PROMPT-F-STILL'; }
    if (template.presenter) { template.presenter.still_prompt = 'PROMPT-T-PRESENTER'; template.presenter.voice.sample_text = 'PROMPT-T-VOICE'; template.stills[0].prompt = 'PROMPT-T-EVIDENCE'; }
    if (fill.presenter) { fill.presenter.still_prompt = 'PROMPT-F-PRESENTER'; fill.stills.skin.prompt = 'PROMPT-F-EVIDENCE'; }
    fill.products[0].name = 'NAME-OF-PRODUCT';
  });
  it.each([['beats', beatsCase], ['speech', speechCase]] as const)('%s: a rival brand name in source_copy, the copy pattern and every prompt stay out', (_mode, make) => {
    const text = JSON.stringify(run(marked(make())));
    expect(text).not.toMatch(/Rivalbrand|PATTERN|PROMPT|TITLE-OF|DESCRIPTION-OF|ACTION-OF|NAME-OF-PRODUCT|voice-1/);
    expect(text).toContain(make().fill.texts.x1);
  });
  it('speech: the words of the template’s script stay out, the words of the fill’s script go in', () => {
    const text = JSON.stringify(run(changed(speechCase(), ({ template }) => {
      template.script.segments[0].lines = '[hook]RIVALWORD one.[/hook] [proof]two[/proof]';
      template.texts[0].source_copy = 'I tried Rivalbrand';
    })));
    expect(text).not.toMatch(/RIVALWORD|Rivalbrand/);
    expect(text).toContain('"Serum"');
  });
  it('unfilled:<placeholder>: a placeholder left in a copy', () => {
    expect(codeOf(changed(beatsCase(), ({ fill }) => { fill.texts.x1 = 'Hi {product}'; }))).toBe('unfilled:product');
    expect(codeOf(changed(speechCase(), ({ fill }) => { fill.texts.x1 = 'I tried {brand} {product}'; }))).toBe('unfilled:brand');
    expect(() => run(changed(beatsCase(), ({ fill }) => { fill.texts.x1 = 'Hi {product}'; }))).toThrow(/texts\.x1/);
  });
  it('is pure: the same input gives the same document, and the input is neither changed nor shared', () => {
    for (const make of [beatsCase, speechCase]) {
      const given = freeze(make());
      const first = run(given), second = run(given);
      expect(second).toEqual(first);
      expect(given).toEqual(make());
      first.styles!.main!.size = 1;
      first.canvas.width = 720;
      expect(given.template.styles.main.size).toBe(48);
      expect(run(given)).toEqual(second);
    }
  });
});
