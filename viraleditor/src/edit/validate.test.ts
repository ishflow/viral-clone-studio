import { describe, expect, it } from 'vitest';
import { limitEdit, limitFacts, shortEdit, shortFacts } from '../compose/fixture.ts';
import { COUNTS } from './presets.ts';
import { MAX_ISSUES, parseEdit } from './schema.ts';
import type { ComposeFacts, Edit, EditIssue } from './types.ts';
import { validate } from './validate.ts';

/** The issues of the short document after `change`. */
function issuesOf(change: (edit: Edit, facts: Record<string, ComposeFacts>) => void): EditIssue[] {
  const edit = shortEdit();
  const facts = shortFacts();
  change(edit, facts);
  return validate(edit, facts);
}
/** Exactly one issue, with every field filled. */
function only(change: (edit: Edit, facts: Record<string, ComposeFacts>) => void): EditIssue {
  const issues = issuesOf(change);
  expect(issues.map((i) => `${i.code} @ ${i.path}`)).toHaveLength(1);
  const issue = issues[0]!;
  expect(issue.message.length).toBeGreaterThan(10);
  expect(issue.fix.length).toBeGreaterThan(10);
  return issue;
}
const style = { font: 'Inter' as const, weight: 700, size: 40, align: 'center' as const, fill: '#ffffff', shadows: [] as string[] };

describe('validate: a document that is right', () => {
  it('finds nothing in the short document of the design', () => {
    expect(issuesOf(() => {})).toEqual([]);
    expect(validate(shortEdit(720), shortFacts())).toEqual([]);
  });

  it('accepts the document exactly as the design prints it: its wide hook at the top needs no "safe": false', () => {
    const hook = shortEdit().texts![0]!;
    expect(hook.box).toEqual({ left: 9, top: 15, right: 91, bottom: 27 });
    expect('safe' in hook).toBe(false);
  });
});

