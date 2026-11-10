import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { minutesFor, paidFor } from './estimate.ts';
import { beatsTemplate, continuingTemplate, speechTemplate } from './fixture.ts';
import { Template } from './schema.ts';
import type { TemplateJson } from './schema.ts';

const withShots = (n: number, clip: number): TemplateJson => {
  const t = beatsTemplate();
  t.shots = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, at: i * 90, for: 90, products: ['1'], still_prompt: 'p', motion_prompt: 'm', clip_seconds: clip, action: 'a' }));
  return t as unknown as TemplateJson;
};
const speech = (change: (t: ReturnType<typeof speechTemplate>) => void = () => {}): TemplateJson => {
  const t = speechTemplate();
  change(t);
  return Template.parse(t);
};
const golden = (name: string): TemplateJson =>
  Template.parse(JSON.parse(readFileSync(new URL(`../resolve/golden/${name}/template.json`, import.meta.url), 'utf8')));

describe('paidFor', () => {
  it('5-shot beats template, clips <= 4 s', () => {
    expect(paidFor(withShots(5, 3), 1)).toEqual({ images: 5, clips: 5, clipSeconds: 20, music: 1, voice: 0 });
  });
  it('multiplies by variants', () => {
    expect(paidFor(withShots(5, 3), 3)).toEqual({ images: 15, clips: 15, clipSeconds: 60, music: 3, voice: 0 });
  });
  it('bills a 6.2 s clip as 7', () => {
    expect(paidFor(withShots(1, 6.2), 1).clipSeconds).toBe(7);
  });
  it('beats with stills: one image per shot and one per generated still', () => {
    const template = { ...withShots(5, 3), stills: [{ id: 'lead', prompt: 'p', references: [] }] };
    expect(paidFor(template, 1)).toEqual({ images: 6, clips: 5, clipSeconds: 20, music: 1, voice: 0 });
    expect(paidFor(template, 3)).toEqual({ images: 18, clips: 15, clipSeconds: 60, music: 3, voice: 0 });
  });
  it('beats with shots that continue a clip: one image and one clip per shot that owns a clip, none for a part', () => {
    const template = Template.parse(continuingTemplate());                    // s2 and s3 continue s1: s1, s4, s5 own a clip
    expect(paidFor(template, 1)).toEqual({ images: 3, clips: 3, clipSeconds: 12, music: 1, voice: 0 });
    expect(paidFor(template, 3)).toEqual({ images: 9, clips: 9, clipSeconds: 36, music: 3, voice: 0 });
    template.shots[0]!.clip_seconds = 6.5;                                     // the owner's clip carries its parts: it is billed alone
    template.stills = [{ id: 'lead', prompt: 'p', references: [] }];
    expect(paidFor(template, 2)).toEqual({ images: 8, clips: 6, clipSeconds: 30, music: 2, voice: 0 });
  });
  it('speech: one presenter still and one image per generated still, never one per shot', () => {
    expect(paidFor(speech(), 1)).toEqual({ images: 2, clips: 2, clipSeconds: 11, music: 1, voice: 1 });
  });
  it('speech without generated stills: the presenter still is the only image', () => {
    const template = speech((t) => { t.stills = []; t.windows = []; });
    expect(paidFor(template, 1).images).toBe(1);
    expect(paidFor(template, 3)).toEqual({ images: 3, clips: 6, clipSeconds: 33, music: 3, voice: 3 });
  });
  it('speech: a talking clip under 4 s bills 4, a 5.5 s one bills 6', () => {
    expect(paidFor(speech((t) => { t.shots[0]!.clip_seconds = 2; t.shots[1]!.clip_seconds = 5.5; }), 1).clipSeconds).toBe(10);
  });
  it('refuses a number of variants that is not a whole number from 1 on', () => {
    expect(() => paidFor(withShots(1, 3), 0)).toThrow(RangeError);
    expect(() => paidFor(withShots(1, 3), 1.5)).toThrow(RangeError);
    expect(() => paidFor(withShots(1, 3), Number.NaN)).toThrow(RangeError);
  });

  it('layering golden: 5 images, 5 clips, 20 clip seconds, 1 music, 0 voice — what that production used', () => {
    expect(paidFor(golden('layering-01'), 1)).toEqual({ images: 5, clips: 5, clipSeconds: 20, music: 1, voice: 0 });
    expect(paidFor(golden('layering-01'), 3)).toEqual({ images: 15, clips: 15, clipSeconds: 60, music: 3, voice: 0 });
  });
  it('lashly golden: the presenter still and its two evidence stills, 3 clips, 30 clip seconds, 1 music, 1 voice', () => {
    const template = golden('lashly-01');
    expect(template.stills).toHaveLength(2);
    expect(paidFor(template, 1)).toEqual({ images: 3, clips: 3, clipSeconds: 30, music: 1, voice: 1 });
    expect(paidFor(template, 3)).toEqual({ images: 9, clips: 9, clipSeconds: 90, music: 3, voice: 3 });
  });
});

