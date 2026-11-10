import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../prepare/prompts.ts';
import { beatsFill, beatsTemplate, continuingTemplate, speechFill, speechTemplate } from './fixture.ts';
import { MAX_IMAGE_REFERENCES } from './limits.ts';
import { templateRules } from './rules.ts';
import { Fill, Template } from './schema.ts';

type Json = Record<string, any>;
/** The messages of what the schema refuses, each with its path: 'shots.0.at: …'. Empty: accepted. */
const refusals = (schema: typeof Template | typeof Fill, value: unknown): string[] => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};
const beats = (change: (t: Json) => void = () => {}): string[] => { const t: Json = beatsTemplate(); change(t); return refusals(Template, t); };
const speech = (change: (t: Json) => void = () => {}): string[] => { const t: Json = speechTemplate(); change(t); return refusals(Template, t); };
const fill = (change: (f: Json) => void = () => {}): string[] => { const f: Json = speechFill(); change(f); return refusals(Fill, f); };
const refused = (issues: string[], pattern: RegExp) => expect(issues.join('\n')).toMatch(pattern);

describe('Template', () => {
  it('accepts a beats template with one shot and a speech template with two segments', () => {
    expect(beats()).toEqual([]);
    expect(speech()).toEqual([]);
  });
  it('gives back what it was given: nothing is added, changed or dropped', () => {
    expect(Template.parse(beatsTemplate())).toEqual(beatsTemplate());
    expect(Template.parse(speechTemplate())).toEqual(speechTemplate());
  });
  it('every template of the repo validates unchanged: the goldens, the worked examples of the prompt, the fixtures', () => {
    const goldens = ['layering-01', 'lashly-01'].map((id) => JSON.parse(readFileSync(new URL(`../resolve/golden/${id}/template.json`, import.meta.url), 'utf8')) as unknown);
    for (const template of [...goldens, ...Object.values(EXAMPLES), beatsTemplate(), speechTemplate(), continuingTemplate()]) {
      expect(refusals(Template, template)).toEqual([]);
      expect(Template.parse(template)).toEqual(template);
    }
  });

  describe('unknown keys are errors, at every depth', () => {
    const places: [string, (t: Json) => Json][] = [
      ['the template', (t) => t], ['source', (t) => t.source], ['source.metrics', (t) => t.source.metrics], ['canvas', (t) => t.canvas],
      ['products', (t) => t.products], ['a shot', (t) => t.shots[0]], ['a text', (t) => t.texts[0]], ['a box', (t) => t.texts[0].box],
      ['a style', (t) => t.styles.main], ['audio', (t) => t.audio], ['audio.music', (t) => t.audio.music], ['script', (t) => t.script],
      ['a segment', (t) => t.script.segments[0]], ['presenter', (t) => t.presenter], ['presenter.voice', (t) => t.presenter.voice],
      ['a still', (t) => t.stills[0]], ['a card', (t) => t.cards[0]], ['a window', (t) => t.windows[0]], ['captions', (t) => t.captions],
    ];
    it.each(places)('%s', (_name, at) => {
      refused(speech((t) => { at(t).surprise = 1; }), /Unrecognized key: "surprise"/);
    });
    it('a key of the old format: script.segments[].action, cards[].selection, captions.style "word-by-word"', () => {
      refused(speech((t) => { t.script.segments[0].action = 'she smiles'; }), /Unrecognized key: "action"/);
      refused(speech((t) => { t.cards[0].selection = 'name'; }), /Unrecognized key: "selection"/);
      refused(speech((t) => { t.captions = { style: 'word-by-word' }; }), /captions/);
    });
  });

  describe('every optional motion field round-trips', () => {
    const transitions = [
      { kind: 'cut' }, { kind: 'crossfade', frames: 9 }, { kind: 'push', to: 'left', frames: 11 }, { kind: 'whip', to: 'top' },
      { kind: 'zoom', frames: 6, scale: 1.2 }, { kind: 'flash', frames: 4, colour: '#ffeecc' }, { kind: 'dip', colour: '#000' },
    ];
    const motions = [{ kind: 'push-in', to: 1.1, ease: 'in-out' }, { kind: 'pull-out', from: 1.05 }, { kind: 'punch-in', at: 100, to: 1.2, frames: 4 }];
    const enters = [{ kind: 'none' }, { kind: 'fade', frames: 5 }, { kind: 'pop', frames: 8, from: 0.7 }, { kind: 'slide', from: 'bottom', frames: 7, distance: 3 }, { kind: 'blur', frames: 9, radius: 2 }];
    const exits = [{ kind: 'none' }, { kind: 'fade', frames: 5 }, { kind: 'pop', frames: 8, to: 0.8 }, { kind: 'slide', to: 'left', frames: 7, distance: 3 }, { kind: 'blur', frames: 9, radius: 2 }];
    const twoShots = (t: Json) => {
      t.shots = [
        { id: 's1', at: 0, for: 90, products: ['1'], still_prompt: 'a', motion_prompt: 'm', clip_seconds: 4, action: 'one' },
        { id: 's2', at: 90, for: 60, products: [], still_prompt: 'b', motion_prompt: 'm', clip_seconds: 4, action: 'two' },
      ];
    };
    const kept = (template: Json): Json => { const result = Template.safeParse(template); expect(refusals(Template, template)).toEqual([]); return result.data as Json; };

    it.each(transitions)('shots[].in $kind', (transition) => {
      const t: Json = beatsTemplate(); twoShots(t); t.shots[1].in = transition;
      expect(kept(t).shots[1].in).toEqual(transition);
    });
    it.each(motions)('shots[].motion $kind', (motion) => {
      const t: Json = beatsTemplate(); twoShots(t); t.shots[1].motion = motion;
      expect(kept(t).shots[1].motion).toEqual(motion);
    });
    it.each(enters)('texts[].enter $kind', (enter) => {
      const t: Json = beatsTemplate(); t.texts[0].enter = enter;
      expect(kept(t).texts[0].enter).toEqual(enter);
    });
    it.each(exits)('texts[].exit $kind', (exit) => {
      const t: Json = beatsTemplate(); t.texts[0].exit = exit;
      expect(kept(t).texts[0].exit).toEqual(exit);
    });
    it('texts[].lines, safe, audio.music.duck and fadeOut, every field of a style', () => {
      const t: Json = beatsTemplate();
      t.texts[0].lines = 3;
      t.safe = 'tiktok';
      t.audio.music = { prompt: 'p', gain: 0.5, fadeOut: 18, duck: { to: 0.2, ramp: 5, under: [{ at: 10, for: 20 }] } };
      t.styles.main = { font: 'Montserrat', weight: 900, size: 60, align: 'left', fill: '#ffffff', shadows: ['0px 2px 8px #000000b3', '-1.5px 0px 0px #000'], upper: true, tracking: 0.02, leading: 1.3, outline: { width: 0.08, colour: '#000000' }, plate: { colour: '#e0508c', radius: 0.3, padX: 0.5, padY: 0.22 } };
      const out = kept(t);
      expect(out.texts[0].lines).toBe(3);
      expect(out.safe).toBe('tiktok');
      expect(out.audio.music).toEqual(t.audio.music);
      expect(out.styles.main).toEqual(t.styles.main);
    });
    it('captions.{box, style, group, active, enter}, cards[].{enter, exit, radius, motion, safe}, every field of a window', () => {
      const t: Json = speechTemplate();
      t.captions = { box: { left: 9, top: 52, right: 86, bottom: 64 }, style: 'main', group: { words: 4, lines: 1, hold: 10, pause: 12 }, active: { kind: 'colour', colour: '#ffe000', scale: 1.1 }, enter: { kind: 'pop', frames: 5, from: 0.8 } };
      t.cards[0] = { ...t.cards[0], box: { left: 0, top: 0, right: 100, bottom: 100 }, radius: 0, enter: { kind: 'fade', frames: 6 }, exit: { kind: 'pop', to: 0.9 }, motion: { kind: 'push-in', to: 1.08 }, safe: false };
      t.windows[0] = { mark: 'proof', corner: 'bottom-left', width: 34, radius: 3, frames: 8, behind: 'still:skin', behindMotion: { kind: 'pull-out', from: 1.1 } };
      t.audio.music.duck = { to: 0.05, under: 'sound' };
      t.shots[1].in = { kind: 'flash' };
      t.shots[1].motion = { kind: 'pull-out' };
      const out = kept(t);
      expect(out.captions).toEqual(t.captions);
      expect(out.cards[0]).toEqual(t.cards[0]);
      expect(out.windows[0]).toEqual(t.windows[0]);
      expect(out.audio.music.duck).toEqual({ to: 0.05, under: 'sound' });
      expect(out.shots[1].in).toEqual({ kind: 'flash' });
      for (const active of [{ kind: 'none' }, { kind: 'pill', colour: '#B76E79', text: '#ffffff' }]) {
        t.captions.active = active;
        expect(kept(t).captions.active).toEqual(active);
      }
    });
    it('refuses a motion value outside its range or with an unknown key', () => {
      refused(beats((t) => { t.shots[0].motion = { kind: 'push-in', to: 3 }; }), /shots\.0\.motion\.to/);
      refused(beats((t) => { t.shots[0].motion = { kind: 'spin' }; }), /shots\.0\.motion/);
      refused(beats((t) => { t.texts[0].enter = { kind: 'fade', frames: 0 }; }), /texts\.0\.enter\.frames/);
      refused(beats((t) => { t.texts[0].enter = { kind: 'fade', seconds: 1 }; }), /Unrecognized key: "seconds"/);
      refused(beats((t) => { t.texts[0].lines = 5; }), /texts\.0\.lines/);
      refused(beats((t) => { t.safe = 'youtube'; }), /safe/);
      refused(speech((t) => { t.windows[0].width = 80; }), /windows\.0\.width/);
      refused(speech((t) => { t.windows[0].width = 51; }), /windows\.0\.width/);          // compose refuses more than 50 under the default safe area; the template does not know the mode here, so 50 is its cap
      expect(speech((t) => { t.windows[0].width = 50; })).toEqual([]);
      refused(speech((t) => { t.windows[0].behindMotion = { kind: 'punch-in', at: 3 }; }), /windows\.0\.behindMotion/);
    });
  });

  describe('beats', () => {
    it('refuses a shot without at, without for or without still_prompt', () => {
      refused(beats((t) => { delete t.shots[0].at; }), /shots\.0: a beats shot needs at and for/);
      refused(beats((t) => { delete t.shots[0].for; }), /shots\.0: a beats shot needs at and for/);
      refused(beats((t) => { delete t.shots[0].still_prompt; }), /shots\.0\.still_prompt/);
    });
    it('refuses a template with no shots, and a shot without action', () => {
      refused(beats((t) => { t.shots = []; }), /shots/);
      refused(beats((t) => { delete t.shots[0].action; }), /shots\.0\.action/);
      refused(beats((t) => { delete t.description; }), /description/);
    });
    it('refuses shots that leave a gap, overlap or do not start at 0', () => {
      const second = { id: 's2', at: 100, for: 30, products: [], still_prompt: 'b', motion_prompt: 'm', clip_seconds: 4, action: 'two' };
      refused(beats((t) => { t.shots.push(second); }), /shots\.1\.at: .*starts at 90/);
      refused(beats((t) => { t.shots.push({ ...second, at: 80 }); }), /shots\.1\.at/);
      refused(beats((t) => { t.shots[0].at = 5; }), /shots\.0\.at/);
    });
    it('refuses a shot that shows more frames than its clip is asked for, counting the next transition', () => {
      const second = { id: 's2', at: 90, for: 30, products: [], still_prompt: 'b', motion_prompt: 'm', clip_seconds: 4, action: 'two' };
      expect(beats((t) => { t.shots[0].for = 120; t.texts[0].for = 90; t.shots.push({ ...second, at: 120 }); })).toEqual([]);
      refused(beats((t) => { t.shots[0].for = 120; t.shots.push({ ...second, at: 120, in: { kind: 'crossfade', frames: 8 } }); }), /shots\.0\.clip_seconds: the shot shows 128 frames/);
      refused(beats((t) => { t.shots[0].for = 150; }), /shots\.0\.clip_seconds/);
    });
    it('refuses a clip asked for far longer than its shots show, and keeps the clips a shot may ask for (B12)', () => {
      // 90 frames = 3 s shown: up to 2 × 3 + 2 = 8 billed seconds
      expect(beats((t) => { t.shots[0].clip_seconds = 8; })).toEqual([]);
      refused(beats((t) => { t.shots[0].clip_seconds = 8.5; }), /shots\.0\.clip_seconds: the clip is asked for 9 s but the shots show only 90 frames .*at most 8 s/);
      // the minimum the provider bills is always allowed, and a shot of one second may not ask for 15 s
      expect(beats((t) => { t.shots[0].for = 30; t.texts[0].for = 30; t.shots[0].clip_seconds = 4; })).toEqual([]);
      refused(beats((t) => { t.shots[0].for = 30; t.texts[0].for = 30; t.shots[0].clip_seconds = 15; }), /shots\.0\.clip_seconds/);
      // a clip over several shots counts all their frames: 3 × 30 frames = 3 s shown, up to 8 s
      const parts = (clip: number) => beats((t) => {
        t.shots[0].for = 30; t.texts[0].for = 30; t.shots[0].clip_seconds = clip;
        t.shots.push({ id: 's2', at: 30, for: 30, products: [], continues: 's1', action: 'two' }, { id: 's3', at: 60, for: 30, products: [], continues: 's1', action: 'three' });
      });
      expect(parts(8)).toEqual([]);
      refused(parts(10), /shots\.0\.clip_seconds/);
    });
    it('refuses a transition on the first shot, a punch-in outside its shot, a text past the end', () => {
      refused(beats((t) => { t.shots[0].in = { kind: 'crossfade' }; }), /shots\.0\.in/);
      refused(beats((t) => { t.shots[0].motion = { kind: 'punch-in', at: 90 }; }), /shots\.0\.motion\.at/);
      refused(beats((t) => { t.texts[0].for = 91; }), /texts\.0\.for/);
    });
    it('refuses a text with a mark, and everything that belongs to a speech template', () => {
      refused(beats((t) => { t.texts[0].mark = 'hook'; }), /texts\.0\.mark/);
      refused(beats((t) => { t.shots[0].segment = 'open'; }), /shots\.0\.segment/);
      for (const key of ['script', 'presenter', 'cards', 'windows', 'captions']) {
        refused(beats((t) => { t[key] = (speechTemplate() as Json)[key]; }), new RegExp(`${key}: "${key}" belongs to a speech template`));
      }
    });

    /** The beats fixture with a second shot, and one still that the first frames of both shots are made from. */
    const lead = (t: Json) => {
      t.shots.push({ id: 's2', at: 90, for: 30, products: [], still_prompt: 'b', motion_prompt: 'm', clip_seconds: 4, action: 'two' });
      t.stills = [{ id: 'lead', prompt: 'a woman, front-facing', references: [] }];
      for (const shot of t.shots) shot.stills = ['lead'];
    };
    it('takes stills: a shot names the generated pictures its first frame is made from', () => {
      expect(beats(lead)).toEqual([]);
      expect(beats((t) => { lead(t); t.stills.push({ id: 'room', prompt: 'a room', references: ['still:lead', 'product:1'] }); t.shots[1].stills = ['lead', 'room']; })).toEqual([]);
    });
    it('refuses a shot that names a still the template does not have, the same still twice, or more than 2', () => {
      refused(beats((t) => { lead(t); t.shots[1].stills = ['nobody']; }), /shots\.1\.stills\.0: the template has no still "nobody"/);
      refused(beats((t) => { t.shots[0].stills = ['lead']; }), /shots\.0\.stills\.0: the template has no still "lead"/);
      refused(beats((t) => { lead(t); t.shots[1].stills = ['lead', 'lead']; }), /shots\.1\.stills\.1: .*twice/);
      refused(beats((t) => {
        lead(t);
        t.stills.push({ id: 'room', prompt: 'a room', references: [] }, { id: 'street', prompt: 'a street', references: [] });
        t.shots[0].stills = ['lead', 'room', 'street'];
      }), /shots\.0\.stills: Too big/);
    });
    it('still-unused: a still that no shot and no other still uses would be paid for nothing', () => {
      refused(beats((t) => { lead(t); for (const shot of t.shots) delete shot.stills; }), /stills\.0: still-unused: no shot and no other still/);
      expect(beats((t) => {
        lead(t);
        t.stills.push({ id: 'room', prompt: 'p', references: ['still:lead'] });
        for (const shot of t.shots) shot.stills = ['room'];           // "lead" is used by "room", "room" by the shots
      })).toEqual([]);
    });
    it('a still is made from products every customer has and from stills listed before it, and its id is no shot\'s', () => {
      refused(beats((t) => { lead(t); t.stills[0].references = ['product:2']; }), /stills\.0\.references\.0: .*products\.min \(1\)/);
      refused(beats((t) => {
        lead(t);
        t.stills[0].references = ['still:room'];
        t.stills.push({ id: 'room', prompt: 'p', references: [] });
        t.shots[0].stills = ['lead', 'room'];
      }), /stills\.0\.references\.0: .*no still listed before it/);
      refused(beats((t) => { lead(t); t.stills.push({ ...t.stills[0] }); }), /stills\.1\.id: the still id "lead" is used twice/);
      // both would be the image "s2" of a variant: one key, one file
      refused(beats((t) => { lead(t); t.stills[0].id = 's2'; for (const shot of t.shots) shot.stills = ['s2']; }), /stills\.0\.id: .*"s2" is also the id of a shot/);
    });
    it('the pictures a first frame is made from are no more than the provider takes for one image', () => {
      // the bounds of the schema (2 stills in a shot, 5 products) keep every template far below the limit, so the rule is asked itself
      const t: Json = beatsTemplate();
      t.products = { min: 5, max: 5 };
      t.stills = Array.from({ length: MAX_IMAGE_REFERENCES - 4 }, (_, i) => ({ id: `p${i}`, prompt: 'p', references: [] }));
      t.shots[0].products = ['all'];
      t.shots[0].stills = t.stills.map((still: Json) => still.id);
      const found = (): string[] => {
        const issues: string[] = [];
        templateRules(t as Parameters<typeof templateRules>[0], (path, message) => { issues.push(`${path.join('.')}: ${message}`); });
        return issues;
      };
      refused(found(), new RegExp(`shots\\.0\\.stills: .*${MAX_IMAGE_REFERENCES + 1} pictures.*at most ${MAX_IMAGE_REFERENCES}`));
      t.shots[0].products = ['1', '2', '3', '4'];                      // one photograph fewer: exactly the limit
      expect(found()).toEqual([]);
    });
    describe('a shot that continues the clip of an earlier shot', () => {
      const parts = (change: (t: Json) => void = () => {}): string[] => { const t: Json = continuingTemplate(); change(t); return refusals(Template, t); };
      /** The shots one after the other with these lengths. */
      const timed = (t: Json, lengths: number[]) => { let at = 0; t.shots.forEach((shot: Json, i: number) => { shot.at = at; shot.for = lengths[i]; at += lengths[i]!; }); };
      it('takes s2 and s3 continuing s1, and a template without continues exactly as before', () => {
        expect(parts()).toEqual([]);
        expect(Template.parse(continuingTemplate())).toEqual(continuingTemplate());
        expect(parts((t) => { t.shots[2].in = { kind: 'cut' }; })).toEqual([]);
      });
      it('a shot without continues needs still_prompt, motion_prompt and clip_seconds', () => {
        refused(parts((t) => { delete t.shots[3].still_prompt; }), /shots\.3\.still_prompt: a beats shot needs still_prompt/);
        refused(parts((t) => { delete t.shots[3].motion_prompt; }), /shots\.3\.motion_prompt: a beats shot needs motion_prompt/);
        refused(parts((t) => { delete t.shots[0].clip_seconds; }), /shots\.0\.clip_seconds: a beats shot needs clip_seconds/);
        refused(beats((t) => { delete t.shots[0].motion_prompt; }), /shots\.0\.motion_prompt/);
      });
      it('names a shot that exists and stands earlier', () => {
        refused(parts((t) => { t.shots[1].continues = 'nobody'; }), /shots\.1\.continues: the template has no shot "nobody"/);
        refused(parts((t) => { t.shots[1].continues = 's2'; }), /shots\.1\.continues: "s2" does not stand before this shot/);
        refused(parts((t) => { t.shots[1].continues = 's4'; }), /shots\.1\.continues: "s4" does not stand before this shot/);
      });
      it('one level: it names the shot that owns the clip, not another part', () => {
        refused(parts((t) => { t.shots[2].continues = 's2'; }), /shots\.2\.continues: "s2" continues a clip itself: name the shot that owns the clip, "s1"/);
      });
      it('the parts of a clip follow each other', () => {
        refused(parts((t) => {
          Object.assign(t.shots[1], { products: ['1'], still_prompt: 'b', motion_prompt: 'm', clip_seconds: 4 });
          delete t.shots[1].continues;
        }), /shots\.2\.continues: the parts of a clip follow each other: "s2" stands between "s1" and this shot/);
      });
      it('has no prompt, no clip_seconds, no stills and no product of its own, and comes in by a cut', () => {
        refused(parts((t) => { t.shots[1].still_prompt = 'b'; }), /shots\.1\.still_prompt: a shot that continues a clip has no still_prompt/);
        refused(parts((t) => { t.shots[1].motion_prompt = 'm'; }), /shots\.1\.motion_prompt: a shot that continues a clip has no motion_prompt/);
        refused(parts((t) => { t.shots[1].clip_seconds = 4; }), /shots\.1\.clip_seconds: a shot that continues a clip has no clip_seconds/);
        refused(parts((t) => { t.stills = [{ id: 'lead', prompt: 'p', references: [] }]; t.shots[0].stills = ['lead']; t.shots[1].stills = ['lead']; }), /shots\.1\.stills: a shot that continues a clip has no stills/);
        refused(parts((t) => { t.shots[1].products = ['1']; }), /shots\.1\.products: a shot that continues a clip names no product/);
        refused(parts((t) => { t.shots[1].in = { kind: 'crossfade', frames: 8 }; }), /shots\.1\.in: a shot that continues a clip comes in by a cut/);
        refused(parts((t) => { t.shots[1].in = { kind: 'zoom' }; }), /shots\.1\.in: /);
      });
      it('the parts fit the clip: all their frames, with the transition after the last, within the billed clip_seconds', () => {
        expect(parts((t) => { timed(t, [40, 40, 40, 30, 30]); t.texts[0].for = 120; })).toEqual([]);                     // 120 frames of a 4 s clip
        refused(parts((t) => { timed(t, [40, 40, 41, 30, 30]); }), /shots\.0\.clip_seconds: the shots "s1", "s2", "s3" show 121 frames of this clip .* asked for 4 s \(120 frames\)/);
        refused(parts((t) => { timed(t, [40, 40, 36, 30, 30]); t.shots[3].in = { kind: 'crossfade', frames: 8 }; }), /shots\.0\.clip_seconds: the shots "s1", "s2", "s3" show 124 frames/);
        expect(parts((t) => { timed(t, [40, 40, 41, 30, 30]); t.shots[0].clip_seconds = 4.1; })).toEqual([]);           // billed 5 s
      });
      it('speech: no shot continues a clip', () => {
        refused(speech((t) => { t.shots[1].continues = 's1'; }), /shots\.1\.continues: a speech shot continues no clip/);
        refused(speech((t) => { delete t.shots[1].motion_prompt; }), /shots\.1\.motion_prompt: a speech shot needs motion_prompt/);
        refused(speech((t) => { delete t.shots[1].clip_seconds; }), /shots\.1\.clip_seconds: a speech shot needs clip_seconds/);
      });
    });
    it('refuses a shot over 15 s and a video over 60 s', () => {
      refused(beats((t) => { t.shots[0].for = 451; t.shots[0].clip_seconds = 15; }), /shots\.0\.for/);
      refused(beats((t) => { t.shots[0].clip_seconds = 16; }), /shots\.0\.clip_seconds/);
      refused(beats((t) => {
        t.shots = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, at: i * 400, for: 400, products: [], still_prompt: 'a', motion_prompt: 'm', clip_seconds: 14, action: 'a' }));
      }), /shots: a video is at most 60 s/);
    });
  });

  describe('speech', () => {
    it('refuses a template without script or presenter', () => {
      refused(speech((t) => { delete t.script; }), /script: a speech template needs script and presenter/);
      refused(speech((t) => { delete t.presenter; }), /script: a speech template needs script and presenter/);
    });
    it('refuses a shot with at, for, still_prompt or stills, or without segment', () => {
      refused(speech((t) => { t.shots[0].at = 0; t.shots[0].for = 90; }), /shots\.0: a speech shot has no at and for/);
      refused(speech((t) => { t.shots[0].still_prompt = 'a woman'; }), /shots\.0\.still_prompt: .*presenter still/);
      refused(speech((t) => { t.shots[0].stills = ['skin']; }), /shots\.0\.stills: .*presenter still/);
      refused(speech((t) => { delete t.shots[0].segment; }), /shots\.0: a speech shot needs segment/);
    });
    it('refuses shots that do not follow the segments one to one', () => {
      refused(speech((t) => { t.shots[0].segment = 'close'; t.shots[1].segment = 'open'; }), /shots\.0\.segment/);
      refused(speech((t) => { t.shots.pop(); }), /shots: one shot per script segment/);
      refused(speech((t) => { t.shots[1].segment = 'nowhere'; }), /shots\.1\.segment/);
    });
    it('refuses a transition that needs frames after a segment ends, and a punch-in', () => {
      for (const kind of ['crossfade', 'whip', 'push']) refused(speech((t) => { t.shots[1].in = { kind, to: 'left' }; if (kind === 'crossfade') delete t.shots[1].in.to; }), /shots\.1\.in: .*cut, zoom, flash or dip/);
      for (const kind of ['cut', 'zoom', 'flash', 'dip']) expect(speech((t) => { t.shots[1].in = { kind }; t.windows = []; t.stills = []; })).toEqual([]);
      refused(speech((t) => { t.shots[1].motion = { kind: 'punch-in', at: 10 }; }), /shots\.1\.motion/);
      refused(speech((t) => { t.audio.music.duck = { to: 0.1, under: [{ at: 0, for: 10 }] }; }), /audio\.music\.duck\.under/);
    });
    it('refuses a talking clip over 14 s and clips over 58 s together', () => {
      refused(speech((t) => { t.shots[0].clip_seconds = 14.5; }), /shots\.0\.clip_seconds/);
      refused(speech((t) => {
        t.script.segments = Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, lines: 'some words', seconds: 12 }));
        t.shots = t.script.segments.map((s: Json, i: number) => ({ id: `s${i}`, segment: s.id, products: [], motion_prompt: 'm', clip_seconds: 12, action: 'a' }));
        t.texts = []; t.cards = []; t.windows = [];
      }), /shots: the talking clips are asked for 60 s together/);
    });
    it('refuses a text with at and for or without a mark', () => {
      refused(speech((t) => { t.texts[0].at = 0; t.texts[0].for = 30; }), /texts\.0: a speech text has a mark/);
      refused(speech((t) => { delete t.texts[0].mark; }), /texts\.0: a speech text needs mark/);
    });
    it('mark-unknown: a text, a card or a window names a mark the script lacks', () => {
      refused(speech((t) => { t.texts[0].mark = 'ghost'; }), /texts\.0\.mark: mark-unknown/);
      refused(speech((t) => { t.cards[0].mark = 'ghost'; }), /cards\.0\.mark: mark-unknown/);
      refused(speech((t) => { t.windows[0].mark = 'ghost'; }), /windows\.0\.mark: mark-unknown/);
    });
    it('refuses a script that cannot be read: unbalanced, duplicate or empty marks, a segment without words', () => {
      refused(speech((t) => { t.script.segments[0].lines = '[hook]I tried it. [proof]Look.[/proof]'; }), /script\.segments: mark-unbalanced: segment "open"/);
      refused(speech((t) => { t.script.segments[1].lines = 'It is [hook]the one.[/hook]'; }), /script\.segments: mark-duplicate/);
      refused(speech((t) => { t.script.segments[1].lines = 'It is [name][/name] the one.'; }), /script\.segments: mark-empty/);
      refused(speech((t) => { t.script.segments[1].lines = '   '; }), /script\.segments: segment-empty: segment "close"/);
      refused(speech((t) => { t.script.segments[1].id = 'open'; }), /the segment id "open" is used twice/);
    });
    it('window-overlap: two windows on marks that share words', () => {
      refused(speech((t) => {
        t.script.segments[0].lines = '[hook]I tried {product} for [proof]two weeks.[/proof][/hook] Look.';
        t.windows.push({ mark: 'hook', corner: 'top-left', behind: 'still:skin' });
      }), /windows: window-overlap/);
    });
    it('window rules of the editor: the windows of a segment rest at one place, and their shot neither comes in nor leaves by a zoom', () => {
      const second = (t: Json, more: Json = {}) => {
        t.script.segments[0].lines = '[hook]I tried {product}.[/hook] [proof]Look.[/proof] And [again]look again.[/again]';
        t.windows.push({ mark: 'again', corner: 'top-right', behind: 'still:skin', ...more });
      };
      expect(speech((t) => { second(t); })).toEqual([]);
      refused(speech((t) => { second(t, { corner: 'top-left' }); }), /windows\.1: .*one place/);
      refused(speech((t) => { second(t, { width: 30 }); }), /windows\.1: .*one place/);
      refused(speech((t) => { second(t, { radius: 4 }); }), /windows\.1: .*one place/);
      refused(speech((t) => { t.shots[1].in = { kind: 'zoom' }; }), /shots\.1\.in: .*window/);          // segment 1 has the window and leaves by the zoom
      refused(speech((t) => {
        t.script.segments.unshift({ id: 'intro', lines: 'Hello there.', seconds: 4 });
        t.shots.unshift({ id: 's0', segment: 'intro', products: [], motion_prompt: 'm', clip_seconds: 4, action: 'a' });
        t.shots[1].in = { kind: 'zoom' };                                                                 // the segment with the window comes in by the zoom
      }), /shots\.1\.in: .*window/);
      expect(speech((t) => { t.windows = []; t.stills = []; t.shots[1].in = { kind: 'zoom' }; })).toEqual([]);
    });
    it('refuses a transition between talking clips of more than 30 frames, two cards with one picture on one mark, and a duck above the gain', () => {
      refused(speech((t) => { t.shots[1].in = { kind: 'dip', frames: 31 }; }), /shots\.1\.in\.frames/);
      expect(speech((t) => { t.shots[1].in = { kind: 'dip', frames: 30 }; })).toEqual([]);
      refused(speech((t) => { t.cards.push({ ...t.cards[0], id: 'c2' }); }), /cards\.1: .*same picture/);
      expect(speech((t) => { t.cards.push({ ...t.cards[0], id: 'c2', image: 'product:1.2' }); })).toEqual([]);
      refused(speech((t) => { t.audio.music.duck = { to: 0.5, under: 'sound' }; }), /audio\.music\.duck\.to/);
      refused(beats((t) => { t.audio.music.duck = { to: 0.9, under: 'captions' }; }), /audio\.music\.duck\.to/);
    });
    it('refuses a picture that does not exist: an unknown still, a still that builds on a later one, a product beyond products.max', () => {
      refused(speech((t) => { t.windows[0].behind = 'still:nothing'; }), /windows\.0\.behind/);
      refused(speech((t) => { t.cards[0].image = 'product:3'; }), /cards\.0\.image: .*products\.max/);
      refused(speech((t) => { t.stills = [{ id: 'after', prompt: 'p', references: ['still:skin'] }, t.stills[0]]; }), /stills\.0\.references\.0/);
      refused(speech((t) => { t.stills.push({ ...t.stills[0] }); }), /stills\.1\.id/);
      expect(speech((t) => {
        t.stills.push({ id: 'after', prompt: 'p', references: ['still:skin', 'product:1', 'product:1.3'] });
        t.cards.push({ id: 'c2', mark: 'hook', image: 'still:after', box: { left: 60, top: 27, right: 86, bottom: 50 } });
      })).toEqual([]);
    });
    it('what a paid request is made from names only products every customer has (1 … products.min); a card or a window may go up to products.max', () => {
      // the fixture takes 1 to 2 products
      refused(speech((t) => { t.shots[0].products = ['2']; }), /shots\.0\.products: .*products\.min \(1\)/);
      refused(speech((t) => { t.stills[0].references = ['product:2']; }), /stills\.0\.references\.0: .*products\.min \(1\)/);
      refused(speech((t) => { t.stills[0].references = ['product:2.2']; }), /stills\.0\.references\.0: .*products\.min \(1\)/);
      refused(speech((t) => { t.presenter.references = ['product:2']; }), /presenter\.references\.0: .*products\.min \(1\)/);
      expect(speech((t) => { t.cards[0].image = 'product:2'; t.windows[0].behind = 'product:2.2'; t.stills = []; })).toEqual([]);
      refused(speech((t) => { t.cards[0].image = 'product:3'; }), /cards\.0\.image: .*products\.max \(2\)/);
      expect(speech((t) => { t.products = { min: 2, max: 2 }; t.shots[0].products = ['2', 'all']; t.presenter.references = ['product:2', 'product:1.2']; })).toEqual([]);
    });
    it('the presenter still says which photographs it is made from: products only, at most 4', () => {
      refused(speech((t) => { delete t.presenter.references; }), /presenter\.references/);
      expect(speech((t) => { t.presenter.references = []; })).toEqual([]);
      refused(speech((t) => { t.presenter.references = ['still:skin']; }), /presenter\.references\.0/);
      refused(speech((t) => { t.presenter.references = ['product:1', 'product:1.2', 'product:1.3', 'product:1.4', 'product:1.5']; }), /presenter\.references/);
    });
    it('still-unused: a still that no card, no window and no other still uses would be paid for nothing', () => {
      refused(speech((t) => { t.windows = []; }), /stills\.0: still-unused/);
      expect(speech((t) => { t.windows = []; t.cards[0].image = 'still:skin'; })).toEqual([]);
      expect(speech((t) => {
        t.stills.push({ id: 'after', prompt: 'p', references: ['still:skin'] });
        t.windows[0].behind = 'still:after';                         // "skin" is used by "after", "after" by the window
      })).toEqual([]);
      refused(speech((t) => { t.stills.push({ id: 'after', prompt: 'p', references: ['still:skin'] }); }), /stills\.1: still-unused/);
    });
  });

  it('refuses ids that are used twice among shots, texts and cards', () => {
    refused(speech((t) => { t.texts[0].id = 's1'; }), /texts\.0\.id: the id "s1" is already used by shots\.0/);
    refused(speech((t) => { t.cards[0].id = 'x1'; }), /cards\.0\.id/);
  });
  it('refuses a shot that shows a product beyond products.min, and min above max', () => {
    refused(beats((t) => { t.shots[0].products = ['2']; }), /shots\.0\.products/);
    refused(beats((t) => { t.products = { min: 1, max: 2 }; t.shots[0].products = ['2']; }), /shots\.0\.products: .*products\.min/);
    refused(beats((t) => { t.products = { min: 3, max: 2 }; }), /products/);
  });
  it('refuses a canvas other than 720×1280 or 1080×1920 at 30 fps', () => {
    refused(beats((t) => { t.canvas = { width: 720, height: 1920, fps: 30 }; }), /canvas/);
    refused(beats((t) => { t.canvas = { width: 1080, height: 1920, fps: 60 }; }), /canvas\.fps/);
    refused(beats((t) => { t.canvas = { width: 800, height: 1280, fps: 30 }; }), /canvas\.width/);
  });

  describe('a value that reaches HTML, a file path or a paid request has a pattern', () => {
    const hostile: [string, (t: Json) => void, RegExp][] = [
      ['a shot id with a quote', (t) => { t.shots[0].id = 's1" onload="x'; }, /shots\.0\.id/],
      ['an id that starts with a digit', (t) => { t.texts[0].id = '1x'; }, /texts\.0\.id/],
      ['an id of 25 characters', (t) => { t.texts[0].id = 'x'.repeat(25); }, /texts\.0\.id/],
      ['a style name with a space', (t) => { t.styles = { 'main x{}': t.styles.main }; }, /styles/],
      ['a style named by a text but not as an id', (t) => { t.texts[0].style = 'main;x'; }, /texts\.0\.style/],
      ['a colour that carries CSS', (t) => { t.styles.main.fill = 'red;background:url(x)'; }, /styles\.main\.fill/],
      ['a shadow that carries CSS', (t) => { t.styles.main.shadows = ['0px 0px 2px #000;position:fixed']; }, /styles\.main\.shadows\.0/],
      ['a font outside the two', (t) => { t.styles.main.font = 'Comic Sans MS, url(x)'; }, /styles\.main\.font/],
      ['a box outside 0 … 100', (t) => { t.texts[0].box.right = 140; }, /texts\.0\.box\.right/],
      ['a box with left ≥ right', (t) => { t.texts[0].box = { left: 60, top: 10, right: 40, bottom: 20 }; }, /texts\.0\.box/],
      ['a link that is not http(s)', (t) => { t.source.url = 'javascript:alert(1)'; }, /source\.url/],
      ['a template id that is a path', (t) => { t.id = '../../etc'; }, /^id/],
      ['a control character in a copy', (t) => { t.texts[0].copy = 'Hi\u0007 there'; }, /texts\.0\.copy/],
      ['a blank copy', (t) => { t.texts[0].copy = '  \n '; }, /texts\.0\.copy/],
      ['a copy over 200 characters', (t) => { t.texts[0].copy = 'x'.repeat(201); }, /texts\.0\.copy/],
      ['a prompt over 2000 characters', (t) => { t.shots[0].motion_prompt = 'x'.repeat(2001); }, /shots\.0\.motion_prompt/],
      ['a product that is not "all" or a number', (t) => { t.shots[0].products = ['1; drop']; }, /shots\.0\.products\.0/],
      ['a gain outside 0 … 2', (t) => { t.audio.music.gain = 9; }, /audio\.music\.gain/],
    ];
    it.each(hostile)('%s', (_name, change, pattern) => {
      refused(beats(change), pattern);
    });
    const hostileSpeech: [string, (t: Json) => void, RegExp][] = [
      ['a voice id with a space', (t) => { t.presenter.voice.voice_id = 'abc def'; }, /presenter\.voice\.voice_id/],
      ['a picture that is a path', (t) => { t.cards[0].image = 'still:../../x'; }, /cards\.0\.image/],
      ['a picture of product 9', (t) => { t.cards[0].image = 'product:9'; }, /cards\.0\.image/],
      ['a mark name with a bracket', (t) => { t.cards[0].mark = 'na]me'; }, /cards\.0\.mark/],
      ['a segment id with a slash', (t) => { t.script.segments[0].id = 'a/b'; }, /script\.segments\.0\.id/],
      ['a caption box outside the canvas', (t) => { t.captions.box.left = -4; }, /captions\.box\.left/],
    ];
    it.each(hostileSpeech)('%s', (_name, change, pattern) => {
      refused(speech(change), pattern);
    });
  });

  describe('characters no text may hold', () => {
    const bad: [string, string][] = [['a C0 control', '\u0007'], ['a tab', '\t'], ['a carriage return', '\r'], ['DEL', '\u007f'], ['a C1 control', '\u0085'], ['a C1 control at the end of the block', '\u009f'],
      ['a right-to-left override', '\u202e'], ['a left-to-right embedding', '\u202a'], ['a bidirectional isolate', '\u2066'], ['a pop directional isolate', '\u2069']];
    it('values.ts spells the bidirectional characters of its pattern as \\u escapes: a formatter or an editor can drop a raw one without a sound', () => {
      expect(readFileSync(new URL('./values.ts', import.meta.url), 'utf8')).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/);
    });
    it.each(bad)('%s is refused in a copy, a prompt, the lines, a title, an action and a product name', (_name, ch) => {
      refused(beats((t) => { t.texts[0].copy = `Hi${ch}there`; }), /texts\.0\.copy/);
      refused(beats((t) => { t.texts[0].source_copy = `Hi${ch}there`; }), /texts\.0\.source_copy/);
      refused(beats((t) => { t.shots[0].still_prompt = `a${ch}bottle`; }), /shots\.0\.still_prompt/);
      refused(beats((t) => { t.title = `Serum${ch}drop`; }), /title/);
      refused(beats((t) => { t.shots[0].action = `A${ch}bottle`; }), /shots\.0\.action/);
      refused(beats((t) => { t.description = `One${ch}bottle`; }), /description/);
      refused(speech((t) => { t.script.segments[1].lines = `It is [name]the${ch}one.[/name]`; }), /script\.segments\.1\.lines/);
      refused(fill((f) => { f.texts.x1 = `I tried${ch}it`; }), /texts\.x1/);
      refused(fill((f) => { f.script.close = `It is [name]the${ch}one.[/name]`; }), /script\.close/);
      refused(fill((f) => { f.products[0].name = `Glow${ch}Serum`; }), /products\.0\.name/);
      refused(fill((f) => { f.shots.s1.motion_prompt = `she${ch}leans in`; }), /shots\.s1\.motion_prompt/);
    });
    it('a line break is allowed where a text may break: a copy, a prompt, the lines, the description; not in a title, an action, a tag or a product name', () => {
      expect(beats((t) => { t.texts[0].copy = 'Hi\n{product}'; t.shots[0].still_prompt = 'a bottle\non a shelf'; t.description = 'One bottle.\nOne line.'; })).toEqual([]);
      expect(speech((t) => { t.script.segments[1].lines = 'It is\n[name]the {product}.[/name]'; })).toEqual([]);
      expect(fill((f) => { f.texts.x1 = 'I tried\nGlow Serum'; f.script.close = 'It is\n[name]the Glow Serum.[/name]'; })).toEqual([]);
      refused(beats((t) => { t.title = 'Serum\ndrop'; }), /title/);
      refused(beats((t) => { t.shots[0].action = 'A bottle\non a shelf'; }), /shots\.0\.action/);
      refused(beats((t) => { t.tags = ['a\nb']; }), /tags\.0/);
      refused(beats((t) => { t.category = 'a\nb'; }), /category/);
      refused(fill((f) => { f.products[0].name = 'Glow\nSerum'; }), /products\.0\.name/);
    });
  });

  it('never throws, whatever it is given', () => {
    fc.assert(fc.property(fc.jsonValue(), (value) => { Template.safeParse(value); Fill.safeParse(value); }), { numRuns: 300 });
    const anyChange = fc.tuple(fc.constantFrom('shots', 'texts', 'script', 'presenter', 'stills', 'cards', 'windows', 'captions', 'styles', 'audio', 'canvas', 'products', 'mode'), fc.jsonValue());
    fc.assert(fc.property(fc.array(anyChange, { minLength: 1, maxLength: 3 }), (changes) => {
      const t: Json = speechTemplate();
      for (const [key, value] of changes) t[key] = value;
      Template.safeParse(t);
    }), { numRuns: 300 });
  });
});