describe('validate: one test per error code', () => {
  it('canvas-unsupported: a width and a height that do not belong together', () => {
    const issue = only((e) => { e.canvas.height = 1280; });
    expect(issue).toMatchObject({ code: 'canvas-unsupported', path: 'canvas' });
    expect(issue.message).toContain('1080×1280');
  });

  it('id-duplicate: two elements with one id', () => {
    const issue = only((e) => { e.cards![0]!.id = 's2'; });
    expect(issue).toMatchObject({ code: 'id-duplicate', path: 'cards[0].id' });
    expect(issue.message).toContain('shots[1]');
    expect(issue.message).toContain('"s2"');
  });

  it('id-duplicate: an id that an element made by compose already has', () => {
    expect(only((e) => { e.cards![0]!.id = 'hook-2'; })).toMatchObject({ code: 'id-duplicate', path: 'cards[0].id' });
    expect(only((e) => { e.cards![0]!.id = 's1-v'; })).toMatchObject({ code: 'id-duplicate', path: 'cards[0].id' });
    expect(only((e) => { e.cards![0]!.id = 'cap-1'; })).toMatchObject({ code: 'id-duplicate', path: 'cards[0].id' });
    expect(only((e) => { e.shots[0]!.id = 'root'; })).toMatchObject({ code: 'id-duplicate', path: 'shots[0].id' });
    expect(only((e) => { e.shots[0]!.id = 'music-1'; })).toMatchObject({ code: 'id-duplicate', path: 'shots[0].id' });
  });

  it('id-duplicate: an id from which compose would make the id of one of its own elements', () => {
    const cap = only((e) => { e.texts![0]!.id = 'cap'; });                       // its lines would be cap-1, cap-2: the caption groups
    expect(cap).toMatchObject({ code: 'id-duplicate', path: 'texts[0].id' });
    expect(cap.message).toContain('"cap-1"');
    const music = only((e) => { e.texts![0]!.id = 'music'; });                   // its first line would be music-1: the music
    expect(music).toMatchObject({ code: 'id-duplicate', path: 'texts[0].id' });
    expect(music.message).toContain('"music-1"');
    // an earlier element whose made id a later one has as its own: one issue, on the later one
    expect(only((e) => { e.shots[0]!.id = 'hook-1'; })).toMatchObject({ code: 'id-duplicate', path: 'texts[0].id' });
    expect(issuesOf((e) => { e.cards![0]!.id = 'cap'; e.audio!.sounds = []; })).toEqual([]);   // a card makes cap-box only
  });

  it('media-unknown: a key that media lacks', () => {
    const issue = only((e) => { e.shots[1]!.media = 'd'; });
    expect(issue).toMatchObject({ code: 'media-unknown', path: 'shots[1].media' });
    expect(issue.message).toContain('a, b, c, serum, beat');
    expect(only((e) => { e.cards![0]!.media = 'constructor'; }).code).toBe('media-unknown');
    expect(only((e) => { e.audio!.music!.media = 'tune'; }).path).toBe('audio.music.media');
  });

  it('media-facts: a video or audio file whose facts were not given', () => {
    const issue = only((_, facts) => { delete facts.b; });
    expect(issue).toMatchObject({ code: 'media-facts', path: 'media.b' });
    expect(issue.fix).toContain('assets/b.mp4');
    expect(issue.fix).toContain('{ frames, audio, width, height }');
  });

  it('media-facts: facts that are not facts are an issue, never a throw', () => {
    const wrong = (value: unknown, key = 'a') => only((_, facts) => { (facts as Record<string, unknown>)[key] = value; });
    expect(wrong(null)).toMatchObject({ code: 'media-facts', path: 'media.a' });
    expect(wrong({ frames: '150', audio: false })).toMatchObject({ code: 'media-facts', path: 'media.a' });
    expect(wrong({ frames: 150 })).toMatchObject({ code: 'media-facts', path: 'media.a' });
    expect(wrong({ frames: 150.5, audio: true }).message).toContain('150.5');
    expect(wrong({ frames: -1, audio: true }).code).toBe('media-facts');
    expect(wrong([150, false]).code).toBe('media-facts');
    expect(wrong({ frames: 150, audio: false, width: '720' }).code).toBe('media-facts');
    // an image too, and its card says nothing more about it
    expect(wrong(7, 'serum')).toMatchObject({ code: 'media-facts', path: 'media.serum' });
    expect(wrong(null, 'beat')).toMatchObject({ code: 'media-facts', path: 'media.beat' });
    // the size of a picture is a whole number of pixels above 0: anything else is not facts (and not `media-size-unknown`)
    for (const size of [Number.NaN, -5, 0, 720.5, Number.POSITIVE_INFINITY]) {
      expect(wrong({ frames: 0, audio: false, width: size, height: 1280 }, 'serum')).toMatchObject({ code: 'media-facts', path: 'media.serum' });
      expect(wrong({ frames: 150, audio: false, width: 720, height: size })).toMatchObject({ code: 'media-facts', path: 'media.a' });
    }
    expect(wrong({ frames: 0, audio: false, width: 720.5, height: 1280 }, 'serum').message).toContain('whole number of pixels');
    // a sound has no picture: a size given for it is not looked at
    expect(issuesOf((_, facts) => { facts.beat = { frames: 900, audio: true, width: 0, height: 0 }; })).toEqual([]);
    for (const none of [null, undefined, 7, 'facts', []]) {
      expect(validate(shortEdit(), none as never).map((i) => `${i.code} @ ${i.path}`))
        .toEqual(['media-facts @ media.a', 'media-facts @ media.b', 'media-facts @ media.c', 'media-facts @ media.beat', 'media-size-unknown @ cards[0]']);
    }
  });

  it('media-kind: a file of the wrong kind', () => {
    expect(only((e) => { e.shots[0]!.media = 'beat'; })).toMatchObject({ code: 'media-kind', path: 'shots[0].media' });
    expect(only((e) => { e.cards![0]!.media = 'a'; })).toMatchObject({ code: 'media-kind', path: 'cards[0].media' });
    expect(only((e) => { e.audio!.music!.media = 'serum'; })).toMatchObject({ code: 'media-kind', path: 'audio.music.media' });
    const sound = only((e) => { e.shots[0]!.sound = { gain: 1 }; });
    expect(sound).toMatchObject({ code: 'media-kind', path: 'shots[0].sound' });
    expect(sound.message).toContain('no sound');
  });

  it('media-file: a file outside assets/ or with other characters', () => {
    const issue = only((e) => { e.media.a!.file = '../secret/a b.mp4'; });
    expect(issue).toMatchObject({ code: 'media-file', path: 'media.a.file' });
    expect(issue.fix).toContain('assets/a_b.mp4');
    expect(only((e) => { e.media.a!.file = 'assets/a.mp4" onerror="x'; }).code).toBe('media-file');
    // a name starts with a letter, a digit, "_" or "-": never the folder itself, its parent or a hidden file
    for (const file of ['assets/.', 'assets/..', 'assets/.env', 'assets/']) expect(only((e) => { e.media.a!.file = file; })).toMatchObject({ code: 'media-file', path: 'media.a.file' });
    expect(issuesOf((e) => { e.media.a!.file = 'assets/_a-1.v2.mp4'; })).toEqual([]);
  });

  it('shots-gap: a shot that does not start where the one before ends', () => {
    const issue = only((e) => { e.shots[1]!.at = 61; e.shots[1]!.for = 59; e.shots[1]!.motion = { kind: 'punch-in', at: 90 }; });
    expect(issue).toMatchObject({ code: 'shots-gap', path: 'shots[1].at' });
    expect(issue.fix).toContain('60');
    expect(only((e) => { e.frames = 190; })).toMatchObject({ code: 'shots-gap', path: 'frames' });
  });

  it('shot-too-long: a shot of more than 15 s', () => {
    const issue = only((e, facts) => {
      e.shots = [{ id: 's1', at: 0, for: 451, media: 'a' }];
      e.frames = 451; facts.a = { frames: 500, audio: false };
      delete e.texts; delete e.cards; delete e.captions;
    });
    expect(issue).toMatchObject({ code: 'shot-too-long', path: 'shots[0].for' });
    expect(issue.message).toContain('450');
  });

  it('too-long: a video of more than 60 s', () => {
    const issue = only((e, facts) => {
      e.shots = Array.from({ length: 5 }, (_, i) => ({ id: `s${i + 1}`, at: i * 400, for: 400, media: 'a' }));
      e.frames = 2000; facts.a = { frames: 400, audio: false }; facts.beat = { frames: 2000, audio: true };
    });
    expect(issue).toMatchObject({ code: 'too-long', path: 'frames' });
    expect(issue.message).toContain('1800');
  });

  it('too-long: nothing walks the frames of a video that is too long', () => {
    // a huge "frames" with looped music: the passes of the music are not made (3.3 million of them here, more with a larger number)
    const issues = issuesOf((e, facts) => { e.frames = 300_000_000; e.audio!.music!.loop = true; facts.beat = { frames: 90, audio: true }; });
    expect(issues.map((i) => `${i.code} @ ${i.path}`)).toEqual(['too-long @ frames', 'shots-gap @ frames']);
    // seen from outside: the points of the volume lanes are not counted either
    const dense = issuesOf((e, facts) => {
      e.shots = Array.from({ length: 5 }, (_, i) => ({ id: `s${i + 1}`, at: i * 400, for: 400, media: 'a' }));
      e.frames = 2000; facts.a = { frames: 400, audio: false }; facts.beat = { frames: 2000, audio: true };
      delete e.texts; delete e.cards; delete e.captions;
      e.audio!.music!.duck = { to: 0.2, ramp: 1, under: Array.from({ length: 200 }, (_, i) => ({ at: 4 + i * 8, for: 2 })) };
    });
    expect(dense.map((i) => i.code)).toEqual(['too-long']);
  });

  it('clip-short: a clip with fewer frames than its shot and tail need', () => {
    const issue = only((_, facts) => { facts.b = { frames: 85, audio: false }; });
    expect(issue).toMatchObject({ code: 'clip-short', path: 'shots[1]' });
    expect(issue.message).toContain('88');
    expect(issue.message).toContain('85');
    expect(issue.message).toContain('whip');
    expect(issue.fix).toContain('shots[1].from to 17');
    expect(issue.fix).toContain('"cut"');
  });

  it('schema: "from" on a shot that shows an image', () => {
    const issue = only((e) => { e.shots[0] = { id: 's1', at: 0, for: 60, media: 'serum', from: 10 }; });
    expect(issue).toMatchObject({ code: 'schema', path: 'shots[0].from' });
    expect(issue.fix).toContain('remove shots[0].from');
    expect(only((e) => { e.shots[0] = { id: 's1', at: 0, for: 60, media: 'serum', from: 0 }; }).code).toBe('schema');
    expect(issuesOf((e) => { e.shots[0] = { id: 's1', at: 0, for: 60, media: 'serum' }; })).toEqual([]);
  });

  it('transition-first: the first shot comes in by a transition', () => {
    expect(only((e) => { e.shots[0]!.in = { kind: 'crossfade' }; })).toMatchObject({ code: 'transition-first', path: 'shots[0].in' });
  });

  it('transition-too-long: a transition longer than half of a shot it joins', () => {
    const issue = only((e) => { e.shots[2]!.in = { kind: 'dip', frames: 31 }; });
    expect(issue).toMatchObject({ code: 'transition-too-long', path: 'shots[2].in.frames' });
    expect(issue.fix).toContain('30');
  });

  it('motion-range: a scale outside 1.01 … 1.5, a punch-in outside its shot', () => {
    expect(only((e) => { e.shots[0]!.motion = { kind: 'push-in', to: 2 }; })).toMatchObject({ code: 'motion-range', path: 'shots[0].motion.to' });
    expect(only((e) => { e.shots[2]!.motion = { kind: 'pull-out', from: 1 }; })).toMatchObject({ code: 'motion-range', path: 'shots[2].motion.from' });
    expect(only((e) => { e.shots[2]!.in = { kind: 'zoom', scale: 3 }; })).toMatchObject({ code: 'motion-range', path: 'shots[2].in.scale' });
    const punch = only((e) => { e.shots[1]!.motion = { kind: 'punch-in', at: 30 }; });
    expect(punch).toMatchObject({ code: 'motion-range', path: 'shots[1].motion.at' });
    expect(punch.message).toContain('60');
    expect(only((e) => { e.shots[1]!.motion = { kind: 'punch-in', at: 118 }; }).path).toBe('shots[1].motion.at');
    expect(only((e) => { e.cards![0]!.motion = { kind: 'punch-in', at: 80 }; })).toMatchObject({ code: 'motion-range', path: 'cards[0].motion.kind' });
  });

  it('window-range: a window that leaves its shot, is too short, or meets another', () => {
    const base = { corner: 'bottom-right' as const, behind: 'serum' };
    expect(only((e) => { e.shots[0]!.windows = [{ ...base, at: 40, for: 30 }]; })).toMatchObject({ code: 'window-range', path: 'shots[0].windows[0]' });
    const short = only((e) => { e.shots[0]!.windows = [{ ...base, at: 10, for: 20 }]; });
    expect(short.code).toBe('window-range');
    expect(short.fix).toContain('21');
    expect(only((e) => { e.shots[0]!.windows = [{ ...base, at: 5, for: 25 }, { ...base, at: 29, for: 25 }]; })).toMatchObject({ code: 'window-range', path: 'shots[0].windows[1]' });
  });

  it('window-range: a window wider than the safe area is high (R1 fix I1): the message names the widest one for this "safe"', () => {
    const base = { at: 5, for: 25, corner: 'bottom-left' as const, behind: 'serum' };
    // 'both' (the default) and 'reels' are 51 % high: the widest window is 50 (a window has the canvas's ratio)
    const wide = only((e) => { e.shots[0]!.windows = [{ ...base, width: 60 }]; });
    expect(wide).toMatchObject({ code: 'window-range', path: 'shots[0].windows[0].width' });
    expect(wide.message).toContain('60');
    expect(wide.fix).toContain('shots[0].windows[0].width to 50');
    expect(only((e) => { e.safe = 'reels'; e.shots[0]!.windows = [{ ...base, width: 50.5 }]; }).path).toBe('shots[0].windows[0].width');
    expect(issuesOf((e) => { e.shots[0]!.windows = [{ ...base, width: 50 }]; })).toEqual([]);
    expect(issuesOf((e) => { e.safe = 'tiktok'; e.shots[0]!.windows = [{ ...base, width: 60 }]; })).toEqual([]);      // 70 % high
    expect(issuesOf((e) => { e.safe = 'none'; e.shots[0]!.windows = [{ ...base, width: 60 }]; })).toEqual([]);
    expect(issuesOf((e) => { e.shots[0]!.windows = [{ ...base, width: 51 }]; })[0]?.fix).toContain('to 50');          // 51 is as high as the area itself: the rounding of the window to whole pixels could push it out, so it keeps 1 % clear
  });

  it('window-range: the windows of one shot out of time order', () => {
    const base = { corner: 'bottom-right' as const, behind: 'serum' };
    // frames 30 … 54, then 2 … 22: the later animation of a list wins, so the first window would never show
    const issue = only((e) => { e.shots[0]!.windows = [{ ...base, at: 30, for: 25 }, { ...base, at: 2, for: 21 }]; });
    expect(issue).toMatchObject({ code: 'window-range', path: 'shots[0].windows[1]' });
    expect(issue.message).toContain('ascending');
    expect(issue.fix).toContain('windows[0]');
    expect(issuesOf((e) => { e.shots[0]!.windows = [{ ...base, at: 2, for: 21 }, { ...base, at: 30, for: 25 }]; })).toEqual([]);
  });

  it('window-range: two windows of one shot at different places', () => {
    const base = { corner: 'bottom-right' as const, behind: 'serum' };
    const issue = only((e) => { e.shots[0]!.windows = [{ ...base, at: 2, for: 25 }, { ...base, corner: 'top-left', at: 30, for: 25 }]; });
    expect(issue).toMatchObject({ code: 'window-range', path: 'shots[0].windows[1]' });
    expect(issue.fix).toContain('split the shot');
  });

  it('window-range: a swap of the picture behind outside the rest of its window, or swaps out of order', () => {
    // on the first shot (frames 0 … 59): the window shrinks on 2 … 11, rests on 12 … 41, returns on 42 … 51
    const base = { corner: 'bottom-right' as const, behind: 'serum', at: 2, for: 50 };
    const early = only((e) => { e.shots[0]!.windows = [{ ...base, swaps: [{ at: 11, behind: 'serum' }] }]; });
    expect(early).toMatchObject({ code: 'window-range', path: 'shots[0].windows[0].swaps[0].at' });
    expect(early.fix).toContain('from 12 to 41');
    expect(only((e) => { e.shots[0]!.windows = [{ ...base, swaps: [{ at: 42, behind: 'serum' }] }]; })).toMatchObject({ code: 'window-range', path: 'shots[0].windows[0].swaps[0].at' });
    const order = only((e) => { e.shots[0]!.windows = [{ ...base, swaps: [{ at: 30, behind: 'serum' }, { at: 20, behind: 'serum' }] }]; });
    expect(order).toMatchObject({ code: 'window-range', path: 'shots[0].windows[0].swaps[1].at' });
    expect(order.message).toContain('ascending');
    expect(only((e) => { e.shots[0]!.windows = [{ ...base, swaps: [{ at: 30, behind: 'serum' }, { at: 30, behind: 'serum' }] }]; }).path).toBe('shots[0].windows[0].swaps[1].at');
    expect(issuesOf((e) => { e.shots[0]!.windows = [{ ...base, swaps: [{ at: 12, behind: 'serum' }, { at: 41, behind: 'b' }] }]; })).toEqual([]);
  });

  it('media-unknown, media-kind, clip-short: the picture a swap brings', () => {
    const base = { corner: 'bottom-right' as const, behind: 'serum', at: 2, for: 50 };
    expect(only((e) => { e.shots[0]!.windows = [{ ...base, swaps: [{ at: 20, behind: 'nope' }] }]; })).toMatchObject({ code: 'media-unknown', path: 'shots[0].windows[0].swaps[0].behind' });
    expect(only((e) => { e.shots[0]!.windows = [{ ...base, swaps: [{ at: 20, behind: 'beat' }] }]; })).toMatchObject({ code: 'media-kind', path: 'shots[0].windows[0].swaps[0].behind' });
    const short = only((e, facts) => { facts.b = { frames: 150, audio: false }; facts.c = { frames: 20, audio: false }; e.shots[0]!.windows = [{ ...base, behind: 'b', swaps: [{ at: 20, behind: 'c' }] }]; e.shots[2]!.media = 'b'; });
    expect(short).toMatchObject({ code: 'clip-short', path: 'shots[0].windows[0].swaps[0]' });
    expect(short.message).toContain('32 frames');                                         // frames 20 … 51
    expect(only((e, facts) => { facts.c = { frames: 17, audio: false }; e.shots[0]!.windows = [{ ...base, behind: 'c', swaps: [{ at: 20, behind: 'serum' }] }]; e.shots[2]!.media = 'b'; }))
      .toMatchObject({ code: 'clip-short', path: 'shots[0].windows[0]' });                   // the first picture: frames 2 … 19
  });

  it('id-duplicate: an id that a picture of a swap already has', () => {
    const base = { corner: 'bottom-right' as const, behind: 'serum', at: 2, for: 50 };
    expect(only((e) => { e.shots[0]!.windows = [{ ...base, swaps: [{ at: 20, behind: 'serum' }] }]; e.cards![0]!.id = 's1-b1-s1'; })).toMatchObject({ code: 'id-duplicate', path: 'cards[0].id' });
  });

  it('media-size-unknown: a card that shows its whole picture needs the size of the picture', () => {
    const issue = only((_, facts) => { facts.serum = { frames: 0, audio: false }; });
    expect(issue).toMatchObject({ code: 'media-size-unknown', path: 'cards[0]' });
    expect(issue.fix).toContain('width');
    expect(issue.fix).toContain('"fit": "cover"');
    expect(only((_, facts) => { delete facts.serum; }).code).toBe('media-size-unknown');
    expect(only((_, facts) => { facts.serum = { frames: 0, audio: false, width: 720 }; }).code).toBe('media-size-unknown');      // one of the two is not a size
    expect(issuesOf((e, facts) => { facts.serum = { frames: 0, audio: false }; e.cards![0]!.fit = 'cover'; })).toEqual([]);
  });

  it('window-range: a window during the transition that brings its shot in, or on a shot that zooms', () => {
    const base = { corner: 'bottom-right' as const, behind: 'serum' };
    const early = only((e) => { e.shots[1]!.windows = [{ ...base, at: 64, for: 30 }]; });
    expect(early).toMatchObject({ code: 'window-range', path: 'shots[1].windows[0].at' });
    expect(early.fix).toContain('68');
    const zoom = only((e) => { e.shots[2]!.in = { kind: 'zoom' }; e.shots[2]!.windows = [{ ...base, at: 130, for: 30 }]; });
    expect(zoom).toMatchObject({ code: 'window-range', path: 'shots[2].in.kind' });
  });

  it('box-out-of-range: a box outside the canvas, inside out, or too small', () => {
    expect(only((e) => { e.cards![0]!.box = { left: 31, top: 36, right: 101, bottom: 58 }; e.cards![0]!.safe = false; })).toMatchObject({ code: 'box-out-of-range', path: 'cards[0].box' });
    expect(only((e) => { e.texts![0]!.box = { left: 50, top: 15, right: 40, bottom: 27 }; })).toMatchObject({ code: 'box-out-of-range', path: 'texts[0].box' });
    const small = only((e) => { e.captions!.box = { left: 9, top: 52, right: 10, bottom: 64 }; });
    expect(small).toMatchObject({ code: 'box-out-of-range', path: 'captions.box' });
    expect(small.message).toContain('16');
  });

  it('box-out-of-range: a caption box too low for one line of its style', () => {
    const issue = only((e) => { e.captions!.box = { left: 9, top: 52, right: 86, bottom: 56 }; });
    expect(issue).toMatchObject({ code: 'box-out-of-range', path: 'captions.box' });
    expect(issue.message).toContain('108 px');                                        // caption: 84 px × 1.28
    expect(issue.fix).toContain('bottom − top ≥ 5.7');
    expect(issuesOf((e) => { e.captions!.box = { left: 9, top: 52, right: 86, bottom: 57.7 }; })).toEqual([]);
  });

  it('blur-too-many: more than 24 elements with a blur; the path names the first one over the limit', () => {
    const text = (i: number) => ({ id: `t${i}`, at: 0, for: 40, box: { left: 10, top: 20, right: 80, bottom: 40 }, style: 'label', copy: 'one\ntwo', enter: { kind: 'blur' as const } });
    // the two shots of the whip, then two lines per text: the twelfth text brings the count to 26
    const issue = only((e) => { e.texts = Array.from({ length: 14 }, (_, i) => text(i)); });
    expect(issue).toMatchObject({ code: 'blur-too-many', path: 'texts[11].enter' });
    expect(issue.message).toContain('30 elements');
    expect(issue.fix).toContain('"fade"');
    expect(issuesOf((e) => { e.texts = Array.from({ length: 11 }, (_, i) => text(i)); })).toEqual([]);
    // caption groups count as they are grouped before the fit: one word each here
    const groups = only((e) => { e.captions!.enter = { kind: 'blur' }; e.captions!.group = { words: 1 }; e.captions!.words = Array.from({ length: 24 }, (_, i) => ({ text: 'go', at: 60 + i * 4, for: 4 })); });
    expect(groups).toMatchObject({ code: 'blur-too-many', path: 'captions.enter' });
    expect(groups.message).toContain('26 elements');
    // a caption group of one frame gets no enter and so carries no blur: 23 of them and the two shots of the whip are 2, not 25
    const oneFrame = (frames: number) => issuesOf((e) => { e.captions!.enter = { kind: 'blur' }; e.captions!.group = { words: 1, hold: 0 }; e.captions!.words = Array.from({ length: 23 }, (_, i) => ({ text: 'go', at: 60 + i * frames, for: frames })); });
    expect(oneFrame(1)).toEqual([]);
    expect(oneFrame(2).map((i) => i.code)).toEqual(['blur-too-many']);
    // a whip too many
    const whips = only((e, facts) => {
      e.shots = Array.from({ length: 14 }, (_, i) => ({ id: `s${i + 1}`, at: i * 20, for: 20, media: 'a', in: i === 0 ? undefined : { kind: 'whip' as const, to: 'left' as const, frames: 4 } }));
      e.frames = 280; facts.beat = { frames: 900, audio: true }; delete e.captions; delete e.cards;
      e.texts = Array.from({ length: 6 }, (_, i) => text(i));
    });
    expect(whips).toMatchObject({ code: 'blur-too-many', path: 'texts[5].enter' });   // 14 shots, then 2 × 5 lines make 24
  });

  it('outside-safe-area: a box that leaves the safe area without saying so', () => {
    const issue = only((e) => { e.cards![0]!.box = { left: 31, top: 60, right: 69, bottom: 70 }; });
    expect(issue).toMatchObject({ code: 'outside-safe-area', path: 'cards[0].box' });
    expect(issue.message).toContain('bottom 70');
    expect(issue.message).toContain('65');
    expect(issue.fix).toContain('"safe": false');
    expect(issuesOf((e) => { e.cards![0]!.box = { left: 31, top: 60, right: 69, bottom: 70 }; e.safe = 'tiktok'; })).toEqual([]);
    expect(only((e) => { e.captions!.box = { left: 2, top: 52, right: 86, bottom: 64 }; })).toMatchObject({ code: 'outside-safe-area', path: 'captions.box' });
  });

  it('outside-safe-area: the safe area is a rectangle minus the column of the buttons (§12.16)', () => {
    // a wide box at the top is inside: the column begins at 45 % of the height
    expect(issuesOf((e) => { e.texts![0]!.box = { left: 6, top: 14, right: 94, bottom: 45 }; })).toEqual([]);
    // the rectangle: says so, and gives the nearest box that fits (moved, cut only where the rectangle ends)
    const left = only((e) => { e.texts![0]!.box = { left: 2, top: 15, right: 84, bottom: 27 }; });
    expect(left).toMatchObject({ code: 'outside-safe-area', path: 'texts[0].box' });
    expect(left.message).toContain('leaves the rectangle');
    expect(left.message).toContain('left 2 < 6');
    expect(left.message).not.toContain('enters the column');
    expect(left.message).toContain('the rectangle { left: 6, top: 14, right: 94, bottom: 65 } without the column of the platform\'s buttons (x 86 … 100, y 45 … 65)');
    expect(left.fix).toContain('{ left: 6, top: 15, right: 88, bottom: 27 }');
    expect(only((e) => { e.texts![0]!.box = { left: 9, top: 15, right: 96, bottom: 27 }; }).message).toContain('right 96 > 94');
    // the column of the buttons: x 86 … 100 from y 45 down to the bottom of the rectangle
    const column = only((e) => { e.captions!.box = { left: 9, top: 52, right: 91, bottom: 64 }; });
    expect(column).toMatchObject({ code: 'outside-safe-area', path: 'captions.box' });
    expect(column.message).toContain('enters the column of the buttons');
    expect(column.message).toContain('right 91 > 86');
    expect(column.message).not.toContain('leaves the rectangle');
    expect(column.fix).toContain('{ left: 6, top: 52, right: 86, bottom: 64 }');
    expect(column.fix).toContain('"safe": false');
    // a small box inside the column moves out of it the shorter way: here up
    const card = only((e) => { e.cards![0]!.box = { left: 80, top: 40, right: 92, bottom: 47 }; });
    expect(card.fix).toContain('{ left: 80, top: 38, right: 92, bottom: 45 }');
    // both at once
    const both = only((e) => { e.captions!.box = { left: 9, top: 52, right: 91, bottom: 70 }; });
    expect(both.message).toContain('leaves the rectangle');
    expect(both.message).toContain('enters the column of the buttons');
    expect(both.fix).toContain('{ left: 6, top: 47, right: 86, bottom: 65 }');
    // tiktok: its own rectangle, the column down to its bottom; none: no safe area at all
    expect(issuesOf((e) => { e.safe = 'tiktok'; e.texts![0]!.box = { left: 6, top: 8, right: 94, bottom: 45 }; })).toEqual([]);
    expect(only((e) => { e.safe = 'tiktok'; e.captions!.box = { left: 9, top: 66, right: 91, bottom: 78 }; }).message).toContain('y 45 … 78');
    expect(issuesOf((e) => { e.safe = 'none'; e.captions!.box = { left: 0, top: 88, right: 100, bottom: 100 }; })).toEqual([]);
    // every box a fix proposes passes
    for (const box of [{ left: 6, top: 15, right: 88, bottom: 27 }, { left: 6, top: 52, right: 86, bottom: 64 }, { left: 6, top: 47, right: 86, bottom: 65 }]) {
      expect(issuesOf((e) => { e.captions!.box = box; })).toEqual([]);
    }
  });

  it('time-range: something that ends after the video', () => {
    const issue = only((e) => { e.texts![0]!.at = 150; });
    expect(issue).toMatchObject({ code: 'time-range', path: 'texts[0]' });
    expect(issue.message).toContain('204');
    expect(issue.fix).toContain('30');
    expect(only((e) => { e.cards![0]!.for = 120; })).toMatchObject({ code: 'time-range', path: 'cards[0]' });
    expect(only((e) => { e.captions!.words[3]!.for = 90; })).toMatchObject({ code: 'time-range', path: 'captions.words[3]' });
    expect(only((e, facts) => { e.media.ping = { file: 'assets/ping.mp3', kind: 'audio' }; facts.ping = { frames: 30, audio: true }; e.audio!.sounds = [{ id: 'ping', media: 'ping', at: 170, gain: 1 }]; }))
      .toMatchObject({ code: 'time-range', path: 'audio.sounds[0]' });
    expect(only((e) => { e.audio!.music!.duck!.under = [{ at: 170, for: 20 }]; })).toMatchObject({ code: 'time-range', path: 'audio.music.duck.under[0]' });
  });

  it('animation-too-long: an enter and an exit that leave no frame at rest', () => {
    const issue = only((e) => { e.cards![0]!.for = 16; });
    expect(issue).toMatchObject({ code: 'animation-too-long', path: 'cards[0]' });
    expect(issue.message).toContain('8');
    expect(issue.message).toContain('16');
    expect(only((e) => { e.texts![0]!.for = 10; })).toMatchObject({ code: 'animation-too-long', path: 'texts[0]' });
    expect(issuesOf((e) => { e.cards![0]!.for = 17; })).toEqual([]);
  });

  it('style-unknown: a style that is neither a preset nor in styles', () => {
    const issue = only((e) => { e.texts![0]!.style = 'hok'; e.styles = { mine: style }; });
    expect(issue).toMatchObject({ code: 'style-unknown', path: 'texts[0].style' });
    expect(issue.message).toContain('hook, label, tag, caption, mine');
    expect(only((e) => { e.captions!.style = 'toString'; })).toMatchObject({ code: 'style-unknown', path: 'captions.style' });
  });

  it('style-value: a colour, a shadow or a number of a style that fails its pattern or range', () => {
    expect(only((e) => { e.styles = { mine: { ...style, fill: 'red;background:url(x)' } }; })).toMatchObject({ code: 'style-value', path: 'styles.mine.fill' });
    expect(only((e) => { e.styles = { mine: { ...style, shadows: ['0px 2px 4px #000000', '0 0 4px red'] } }; })).toMatchObject({ code: 'style-value', path: 'styles.mine.shadows[1]' });
    expect(only((e) => { e.styles = { mine: { ...style, weight: 950 } }; })).toMatchObject({ code: 'style-value', path: 'styles.mine.weight' });
    expect(only((e) => { e.styles = { mine: { ...style, size: 40.5 } }; })).toMatchObject({ code: 'style-value', path: 'styles.mine.size' });
    expect(only((e) => { e.styles = { mine: { ...style, outline: { width: 0.5, colour: '#000000' } } }; })).toMatchObject({ code: 'style-value', path: 'styles.mine.outline.width' });
    expect(only((e) => { e.styles = { mine: { ...style, plate: { colour: 'pink', radius: 0.3, padX: 0.5, padY: 0.2 } } }; })).toMatchObject({ code: 'style-value', path: 'styles.mine.plate.colour' });
    expect(only((e) => { e.styles = { mine: { ...style, tracking: 1 } }; })).toMatchObject({ code: 'style-value', path: 'styles.mine.tracking' });
    expect(only((e) => { e.styles = { mine: { ...style, leading: 3 } }; })).toMatchObject({ code: 'style-value', path: 'styles.mine.leading' });
  });

  it('style-value: a colour outside a style', () => {
    expect(only((e) => { e.background = 'black'; })).toMatchObject({ code: 'style-value', path: 'background' });
    const clear = only((e) => { e.background = '#10141880'; });                        // the canvas must be opaque
    expect(clear).toMatchObject({ code: 'style-value', path: 'background' });
    expect(clear.fix).toContain('"#101418"');
    expect(issuesOf((e) => { e.background = '#101418'; })).toEqual([]);
    expect(only((e) => { e.shots[2]!.in = { kind: 'flash', colour: 'white' }; })).toMatchObject({ code: 'style-value', path: 'shots[2].in.colour' });
    expect(only((e) => { e.captions!.active = { kind: 'pill', colour: '#7c3aed', text: 'url(x)' }; })).toMatchObject({ code: 'style-value', path: 'captions.active.text' });
  });

  it('text-empty: a copy with nothing in it', () => {
    expect(only((e) => { e.texts![0]!.copy = '  \n '; })).toMatchObject({ code: 'text-empty', path: 'texts[0].copy' });
  });

  it('unfilled:<placeholder>: a placeholder left in a copy', () => {
    const issue = only((e) => { e.texts![0]!.copy = 'Try {product} today'; });
    expect(issue).toMatchObject({ code: 'unfilled:product', path: 'texts[0].copy' });
    expect(only((e) => { e.captions!.words[1]!.text = '{brand}'; })).toMatchObject({ code: 'unfilled:brand', path: 'captions.words[1].text' });
  });

  it('words-order: caption words that overlap or go back in time', () => {
    const issue = only((e) => { e.captions!.words[2]!.at = 80; });
    expect(issue).toMatchObject({ code: 'words-order', path: 'captions.words[2]' });
    expect(issue.message).toContain('"looked"');
    expect(issue.fix).toContain('88');
  });

  it('card-duplicate: two cards with the same picture on the same frames', () => {
    const issue = only((e) => { e.cards!.push({ ...e.cards![0]!, id: 'again', box: { left: 31, top: 20, right: 69, bottom: 34 } }); });
    expect(issue).toMatchObject({ code: 'card-duplicate', path: 'cards[1]' });
    expect(issue.message).toContain('"product"');
  });

  it('card-duplicate: a card with the picture of an image shot, or of the picture behind a window, on the same frames', () => {
    // the second shot shows the image for 60 frames and the 8 of the whip that follows
    const issue = only((e) => { e.shots[1] = { id: 's2', at: 60, for: 60, media: 'serum', in: { kind: 'crossfade' } }; e.cards![0] = { ...e.cards![0]!, at: 60, for: 68 }; });
    expect(issue).toMatchObject({ code: 'card-duplicate', path: 'cards[0]' });
    expect(issue.message).toContain('shots[1]');
    expect(issue.message).toContain('assets/serum.png');
    expect(issuesOf((e) => { e.shots[1] = { id: 's2', at: 60, for: 60, media: 'serum', in: { kind: 'crossfade' } }; e.cards![0] = { ...e.cards![0]!, at: 60, for: 67 }; })).toEqual([]);
    const behind = only((e) => { e.shots[0]!.windows = [{ at: 5, for: 40, corner: 'bottom-right', behind: 'serum' }]; e.cards![0] = { ...e.cards![0]!, at: 5, for: 40 }; });
    expect(behind).toMatchObject({ code: 'card-duplicate', path: 'cards[0]' });
    expect(behind.message).toContain('shots[0].windows[0]');
    // the same file under another key is the same element to the renderer
    const twoKeys = only((e) => { e.media.again = { file: 'assets/serum.png', kind: 'image' }; e.cards!.push({ ...e.cards![0]!, id: 'again', media: 'again', fit: 'cover' }); });
    expect(twoKeys).toMatchObject({ code: 'card-duplicate', path: 'cards[1]' });
  });

  it('sound-duplicate: a sound with the file of the music, or of a clip that plays its own sound, on the same frames', () => {
    const music = only((e) => { e.audio!.sounds = [{ id: 'twice', media: 'beat', at: 0, for: 180, gain: 1 }]; });
    expect(music).toMatchObject({ code: 'sound-duplicate', path: 'audio.sounds[0]' });
    expect(music.message).toContain('audio.music');
    const clip = only((e, facts) => {
      facts.a = { frames: 150, audio: true }; e.shots[0]!.sound = { gain: 1 };
      e.media.voice = { file: 'assets/a.mp4', kind: 'audio' }; facts.voice = { frames: 150, audio: true };
      e.audio!.sounds = [{ id: 'voice', media: 'voice', at: 0, for: 68, gain: 1 }];
    });
    expect(clip).toMatchObject({ code: 'sound-duplicate', path: 'audio.sounds[0]' });
    expect(clip.message).toContain('shots[0].sound');
    // a sound that names the video itself has failed its kind: that is its issue, it is not compared as well
    const kind = only((e, facts) => { facts.a = { frames: 150, audio: true }; e.shots[0]!.sound = { gain: 1 }; e.audio!.sounds = [{ id: 'voice', media: 'a', at: 0, for: 68, gain: 1 }]; });
    expect(kind).toMatchObject({ code: 'media-kind', path: 'audio.sounds[0].media' });
  });

  it('sound-duplicate: two sounds with the same file on the same frames', () => {
    const issue = only((e, facts) => {
      e.media.ping = { file: 'assets/ping.mp3', kind: 'audio' }; facts.ping = { frames: 30, audio: true };
      e.audio!.sounds = [{ id: 'ping-1', media: 'ping', at: 10, gain: 1 }, { id: 'ping-2', media: 'ping', at: 10, gain: 0.5 }];
    });
    expect(issue).toMatchObject({ code: 'sound-duplicate', path: 'audio.sounds[1]' });
  });

  it('gain-range: a gain outside 0 … 2, a duck above the music', () => {
    expect(only((e) => { e.audio!.music!.gain = 2.5; })).toMatchObject({ code: 'gain-range', path: 'audio.music.gain' });
    const duck = only((e) => { e.audio!.music!.duck!.to = 0.8; });
    expect(duck).toMatchObject({ code: 'gain-range', path: 'audio.music.duck.to' });
    expect(duck.message).toContain('0.5');
    expect(only((e, facts) => { facts.a!.audio = true; e.shots[0]!.sound = { gain: -1 }; })).toMatchObject({ code: 'gain-range', path: 'shots[0].sound.gain' });
    expect(only((e) => { e.audio!.master = { lufs: 3 }; })).toMatchObject({ code: 'gain-range', path: 'audio.master.lufs' });
  });

  it('music-short: music that ends before the video and may not loop', () => {
    const issue = only((_, facts) => { facts.beat = { frames: 120, audio: true }; });
    expect(issue).toMatchObject({ code: 'music-short', path: 'audio.music' });
    expect(issue.message).toContain('120');
    expect(issue.message).toContain('180');
    expect(issue.fix).toContain('"loop": true');
    expect(issuesOf((e, facts) => { facts.beat = { frames: 120, audio: true }; e.audio!.music!.loop = true; })).toEqual([]);
    expect(only((e, facts) => { facts.beat = { frames: 400, audio: true }; e.audio!.music!.from = 300; }).code).toBe('music-short');
  });

  it('music-short: a looped music file of fewer than 30 frames (such a loop makes dozens of elements)', () => {
    const issue = only((e, facts) => { facts.beat = { frames: 29, audio: true }; e.audio!.music!.loop = true; });
    expect(issue).toMatchObject({ code: 'music-short', path: 'audio.music' });
    expect(issue.message).toContain('29');
    expect(issue.message).toContain('30');
    expect(issuesOf((e, facts) => { facts.beat = { frames: 30, audio: true }; e.audio!.music!.loop = true; })).toEqual([]);
    expect(only((e, facts) => { facts.beat = { frames: 100, audio: true }; e.audio!.music!.loop = true; e.audio!.music!.from = 80; }).code).toBe('music-short');
  });

  it('duck-too-dense: more than 512 points on one volume lane', () => {
    const issue = only((e, facts) => {
      e.shots = Array.from({ length: 4 }, (_, i) => ({ id: `s${i + 1}`, at: i * 450, for: 450, media: 'a' }));
      e.frames = 1800; facts.a = { frames: 450, audio: false }; facts.beat = { frames: 1800, audio: true };
      delete e.texts; delete e.cards; delete e.captions;
      e.audio!.music!.duck = { to: 0.2, ramp: 1, under: Array.from({ length: 200 }, (_, i) => ({ at: 4 + i * 8, for: 2 })) };
    });
    expect(issue).toMatchObject({ code: 'duck-too-dense', path: 'audio.music.duck' });
    expect(issue.message).toContain('512');
  });
});