// A video of `frames` frames shown in `n` equal shots, each asking the provider for `clip` seconds.
const timed = (n: number, clip: number, frames: number): TemplateJson => {
  const t = withShots(n, clip) as unknown as ReturnType<typeof beatsTemplate>;
  const each = Math.floor(frames / n);
  t.shots.forEach((shot, i) => { shot.at = i * each; shot.for = i === n - 1 ? frames - i * each : each; });
  return t as unknown as TemplateJson;
};

describe('minutesFor', () => {
  it('2 shots x 14 s, 824 frames, no speech: at least 7 minutes (the first real job took 6-8 minutes unloaded, not 5)', () => {
    expect(minutesFor(timed(2, 14, 824))).toBeGreaterThanOrEqual(7);
  });
  it('a short template (2 shots x 4 s) takes at most two minutes more than the old "2 + shots + 1" said: one of them is the second render of its 8 s (92 s)', () => {
    const old = 2 + 2 + 1;
    expect(minutesFor(timed(2, 4, 240))).toBeLessThanOrEqual(old + 2);
  });
  it('a longer clip takes longer, the clips run side by side: two 14 s clips take what one does', () => {
    expect(minutesFor(timed(1, 14, 420))).toBeGreaterThan(minutesFor(timed(1, 4, 420)));
    expect(minutesFor(timed(2, 14, 420))).toBe(minutesFor(timed(1, 14, 420)));
  });
  it('more clips than the pool holds wait for a second round', () => {
    expect(minutesFor(timed(4, 8, 420))).toBeGreaterThan(minutesFor(timed(3, 8, 420)));
  });
  it('a longer video takes longer to cut and render', () => {
    expect(minutesFor(timed(2, 8, 1500))).toBeGreaterThan(minutesFor(timed(2, 8, 300)));
  });
  it('counts the render twice, as a delivered video is rendered (the repeat check): 40 s more video is 2 x 160 s more, at least 5 minutes', () => {
    expect(minutesFor(timed(2, 8, 1500)) - minutesFor(timed(2, 8, 300))).toBeGreaterThanOrEqual(5);   // one render only: 160 s, 2 or 3 minutes
  });
  it('speech takes longer than the same video without a presenter', () => {
    expect(minutesFor(speech())).toBeGreaterThan(minutesFor(timed(2, 6, 330)));
  });
  it('counts shots, not images: a generated still adds no minute', () => {
    const template = timed(5, 3, 450);
    expect(minutesFor({ ...template, stills: [{ id: 'lead', prompt: 'p', references: [] }] })).toBe(minutesFor(template));
  });
  it('counts the shots that own a clip, as paidFor does: a shot that continues a clip adds no clip', () => {
    const template = Template.parse(continuingTemplate());                   // s1, s4, s5 own a clip: one round of the pool
    expect(minutesFor(template)).toBe(minutesFor(timed(3, 4, 150)));
    expect(minutesFor(timed(5, 4, 150))).toBeGreaterThan(minutesFor(template));
  });
});
