// Property tests: whatever valid-looking document is given, compose returns a composition that keeps its rules, or throws
// a ComposeError; never anything else.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Box, Captions, Card, ComposeFacts, Edit, EditText, Enter, Exit, Motion, Shot, Transition, Window } from '../edit/types.ts';
import { richEdit, richFacts } from './fixture.ts';
import { ComposeError, compose } from './index.ts';
import type { Composition } from './index.ts';
import { animationsOf, tagsOf, windowsOf } from './testing.ts';
import { PER_TRACK } from './tracks.ts';

const FPS = 30;
const opt = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: undefined });
const side = fc.constantFrom('left' as const, 'right' as const, 'top' as const, 'bottom' as const);
const frames = opt(fc.integer({ min: 1, max: 8 }));
const colour = fc.constantFrom('#fff', '#101418', '#E0508C', '#00000080');
const opaque = fc.constantFrom('#fff', '#101418', '#E0508C');                  // a background has no alpha
const unsafe = opt(fc.constant(false as const));                               // "safe": false
const scale = opt(fc.double({ min: 1.01, max: 1.5, noNaN: true }));

const transition: fc.Arbitrary<Transition> = fc.oneof(
  fc.constant({ kind: 'cut' as const }),
  fc.record({ kind: fc.constant('crossfade' as const), frames }),
  fc.record({ kind: fc.constant('push' as const), to: side, frames }),
  fc.record({ kind: fc.constant('whip' as const), to: side, frames }),
  fc.record({ kind: fc.constant('zoom' as const), frames, scale }),
  fc.record({ kind: fc.constant('flash' as const), frames, colour: opt(colour) }),
  fc.record({ kind: fc.constant('dip' as const), frames, colour: opt(colour) }),
);
const zoom: fc.Arbitrary<Motion> = fc.oneof(
  fc.record({ kind: fc.constant('push-in' as const), to: scale, ease: opt(fc.constantFrom('linear' as const, 'in-out' as const, 'out' as const)) }),
  fc.record({ kind: fc.constant('pull-out' as const), from: scale }),
);
const enter: fc.Arbitrary<Enter> = fc.oneof(
  fc.constant({ kind: 'none' as const }),
  fc.record({ kind: fc.constant('fade' as const), frames }),
  fc.record({ kind: fc.constant('pop' as const), frames, from: opt(fc.double({ min: 0, max: 2, noNaN: true })) }),
  fc.record({ kind: fc.constant('slide' as const), from: side, frames, distance: opt(fc.integer({ min: 0, max: 20 })) }),
  fc.record({ kind: fc.constant('blur' as const), frames, radius: opt(fc.double({ min: 0, max: 10, noNaN: true })) }),
);
const exit: fc.Arbitrary<Exit> = fc.oneof(
  fc.constant({ kind: 'none' as const }),
  fc.record({ kind: fc.constant('fade' as const), frames }),
  fc.record({ kind: fc.constant('pop' as const), frames, to: opt(fc.double({ min: 0, max: 2, noNaN: true })) }),
  fc.record({ kind: fc.constant('slide' as const), to: side, frames, distance: opt(fc.integer({ min: 0, max: 20 })) }),
  fc.record({ kind: fc.constant('blur' as const), frames, radius: opt(fc.double({ min: 0, max: 10, noNaN: true })) }),
);
// mostly inside every safe area; now and then a box in the column of the buttons or outside the rectangle
const box = fc.oneof(
  { weight: 12, arbitrary: fc.constantFrom(
    { left: 8, top: 16, right: 84, bottom: 30 }, { left: 10, top: 34, right: 80, bottom: 46 }, { left: 6, top: 14, right: 86, bottom: 65 },
    { left: 8, top: 40, right: 84, bottom: 62 }, { left: 20, top: 50, right: 70, bottom: 56 }, { left: 9, top: 15, right: 91, bottom: 27 },
  ) },
  { weight: 1, arbitrary: fc.constantFrom({ left: 9, top: 52, right: 91, bottom: 64 }, { left: 2, top: 70, right: 98, bottom: 90 }, { left: 88, top: 46, right: 93, bottom: 60 }) },
);
// Turkish letters, an emoji, a long word, a sentence end
const word = fc.oneof(
  { weight: 16, arbitrary: fc.constantFrom('kirpik', 'İşte', 'ğüşöç', 'şimdi', 'glow', 'serum', 'three', 'weeks', 'results', '✨', 'my', 'a', 'night.', 'look!', 'çok', 'güzel') },
  { weight: 1, arbitrary: fc.constant('Supercalifragilistic') },
);
const fraction = fc.double({ min: 0, max: 1, noNaN: true });