describe('validate: several faults', () => {
  it('reports all of them in one list', () => {
    const issues = issuesOf((e, facts) => {
      e.shots[1]!.at = 61; e.shots[1]!.for = 59;            // shots-gap (and the punch-in stays inside)
      e.texts![0]!.style = 'nope';                          // style-unknown
      e.cards![0]!.media = 'beat';                          // media-kind
      e.audio!.music!.gain = 9;                             // gain-range (the duck stays below it)
      facts.c = { frames: 10, audio: false };               // clip-short
    });
    expect(issues.map((i) => i.code).sort()).toEqual(['clip-short', 'gain-range', 'media-kind', 'shots-gap', 'style-unknown']);
  });

  it('stops at 100: the last one says how many more there are', () => {
    const texts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, at: 0, for: 30, box: { left: 10, top: 20, right: 80, bottom: 30 }, style: 'nope', copy: 'x' }));
    const issues = issuesOf((e) => { e.texts = texts(150); });
    expect(MAX_ISSUES).toBe(100);
    expect(issues).toHaveLength(100);
    expect(issues.slice(0, 99).map((i) => `${i.code} @ ${i.path}`)).toEqual(Array.from({ length: 99 }, (_, i) => `style-unknown @ texts[${i}].style`));
    expect(issues[99]).toMatchObject({ code: 'more-issues', path: '(the document)' });
    expect(issues[99]!.message).toContain('51 more');
    expect(issues[99]!.fix.length).toBeGreaterThan(10);
    // exactly 100 faults are all listed; with one more, 99 and the count of the other 2
    expect(issuesOf((e) => { e.texts = texts(100); }).map((i) => i.code)).toEqual(Array.from({ length: 100 }, () => 'style-unknown'));
    expect(issuesOf((e) => { e.texts = texts(101); })[99]!.message).toContain('2 more');
  });

  it('lists at most 10 keys in a message, then says how many more there are', () => {
    const media = only((e) => { for (let i = 0; i < 295; i++) e.media[`m${i}`] = { file: `assets/m${i}.png`, kind: 'image' }; e.shots[1]!.media = 'd'; });
    expect(media.code).toBe('media-unknown');
    expect(media.message).toContain('it has: a, b, c, serum, beat, m0, m1, m2, m3, m4 and 290 more');
    expect(media.message.length).toBeLessThan(300);
    const unknown = only((e) => { e.styles = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, style])); e.texts![0]!.style = 'hok'; });
    expect(unknown.code).toBe('style-unknown');
    expect(unknown.message).toContain('Available: hook, label, tag, caption, k0, k1, k2, k3, k4, k5 and 44 more');
  });

  it('too-many: validate alone refuses a list that is too long, and looks at nothing else', () => {
    const issues = issuesOf((e) => { e.texts = Array.from({ length: 201 }, (_, i) => ({ id: `t${i}`, at: 0, for: 30, box: { left: 10, top: 20, right: 80, bottom: 30 }, style: 'nope', copy: 'x' })); });
    expect(issues.map((i) => `${i.code} @ ${i.path}`)).toEqual(['too-many @ texts']);
    expect(issues[0]!.message).toContain('201');
  });
});