describe('Fill', () => {
  it('accepts a minimal fill, a beats fill and a speech fill', () => {
    expect(refusals(Fill, { language: 'en', products: [{ name: 'A', images: ['uploads/u/1.jpg'] }], texts: {}, shots: {}, music: { prompt: 'x' } })).toEqual([]);
    expect(refusals(Fill, beatsFill())).toEqual([]);
    expect(fill()).toEqual([]);
    expect(Fill.parse(speechFill())).toEqual(speechFill());
  });
  it('refuses unknown keys at every depth', () => {
    refused(fill((f) => { f.surprise = 1; }), /Unrecognized key: "surprise"/);
    refused(fill((f) => { f.products[0].description = 'x'; }), /Unrecognized key: "description"/);
    refused(fill((f) => { f.shots.s1.voice = 'x'; }), /Unrecognized key: "voice"/);
    refused(fill((f) => { f.stills.skin.references = []; }), /Unrecognized key: "references"/);
    refused(fill((f) => { f.presenter.voice = {}; }), /Unrecognized key: "voice"/);
    refused(fill((f) => { f.music.gain = 1; }), /Unrecognized key: "gain"/);
  });
  it('refuses a placeholder left in a copy, a prompt, the lines or a product name, and names it', () => {
    refused(fill((f) => { f.texts.x1 = 'I tried {product}'; }), /texts\.x1: unfilled:product/);
    refused(fill((f) => { f.shots.s1.motion_prompt = 'she holds {product} and {brand}'; }), /shots\.s1\.motion_prompt: unfilled:product\n.*unfilled:brand/);
    refused(fill((f) => { f.script.open = '[hook]I tried {product}.[/hook] [proof]Look.[/proof]'; }), /script\.open: unfilled:product/);
    refused(fill((f) => { f.presenter.still_prompt = 'a woman with {product}'; }), /presenter\.still_prompt: unfilled:product/);
    refused(fill((f) => { f.stills.skin.prompt = '{before_subject}'; }), /stills\.skin\.prompt: unfilled:before_subject/);
    refused(fill((f) => { f.music.prompt = '{mood} music'; }), /music\.prompt: unfilled:mood/);
    refused(fill((f) => { f.products[0].name = '{product}'; }), /products\.0\.name: unfilled:product/);
    expect(fill((f) => { f.texts.x1 = 'Save 20% {today only}'; })).toEqual([]);   // braces that are not a placeholder name
  });
  it('refuses every placeholder the editor refuses: a name of letters, digits, _ . : -', () => {
    for (const name of ['Product', 'product-name', '1', 'a.b', 'x:y', 'PRODUCT_2']) {
      refused(fill((f) => { f.texts.x1 = `Try {${name}} now`; }), new RegExp(`texts\\.x1: unfilled:${name}`));
      refused(fill((f) => { f.script.close = `It is [name]the {${name}}.[/name]`; }), new RegExp(`script\\.close: unfilled:${name}`));
      refused(fill((f) => { f.shots.s2.motion_prompt = `she holds {${name}}`; }), new RegExp(`shots\\.s2\\.motion_prompt: unfilled:${name}`));
    }
  });
  it('refuses customer values that fail their pattern', () => {
    const hostile: [(f: Json) => void, RegExp][] = [
      [(f) => { f.products[0].images = ['../../etc/passwd']; }, /products\.0\.images\.0/],
      [(f) => { f.products[0].images = ['/etc/passwd']; }, /products\.0\.images\.0/],
      [(f) => { f.products[0].images = ['uploads/../secret.png']; }, /products\.0\.images\.0/],
      [(f) => { f.products[0].images = ['uploads/a b.png']; }, /products\.0\.images\.0/],
      [(f) => { f.products[0].images = []; }, /products\.0\.images/],
      [(f) => { f.products = []; }, /products/],
      [(f) => { f.products[0].name = 'x'.repeat(121); }, /products\.0\.name/],
      [(f) => { f.language = 'en"><script>'; }, /language/],
      [(f) => { f.texts = { 'x1"': 'Hi' }; }, /texts/],
      [(f) => { f.texts.x1 = 'x'.repeat(201); }, /texts\.x1/],
      [(f) => { f.texts.x1 = 'Hi\u0000'; }, /texts\.x1/],
      [(f) => { f.texts.x1 = ''; }, /texts\.x1/],
      [(f) => { f.shots.s1.motion_prompt = ''; }, /shots\.s1\.motion_prompt/],
    ];
    for (const [change, pattern] of hostile) refused(fill(change), pattern);
  });
});