const shotSeed = fc.record({
  length: fc.integer({ min: 24, max: 90 }), media: fc.constantFrom('a', 'b', 'c', 'pic'), from: opt(fc.integer({ min: 0, max: 40 })),
  in: transition, motion: opt(fc.oneof(zoom, fc.record({ kind: fc.constant('punch' as const), where: fraction, frames: opt(fc.integer({ min: 1, max: 6 })), to: scale }))),
  sound: opt(fc.double({ min: 0, max: 2, noNaN: true })), focus: opt(fc.tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }))),
  // the windows of a shot share their place; each one starts `gap` frames after the one before it (or after the shot has come in)
  // width: at most 50, the widest window the safe area of 'both' and 'reels' holds (validate refuses a wider one: I1)
  place: fc.record({ corner: fc.constantFrom('top-left' as const, 'top-right' as const, 'bottom-left' as const, 'bottom-right' as const), width: opt(fc.integer({ min: 20, max: 50 })), radius: opt(fc.integer({ min: 0, max: 8 })) }),
  windows: fc.oneof({ weight: 2, arbitrary: fc.constant([]) }, { weight: 3, arbitrary: fc.array(fc.record({
    frames: fc.integer({ min: 2, max: 5 }), extra: fc.integer({ min: 0, max: 20 }), gap: fc.integer({ min: 0, max: 12 }), behind: fc.constantFrom('pic', 'b'), behindMotion: opt(zoom),
    swaps: fc.array(fc.record({ where: fraction, behind: fc.constantFrom('pic', 'b', 'c') }), { maxLength: 3 }),
  }), { minLength: 1, maxLength: 3 }) }),
  reversed: fc.oneof({ weight: 7, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) }),     // the windows in descending order: `window-range`
});
const textSeed = fc.record({
  where: fraction, length: fc.integer({ min: 40, max: 80 }), box, style: fc.constantFrom('hook', 'label', 'tag', 'caption', 'mine'),
  lines: fc.array(fc.array(word, { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 3 }),
  more: opt(fc.integer({ min: 0, max: 2 })), shrink: opt(fc.double({ min: 0.5, max: 1, noNaN: true })), valign: opt(fc.constantFrom('top' as const, 'middle' as const, 'bottom' as const)),
  enter: opt(enter), exit: opt(exit), stagger: opt(fc.integer({ min: 0, max: 6 })), safe: unsafe,
});
const captionSeed = fc.record({
  words: fc.array(fc.record({ text: word, gap: fc.oneof({ weight: 4, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.integer({ min: 1, max: 25 }) }), length: fc.integer({ min: 1, max: 14 }) }), { maxLength: 80 }),
  start: fc.integer({ min: 0, max: 30 }), box: fc.constantFrom({ left: 9, top: 52, right: 86, bottom: 64 }, { left: 6, top: 40, right: 86, bottom: 65 }, { left: 6, top: 30, right: 94, bottom: 45 }, { left: 9, top: 52, right: 91, bottom: 64 }), style: opt(fc.constantFrom('caption', 'mine', 'label')),
  group: opt(fc.record({ words: opt(fc.integer({ min: 1, max: 4 })), lines: opt(fc.constantFrom(1 as const, 2 as const)), hold: opt(fc.integer({ min: 0, max: 20 })), pause: opt(fc.integer({ min: 1, max: 30 })) })),
  active: opt(fc.oneof(
    fc.constant({ kind: 'none' as const }),
    fc.record({ kind: fc.constant('colour' as const), colour, scale: opt(fc.double({ min: 1, max: 1.5, noNaN: true })) }),
    fc.record({ kind: fc.constant('pill' as const), colour, text: opt(colour) }),
  )),
  enter: opt(enter), safe: unsafe,
});
const cardSeed = fc.record({ where: fraction, length: fc.integer({ min: 40, max: 80 }), box, fit: opt(fc.constantFrom('contain' as const, 'cover' as const)), radius: opt(fc.integer({ min: 0, max: 50 })), enter: opt(enter), exit: opt(exit), motion: opt(zoom), safe: unsafe });
const audioSeed = fc.record({
  gain: fc.double({ min: 0.1, max: 2, noNaN: true }), from: opt(fc.integer({ min: 0, max: 30 })), short: fc.boolean(), file: fc.integer({ min: 60, max: 200 }),
  fadeIn: opt(fc.integer({ min: 0, max: 10 })), fadeOut: opt(fc.integer({ min: 0, max: 20 })),
  duck: opt(fc.record({ to: fraction, ramp: opt(fc.integer({ min: 1, max: 8 })), under: fc.oneof(fc.constant('sound' as const), fc.constant('captions' as const), fc.array(fc.record({ where: fraction, length: fc.integer({ min: 1, max: 40 }) }), { maxLength: 6 })) })),
  sounds: fc.array(fc.record({ where: fraction, length: opt(fc.integer({ min: 5, max: 30 })), from: opt(fc.integer({ min: 0, max: 5 })), gain: fc.double({ min: 0, max: 2, noNaN: true }) }), { maxLength: 2 }),
  master: opt(fc.oneof(fc.constant(false as const), fc.record({ lufs: fc.integer({ min: -24, max: -10 }), peak: opt(fc.integer({ min: -6, max: 0 })) }))),
});
const seed = fc.record({
  width: fc.constantFrom(720 as const, 1080 as const), language: fc.constantFrom('en', 'tr'), safe: opt(fc.constantFrom('tiktok' as const, 'reels' as const, 'both' as const, 'none' as const)), background: opt(opaque),
  // the picture's size in the facts; now and then the facts lack it (`media-size-unknown` for a card that shows it whole)
  picture: fc.oneof({ weight: 12, arbitrary: fc.tuple(fc.integer({ min: 1, max: 4000 }), fc.integer({ min: 1, max: 4000 })) }, { weight: 1, arbitrary: fc.constant(undefined) }),
  shots: fc.array(shotSeed, { minLength: 1, maxLength: 8 }), texts: fc.array(textSeed, { maxLength: 6 }), captions: opt(captionSeed), cards: fc.array(cardSeed, { maxLength: 2 }), audio: opt(audioSeed),
});
type Seed = typeof seed extends fc.Arbitrary<infer T> ? T : never;

const OVERLAP = new Set(['crossfade', 'push', 'whip']);

/**
 * A document that follows the rules of time and media by construction; whether its texts fit, its boxes are safe and its
 * pictures have a size is left to chance. `reversed`: a shot has its windows in descending order, which compose must refuse.
 */
function build(s: Seed): { edit: Edit; facts: Record<string, ComposeFacts>; reversed: boolean } {
  let at = 0;
  const shots: Shot[] = s.shots.map((shot, i) => {
    const video = shot.media !== 'pic';
    const motion: Motion | undefined = shot.motion === undefined ? undefined : shot.motion.kind !== 'punch' ? shot.motion
      : { kind: 'punch-in', at: at + Math.floor((shot.length - (shot.motion.frames ?? 4)) * shot.motion.where), frames: shot.motion.frames, to: shot.motion.to };
    const built: Shot = {
      id: `s${i + 1}`, at, for: shot.length, media: shot.media, from: video ? shot.from : undefined, focus: shot.focus, motion,
      in: i === 0 ? undefined : shot.in, sound: video && shot.sound !== undefined ? { gain: shot.sound } : undefined,
    };
    at += shot.length;
    return built;
  });
  const total = at;
  let reversed = false;
  s.shots.forEach((shot, i) => {
    const mine = shots[i]!.in;
    const next = shots[i + 1]?.in;
    if (mine?.kind === 'zoom' || next?.kind === 'zoom') return;
    const lead = mine && OVERLAP.has(mine.kind) ? (mine as { frames?: number }).frames ?? 10 : 0;
    const end = shots[i]!.at + shot.length;
    const windows: Window[] = [];
    let cursor = shots[i]!.at + lead;
    for (const seed of shot.windows) {
      const start = cursor + seed.gap;
      const length = 2 * seed.frames + 1 + seed.extra;
      if (start + length > end) break;
      // swaps on distinct frames of the rest (after the shrink, before the return), in order
      const rest = length - 2 * seed.frames;
      const frames = [...new Set(seed.swaps.map((swap) => start + seed.frames + Math.min(rest - 1, Math.floor(swap.where * rest))))].sort((x, y) => x - y);
      windows.push({
        ...shot.place, at: start, for: length, frames: seed.frames, behind: seed.behind, behindMotion: seed.behindMotion,
        swaps: frames.length === 0 ? undefined : frames.map((frame, j) => ({ at: frame, behind: seed.swaps[j]!.behind })),
      });
      cursor = start + length;
    }
    if (windows.length === 0) return;
    if (shot.reversed && windows.length > 1) { windows.reverse(); reversed = true; }
    shots[i]!.windows = windows;
  });
  const place = (where: number, length: number) => { const span = Math.min(length, total); return { at: Math.floor(where * (total - span)), for: span }; };
  const texts: EditText[] = s.texts.map((text, i) => ({
    id: `t${i + 1}`, ...place(text.where, text.length), box: text.box, style: text.style, copy: text.lines.map((line) => line.join(' ')).join('\n'),
    lines: text.more === undefined ? undefined : Math.min(4, text.lines.length + text.more), shrink: text.shrink, valign: text.valign, enter: text.enter, exit: text.exit, stagger: text.stagger, safe: text.safe,
  }));
  let captions: Captions | undefined;
  if (s.captions) {
    let t = s.captions.start;
    const words: Captions['words'] = [];
    for (const w of s.captions.words) {
      t += w.gap;
      if (t + w.length > total) break;
      words.push({ text: w.text, at: t, for: w.length });
      t += w.length;
    }
    captions = { box: s.captions.box, style: s.captions.style, words, group: s.captions.group, active: s.captions.active, enter: s.captions.enter, safe: s.captions.safe };
  }
  const cards: Card[] = s.cards.map((card, i) => ({ id: `card${i + 1}`, ...place(card.where, card.length), media: 'pic', box: card.box, fit: card.fit, radius: card.radius, enter: card.enter, exit: card.exit, motion: card.motion, safe: card.safe }));
  const a = s.audio;
  const edit: Edit = {
    version: 1, language: s.language, canvas: { width: s.width, height: s.width === 720 ? 1280 : 1920, fps: 30 }, frames: total, safe: s.safe, background: s.background,
    media: {
      a: { file: 'assets/a.mp4', kind: 'video' }, b: { file: 'assets/b.mp4', kind: 'video' }, c: { file: 'assets/c.mp4', kind: 'video' },
      pic: { file: 'assets/pic.png', kind: 'image' }, beat: { file: 'assets/beat.mp3', kind: 'audio' }, ping: { file: 'assets/ping.mp3', kind: 'audio' },
    },
    styles: { mine: { font: 'Montserrat', weight: 700, size: s.width === 720 ? 34 : 52, align: 'left', fill: '#ffe000', shadows: ['0px 2px 6px #000000'], upper: true, tracking: 0.05, leading: 1.2, outline: { width: 0.05, colour: '#000' } } },
    shots, texts, captions, cards,
    audio: a && {
      music: {
        media: 'beat', gain: a.gain, from: a.from, loop: a.short ? true : undefined, fadeIn: a.fadeIn, fadeOut: a.fadeOut,
        duck: a.duck && { to: a.duck.to * a.gain, ramp: a.duck.ramp, under: typeof a.duck.under === 'string' ? a.duck.under : a.duck.under.map((r) => place(r.where, r.length)) },
      },
      sounds: a.sounds.map((sound, i) => ({ id: `fx${i + 1}`, media: 'ping', at: Math.floor(sound.where * Math.max(0, total - 40)), for: sound.length === undefined ? undefined : Math.min(sound.length, 40 - (sound.from ?? 0), total), from: sound.from, gain: sound.gain })),
      master: a.master,
    },
  };
  const facts: Record<string, ComposeFacts> = {
    a: { frames: 400, audio: true }, b: { frames: 400, audio: true }, c: { frames: 400, audio: true }, pic: s.picture ? { frames: 0, audio: false, width: s.picture[0], height: s.picture[1] } : { frames: 0, audio: false },
    beat: { frames: a?.short ? a.file : 2000, audio: true }, ping: { frames: 40, audio: true },
  };
  return { edit, facts, reversed };
}

// The safe area as §12.16 states it, said a second time here: a rectangle, and the column of the buttons that is cut out of it.
const SAFE = { tiktok: { left: 6, top: 8, right: 94, bottom: 78 }, reels: { left: 6, top: 14, right: 94, bottom: 65 }, both: { left: 6, top: 14, right: 94, bottom: 65 } };
function isSafe(box: Box, safe: Edit['safe']): boolean {
  if (safe === 'none') return true;
  const area = SAFE[safe ?? 'both'];
  const inside = box.left >= area.left && box.top >= area.top && box.right <= area.right && box.bottom <= area.bottom;
  const inColumn = box.right > 86 && box.bottom > 45;
  return inside && !inColumn;
}

/** What a composition keeps of the document it was made from: a box that does not say `safe: false` lies in the safe area. */
function expectSafe(edit: Edit): void {
  for (const item of [...(edit.texts ?? []), ...(edit.cards ?? []), ...(edit.captions ? [edit.captions] : [])]) {
    if (item.safe !== false) expect(isSafe(item.box, edit.safe), JSON.stringify(item.box)).toBe(true);
  }
}

/** What every composition keeps, whatever the document. */
function expectSound(composition: Composition): void {
  const { html, timeline } = composition;
  const frame = (text: string | undefined) => Number(text) * FPS;

  // the shots tile 0 … frames
  let end = 0;
  for (const shot of timeline.shots) { expect(shot.at).toBe(end); end = shot.at + shot.for; }
  expect(end).toBe(timeline.frames);

  // every animation lies inside the time of its element
  const windows = windowsOf(timeline);
  for (const animation of timeline.animations) {
    const window = windows.get(animation.element);
    expect(window, animation.element).toBeDefined();
    expect(animation.for).toBeGreaterThanOrEqual(1);
    expect(animation.at).toBeGreaterThanOrEqual(window!.at);
    expect(animation.at + animation.for).toBeLessThanOrEqual(window!.end);
  }

  // the HTML: ids once, timed leaves, half-frame edges, tracks, no fractional pixel
  const tags = tagsOf(html);
  const ids = tags.map((tag) => tag.attrs.id).filter((id) => id !== undefined);
  expect(new Set(ids).size).toBe(ids.length);
  const tracks = new Map<string, [number, number][]>();
  for (const tag of tags) {
    for (const animation of animationsOf(tag.attrs.style)) {
      const edge = animation.delay * FPS + 0.5;
      expect(Math.abs(edge - Math.round(edge))).toBeLessThan(1e-6);
      expect(animation.duration).toBeGreaterThan(0);
    }
    if (!('data-start' in tag.attrs) || tag.attrs.id === 'root') continue;
    expect(tag.ancestors.filter((a) => 'data-start' in a.attrs)).toHaveLength(1);
    const at = frame(tag.attrs['data-start']);
    const until = at + frame(tag.attrs['data-duration']);
    expect(until).toBeLessThanOrEqual(timeline.frames + 1e-6);
    const spans = tracks.get(tag.attrs['data-track-index']!) ?? [];
    for (const [from, to] of spans) expect(at >= to - 1e-6 || until <= from + 1e-6).toBe(true);
    spans.push([at, until]);
    tracks.set(tag.attrs['data-track-index']!, spans);
  }
  for (const spans of tracks.values()) expect(spans.length).toBeLessThanOrEqual(PER_TRACK);
  expect(html).not.toMatch(/<script|will-change|text-transform|-webkit-text-stroke/);
  for (const match of html.matchAll(/(?:^|[\s;{"])(?:left|top|width|height|font-size|line-height)\s*:\s*([^;}"]+)/g)) expect(match[1]!.trim()).toMatch(/^(?:\d+px|0|100%)$/);

  // every element named by the table exists once; rest windows lie inside; checkAt lies in a rest window
  const rests = [...timeline.texts, ...timeline.captions, ...timeline.cards];
  for (const entry of [...timeline.shots, ...rests, ...timeline.audio]) expect(ids.filter((id) => id === entry.element)).toHaveLength(1);
  for (const entry of rests) {
    expect(entry.rest.for).toBeGreaterThanOrEqual(1);
    expect(entry.rest.at).toBeGreaterThanOrEqual(entry.at);
    expect(entry.rest.at + entry.rest.for).toBeLessThanOrEqual(entry.at + entry.for);
    expect(entry.at + entry.for).toBeLessThanOrEqual(timeline.frames);
  }
  for (const at of timeline.checkAt) {
    expect(rests.some((entry) => at >= entry.rest.at && at < entry.rest.at + entry.rest.for)).toBe(true);
    expect(timeline.transitions.some((t) => at >= t.at && at < t.at + t.for)).toBe(false);          // §12.17: never inside a transition
  }
  expect(timeline.checkAt).toEqual([...new Set(timeline.checkAt)].sort((x, y) => x - y));

  // the windows of a shot follow each other in time, in the table and in the list of animations (the later one of a list wins)
  for (const shot of timeline.shots) {
    const own = timeline.windows.filter((w) => w.shot === shot.id);
    own.forEach((w, k) => { if (k > 0) expect(w.at).toBeGreaterThanOrEqual(own[k - 1]!.at + own[k - 1]!.for); });
    const rows = timeline.animations.filter((a) => a.element === shot.id && a.property === 'window').map((a) => a.at);
    expect(rows).toEqual([...rows].sort((x, y) => x - y));
    expect(rows).toHaveLength(2 * own.length);
  }

  // a card's rect is whole pixels of at least one pixel; the pictures behind a window follow each other from its first frame to its last
  for (const card of timeline.cards) for (const value of Object.values(card.rect)) expect(Number.isInteger(value) && value >= 0).toBe(true);
  for (const card of timeline.cards) expect(card.rect.width >= 1 && card.rect.height >= 1).toBe(true);
  for (const window of timeline.windows) {
    let next = window.at;
    for (const picture of window.pictures) { expect(picture.at).toBe(next); expect(picture.for).toBeGreaterThanOrEqual(1); expect(ids).toContain(picture.element); next = picture.at + picture.for; }
    expect(next).toBe(window.at + window.for);
    expect(window.pictures[0]!.behind).toBe(window.behind);
  }

  // captions: every word in exactly one group, in order; a group never meets the next one
  expect(timeline.captions.flatMap((group) => group.words.map((w) => w.index))).toEqual(timeline.captions.flatMap((g) => g.words).map((_, i) => i));
  timeline.captions.forEach((group, g) => {
    expect(group.lines.join(' ').split(' ')).toEqual(group.words.map((w) => w.text));
    expect(group.words.reduce((sum, w) => sum + w.for, 0)).toBe(group.for);
    const next = timeline.captions[g + 1];
    if (next) expect(group.at + group.for).toBeLessThanOrEqual(next.at);
  });

  // the music covers the video without a gap; a lane has at most 512 points, in ascending time
  const music = timeline.audio.filter((a) => a.element.startsWith('music-'));
  let covered = 0;
  for (const pass of music) {
    expect(pass.at).toBe(covered);
    covered = pass.at + pass.for;
    expect(pass.gain.length).toBeLessThanOrEqual(512);
    expect(pass.gain.every(([f, v], i) => v >= 0 && v <= 2 && (i === 0 || f > pass.gain[i - 1]![0]))).toBe(true);
    expect([pass.gain[0]![0], pass.gain.at(-1)![0]]).toEqual([pass.at, pass.at + pass.for]);
  }
  if (music.length > 0) expect(covered).toBe(timeline.frames);
}

function expectIssues(error: unknown): void {
  expect(error).toBeInstanceOf(ComposeError);
  const { issues, code } = error as ComposeError;
  expect(issues.length).toBeGreaterThanOrEqual(1);
  expect(issues.length).toBeLessThanOrEqual(100);
  expect(code).toBe(issues[0]!.code);
  for (const issue of issues) for (const field of [issue.code, issue.path, issue.message, issue.fix]) expect(field.length).toBeGreaterThan(0);
}

describe('compose: properties', { timeout: 300_000 }, () => {
  it('returns a composition that keeps every rule, or throws a ComposeError; the same input gives the same text', () => {
    let composed = 0;
    const codes = new Map<string, number>();
    let refused = 0;
    let several = 0;
    fc.assert(fc.property(seed, (s) => {
      const { edit, facts, reversed } = build(s);
      let first: Composition;
      try { first = compose(edit, facts); } catch (error) {
        expectIssues(error);
        const found = (error as ComposeError).issues.map((issue) => issue.code);
        // windows out of order are refused, and nothing else is ever a `window-range` in a document built by the rules
        expect(found.includes('window-range')).toBe(reversed);
        if (reversed) refused++;
        for (const code of found) if (code !== 'window-range') codes.set(code, (codes.get(code) ?? 0) + 1);
        return;
      }
      expect(reversed).toBe(false);
      composed++;
      if (edit.shots.some((shot) => (shot.windows?.length ?? 0) > 1)) several++;
      expectSound(first);
      expectSafe(edit);
      const again = build(s);
      expect(JSON.stringify(compose(again.edit, again.facts))).toBe(JSON.stringify(first));
    }), { numRuns: 400 });
    expect(codes.size).toBeGreaterThan(0);
    // the generator must not be vacuous: most documents compose, and those that do not fail on what was left to chance
    expect(composed).toBeGreaterThan(120);
    expect([...codes.keys()].filter((code) => !['text-too-long', 'caption-word-too-long', 'card-duplicate', 'sound-duplicate', 'time-range', 'animation-too-long', 'blur-too-many', 'outside-safe-area', 'media-size-unknown'].includes(code))).toEqual([]);
    // both sides of the window rule were met: documents with several windows in order composed, reversed ones were refused
    expect(several).toBeGreaterThan(20);
    expect(refused).toBeGreaterThan(5);
  });

  it('never throws anything but a ComposeError, whatever is put in place of a part of a good document', () => {
    fc.assert(fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 6 }), fc.oneof(fc.jsonValue(), fc.double(), fc.integer({ min: -5, max: 4000 }), fc.string()), (route, value) => {
      const edit = richEdit() as unknown as Record<string, unknown>;
      // walk into the document along `route`, then replace what is found there
      let node: Record<string, unknown> | unknown[] = edit;
      for (let depth = 0; depth < route.length; depth++) {
        const keys = Object.keys(node);
        if (keys.length === 0) break;
        const key = keys[route[depth]! % keys.length]!;
        const child = (node as Record<string, unknown>)[key];
        if (depth === route.length - 1 || typeof child !== 'object' || child === null) { (node as Record<string, unknown>)[key] = value; break; }
        node = child as Record<string, unknown>;
      }
      try { expectSound(compose(edit as unknown as Edit, richFacts())); } catch (error) {
        if (!(error instanceof ComposeError)) throw error;
        expectIssues(error);
      }
    }), { numRuns: 600 });
  });

  it('never throws anything but a ComposeError, whatever the facts say', () => {
    const entry = fc.oneof(
      { weight: 6, arbitrary: fc.record({ frames: fc.oneof(fc.integer({ min: -5, max: 500 }), fc.double()), audio: fc.boolean(), width: opt(fc.oneof(fc.integer({ min: -1, max: 2000 }), fc.double())), height: opt(fc.integer({ min: -1, max: 2000 })) }) },
      { weight: 1, arbitrary: fc.constant(null) },
      { weight: 2, arbitrary: fc.jsonValue() },
    );
    const given = fc.oneof({ weight: 8, arbitrary: fc.dictionary(fc.constantFrom('a', 'b', 'c', 'proof', 'serum', 'beat', 'ping'), entry) }, { weight: 1, arbitrary: fc.constantFrom(null, undefined) }, { weight: 1, arbitrary: fc.jsonValue() });
    fc.assert(fc.property(given, (facts) => {
      try { expectSound(compose(richEdit(), facts as never)); } catch (error) { expectIssues(error); }
    }), { numRuns: 300 });
  });
});