describe('validate: a document exactly at every limit', () => {
  it('has as many entries as the table allows, in every list', () => {
    const e = limitEdit();
    const shot = e.shots[0]!;
    expect({
      media: Object.keys(e.media).length, styles: Object.keys(e.styles!).length, 'styles.<name>.shadows': e.styles!.k0!.shadows.length,
      shots: e.shots.length, 'shots[].windows': shot.windows!.length, 'shots[].windows[].swaps': shot.windows![7]!.swaps!.length,
      texts: e.texts!.length, 'captions.words': e.captions!.words.length, cards: e.cards!.length,
      'audio.sounds': e.audio!.sounds!.length, 'audio.music.duck.under': (e.audio!.music!.duck!.under as unknown[]).length,
    }).toEqual(COUNTS);
  });

  it('passes the schema and every rule', () => {
    const parsed = parseEdit(JSON.parse(JSON.stringify(limitEdit())));
    expect(parsed.ok ? [] : parsed.issues).toEqual([]);
    expect(validate(limitEdit(), limitFacts())).toEqual([]);
  });
});

describe('validate: strings are bounded', () => {
  const BIG = 5_000_000;
  const clips = (kind: 'video' | 'image') => {
    const edit = shortEdit() as any;
    edit.media.a = { file: `assets/${'a'.repeat(BIG)}`, kind };
    edit.shots = Array.from({ length: 120 }, (_, i) => ({ id: `s${i}`, at: i, for: 1, media: 'a' }));
    edit.frames = 120;
    delete edit.texts; delete edit.cards; delete edit.captions; delete edit.audio;
    return edit as Edit;
  };

  it.each(['video', 'image'] as const)('a 5 MB file name used by 120 shots as %s is refused in under a second', (kind) => {
    const edit = clips(kind);
    const started = performance.now();
    const issues = validate(edit, shortFacts());
    expect(performance.now() - started).toBeLessThan(1000);
    expect(issues.map((i) => i.path)).toContain('media.a.file');
    expect(JSON.stringify(issues).length).toBeLessThan(20_000);
  });

  it('no message or fix passes 600 characters, with every quoted value at its limit', () => {
    const edit = shortEdit() as any;
    const long = (c: string) => c.repeat(32);
    edit.media = { [long('m')]: { file: `assets/${'f'.repeat(193)}`, kind: 'audio' }, a: edit.media.a, beat: edit.media.beat, serum: edit.media.serum };
    edit.media.b = edit.media.a; edit.media.c = edit.media.a;
    edit.styles = {};
    edit.texts = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, at: 0, for: 20, box: { left: 10, top: 20, right: 80, bottom: 26 }, style: long('z'), copy: '{x} ok' }));
    edit.shots[0].media = long('m');
    edit.cards[0].media = long('m');
    edit.background = `#${'0'.repeat(31)}`;
    edit.captions.style = long('y');
    const issues = validate(edit, {});
    expect(issues.length).toBeGreaterThan(50);
    for (const issue of issues) {
      expect(issue.message.length).toBeLessThanOrEqual(600);
      expect(issue.fix.length).toBeLessThanOrEqual(600);
    }
  });

  it('two keys that name one file are still found, comparing by key', () => {
    const issues = issuesOf((e) => { e.media.twin = { ...e.media.serum }; e.cards![0]!.at = 70; e.cards!.push({ ...e.cards![0]!, id: 'again', media: 'twin' }); });
    expect(issues.map((i) => i.code)).toContain('card-duplicate');
  });

  it.each([
    ['an empty object', {}],
    ['null', null],
    ['a list', []],
    ['a text whose copy is a list', (() => { const e = shortEdit() as any; e.texts[0].copy = ['a']; return e; })()],
    ['shots that are not a list', (() => { const e = shortEdit() as any; e.shots = {}; return e; })()],
    ['media that is null', (() => { const e = shortEdit() as any; e.media = null; return e; })()],
  ])('%s: issues, never a foreign throw', (_name, bad) => {
    let issues: EditIssue[] = [];
    expect(() => { issues = validate(bad as unknown as Edit, shortFacts()); }).not.toThrow();
    expect(issues.length).toBeGreaterThan(0);
  });
});
