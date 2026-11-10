// The two golden templates, written by hand from the two finished productions (resolve/golden/<id>/{template,fill}.json).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEdit } from '../edit/schema.ts';
import type { Box, Edit } from '../edit/types.ts';
import { validate } from '../edit/validate.ts';
import { fitText, textWidth } from '../fit/index.ts';
import { Fill, Template } from '../template/schema.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';
import { checkFill, parseScript, resolve } from './index.ts';
import type { ResolveMedia } from './index.ts';
import { placeholderFacts, placeholderMedia } from './placeholder.ts';

const read = (id: string, file: string): unknown => JSON.parse(readFileSync(new URL(`./golden/${id}/${file}.json`, import.meta.url), 'utf8'));
const golden = (id: string): { template: TemplateJson; fill: FillJson; media: ResolveMedia; edit: Edit } => {
  const template = Template.parse(read(id, 'template')), fill = Fill.parse(read(id, 'fill'));
  const media = placeholderMedia(template, fill);
  return { template, fill, media, edit: resolve(template, fill, media) };
};
const GOLDEN = ['layering-01', 'lashly-01'] as const;

/** The default safe area ('both', design §12.16), percent of the canvas: the rectangle, before the column of the buttons is cut out. */
const SAFE: Box = { left: 6, top: 14, right: 94, bottom: 65 };
const inside = (box: Box) => box.left >= SAFE.left && box.top >= SAFE.top && box.right <= SAFE.right && box.bottom <= SAFE.bottom;
/** Every free text of an object, at any depth, under keys that match. */
const textsUnder = (value: unknown, key: RegExp, under = false): string[] => {
  if (typeof value === 'string') return under ? [value] : [];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([name, inner]) => textsUnder(inner, key, under || key.test(name)));
};

describe.each(GOLDEN)('golden %s', (id) => {
  it('passes the schemas as it is written, and the fill is complete for the template', () => {
    expect(Template.safeParse(read(id, 'template')).error?.issues ?? []).toEqual([]);
    expect(Fill.safeParse(read(id, 'fill')).error?.issues ?? []).toEqual([]);
    const { template, fill } = golden(id);
    expect(template).toEqual(read(id, 'template'));
    expect(checkFill(template, fill)).toEqual({ errors: [], notes: [] });
  });
  it('resolves to a document whose shots tile the timeline', () => {
    const { edit } = golden(id);
    let end = 0;
    for (const shot of edit.shots) { expect(shot.at).toBe(end); end += shot.for; }
    expect(edit.frames).toBe(end);
    expect(edit.canvas).toEqual({ width: 720, height: 1280, fps: 30 });
    expect(edit.language).toBe('en');
    expect(edit.version).toBe(1);
  });
  it('is a document the editor accepts: its schema, and every rule of the editor that needs no text fitting', () => {
    const { edit, media, template } = golden(id);
    const parsed = parseEdit(JSON.parse(JSON.stringify(edit)));
    expect(parsed.ok ? [] : parsed.issues).toEqual([]);
    expect(validate(edit, placeholderFacts(edit, media))).toEqual([]);
  });
  it('every text carries the copy of the fill, and every element names media that the document lists', () => {
    const { edit, fill } = golden(id);
    expect(Object.fromEntries(edit.texts!.map((text) => [text.id, text.copy]))).toEqual(fill.texts);
    const used = [...edit.shots.map((shot) => shot.media), ...edit.shots.flatMap((shot) => (shot.windows ?? []).flatMap((window) => [window.behind, ...(window.swaps ?? []).map((swap) => swap.behind)])), ...(edit.cards ?? []).map((card) => card.media), ...(edit.audio?.music ? [edit.audio.music.media] : [])];
    expect(new Set(used)).toEqual(new Set(Object.keys(edit.media)));
    for (const { file } of Object.values(edit.media)) expect(file).toMatch(/^assets\/[A-Za-z0-9._-]+$/);
  });
  it('carries nothing of the reference’s own text, of a prompt, or of what the site shows', () => {
    const { edit, template, fill } = golden(id);
    const document = JSON.stringify(edit);
    const kept = [
      template.title, template.description, template.source.url, template.audio.music.prompt,
      ...template.shots.flatMap((shot) => [shot.action, shot.motion_prompt, shot.still_prompt ?? '']),
      ...template.texts.flatMap((text) => [text.source_copy, /\{/.test(text.copy) ? text.copy : '']),
      ...(template.script?.segments ?? []).map((segment) => segment.lines),
      template.presenter?.still_prompt ?? '', template.presenter?.voice.sample_text ?? '', template.presenter?.voice.voice_id ?? '',
      ...(template.stills ?? []).map((still) => still.prompt),
      ...textsUnder(fill, /prompt|^name$|^images$/),
    ].filter((text) => text !== '');
    expect(kept.length).toBeGreaterThan(12);
    for (const text of kept) expect(document.includes(JSON.stringify(text).slice(1, -1)), text).toBe(false);
  });
  it('stays inside the safe area of both platforms: every text, card and the captions', () => {
    const { edit } = golden(id);
    expect(edit.safe).toBeUndefined();
    for (const text of edit.texts!) expect(inside(text.box), text.id).toBe(true);
    for (const card of edit.cards ?? []) expect(inside(card.box), card.id).toBe(true);
    if (edit.captions) expect(inside(edit.captions.box)).toBe(true);
  });
  it('every copy fits its box at the size of its style, on the lines it may take', () => {
    const { edit } = golden(id);
    const { width, height } = edit.canvas;
    for (const text of edit.texts!) {
      const style = edit.styles![text.style]!;
      const pad = { x: Math.ceil((style.plate?.padX ?? 0) * style.size), y: Math.ceil((style.plate?.padY ?? 0) * style.size) };   // a plate takes room around its line
      const room = { width: Math.round((text.box.right - text.box.left) * width / 100) - 2 * pad.x, height: Math.round((text.box.bottom - text.box.top) * height / 100) - 2 * pad.y };
      const lines = text.lines ?? (text.copy.includes('\n') ? text.copy.split('\n').length : 2);
      const fitted = fitText(style.upper ? text.copy.toLocaleUpperCase(edit.language) : text.copy, style, room, { lines, shrink: 0.6 });
      expect(fitted, text.id).toMatchObject({ ok: true, size: style.size });
    }
  });
});

describe('golden layering-01 (beats)', () => {
  const { edit, template } = golden('layering-01');

  it('5 shots at frames 0, 39, 87, 125, 170 for 39, 48, 38, 45, 70: 240 frames', () => {
    expect(edit.shots.map((shot) => [shot.at, shot.for])).toEqual([[0, 39], [39, 48], [87, 38], [125, 45], [170, 70]]);
    expect(edit.frames).toBe(240);
    expect(edit.shots.map((shot) => shot.media)).toEqual(['clip-s1', 'clip-s2', 'clip-s3', 'clip-s4', 'clip-s5']);
  });
  it('6 text lines in 5 texts, each on the frames of its shot; 2 styles; music at gain 0.9', () => {
    expect(edit.texts!.map((text) => [text.id, text.at, text.for])).toEqual([['hook', 0, 39], ['name-1', 39, 48], ['name-2', 87, 38], ['name-3', 125, 45], ['name-4', 170, 70]]);
    expect(edit.texts!.flatMap((text) => text.copy.split('\n'))).toEqual([
      'the best compliment-magnet', 'scent layering combo', 'acme aurora body oil', 'acme aurora body mist', 'acme aurora hair mist', 'acme solace perfume',
    ]);
    expect(Object.keys(edit.styles!)).toEqual(['opener', 'nametag']);
    expect(new Set(edit.texts!.map((text) => text.style))).toEqual(new Set(['opener', 'nametag']));
    expect(edit.audio).toEqual({ music: { media: 'music', gain: 0.9 } });
    expect(edit.captions).toBeUndefined();
    expect(edit.cards).toBeUndefined();
  });
  it('shows what the editor can do, with the cuts on their frames: two transitions, motion on two shots, an enter on the hook', () => {
    expect(edit.shots.map((shot) => shot.in?.kind ?? 'cut')).toEqual(['cut', 'zoom', 'cut', 'cut', 'crossfade']);
    expect(edit.shots.map((shot) => shot.motion?.kind ?? null)).toEqual(['push-in', null, null, null, 'push-in']);
    expect(edit.texts![0]).toMatchObject({ lines: 2, enter: { kind: 'pop' }, exit: { kind: 'fade' } });
    for (const text of edit.texts!) expect(text.enter, text.id).toBeDefined();
  });
  it('every clip is long enough for its shot and the transition after it, and no shot shows sound', () => {
    edit.shots.forEach((shot, i) => {
      const next = edit.shots[i + 1]?.in;
      const tail = next?.kind === 'crossfade' ? next.frames ?? 8 : 0;
      expect(shot.for + tail).toBeLessThanOrEqual(template.shots[i]!.clip_seconds! * 30);
      expect(shot.sound).toBeUndefined();
    });
  });
});

describe('golden lashly-01 (speech)', () => {
  const { edit, template, fill } = golden('lashly-01');
  const script = template.script!.segments.flatMap((segment) => parseScript(fill.script![segment.id]!).words);

  it('3 segments follow each other without a gap, each as long as its clip and with its own sound', () => {
    expect(edit.shots.map((shot) => [shot.id, shot.at, shot.for, shot.sound])).toEqual([['s1', 0, 360, { gain: 1 }], ['s2', 360, 270, { gain: 1 }], ['s3', 630, 270, { gain: 1 }]]);
    expect(edit.frames).toBe(900);
  });
  it('every script word is in the captions exactly once, in order; words do not overlap and stay inside their segment', () => {
    const words = edit.captions!.words;
    expect(script).toHaveLength(88);
    expect(words.map((word) => word.text)).toEqual(script);
    let free = 0;
    for (const word of words) {
      expect(word.at, word.text).toBeGreaterThanOrEqual(free);
      expect(word.for).toBeGreaterThanOrEqual(1);
      free = word.at + word.for;
    }
    expect(free).toBeLessThanOrEqual(900);
    const perSegment = [38, 22, 28];
    let index = 0;
    edit.shots.forEach((shot, i) => {
      for (const word of words.slice(index, index + perSegment[i]!)) {
        expect(word.at).toBeGreaterThanOrEqual(shot.at);
        expect(word.at + word.for).toBeLessThanOrEqual(shot.at + shot.for);
      }
      index += perSegment[i]!;
    });
  });
  it('every mark resolved to a frame range: 5 texts and 4 product cards, each beginning on the first word of its mark', () => {
    const words = edit.captions!.words;
    const firstFrame = (word: string, nth = 0) => words.filter((w) => w.text === word)[nth]!.at;
    const at = Object.fromEntries([...edit.texts!, ...edit.cards!].map((element) => [element.id, element.at]));
    expect(at).toEqual({
      hook: firstFrame('I'), 'tag-before': firstFrame('So'), 'tag-after': firstFrame('And'), 'tag-inside': firstFrame('Aloe,'), 'tag-brand': firstFrame('If'),
      'card-name': firstFrame('Lashly'), 'card-inside': firstFrame('Aloe,'), 'card-routine': firstFrame('swipe'), 'card-close': firstFrame('If'),
    });
    for (const element of [...edit.texts!, ...edit.cards!]) {
      expect(element.for, element.id).toBeGreaterThanOrEqual(20);
      expect(element.at + element.for, element.id).toBeLessThanOrEqual(900);
    }
    expect(edit.cards!.map((card) => card.media)).toEqual(['product-1', 'product-1-2', 'product-1-3', 'product-1']);
  });
  it('the presenter goes into one window for the before and the after: the picture behind changes on the first word of the after', () => {
    const words = edit.captions!.words;
    const so = words.find((word) => word.text === 'So')!.at, and = words.find((word) => word.text === 'And')!.at;
    expect(edit.shots[0]!.windows).toEqual([{
      at: so, for: 360 - so, corner: 'top-right', width: 30, behind: 'still-proof-before', behindMotion: { kind: 'push-in', to: 1.06 },
      swaps: [{ at: and, behind: 'still-proof-after' }],
    }]);
    expect(and - so).toBeGreaterThan(10);                                             // the change falls after the shrink …
    expect(360 - and).toBeGreaterThan(10);                                            // … and before the return
    expect(edit.media['still-proof-before']).toEqual({ file: 'assets/still-proof-before.png', kind: 'image' });
    expect(edit.media['still-proof-after']).toEqual({ file: 'assets/still-proof-after.png', kind: 'image' });
    expect(edit.shots[1]!.windows).toBeUndefined();
    expect(edit.shots.map((shot) => shot.in?.kind ?? 'cut')).toEqual(['cut', 'cut', 'zoom']);
  });
  it('the hook is written in our own words: no copy repeats the text of the reference video', () => {
    const squeezed = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');
    for (const text of template.texts) if (text.source_copy !== '') expect(squeezed(fill.texts[text.id]!), text.id).not.toBe(squeezed(text.source_copy));
    expect(fill.texts.hook).toBe('My 4-week lash serum test');
  });
  it('captions in the template’s style with a pill on the spoken word; music low under the voice with a fade-out', () => {
    expect(edit.captions).toMatchObject({ box: { left: 14, top: 51, right: 86, bottom: 64 }, style: 'spoken', group: { words: 4, lines: 2 }, active: { kind: 'pill', colour: '#B76E79' } });
    expect(edit.audio).toEqual({ music: { media: 'music', gain: 0.1, fadeOut: 21, duck: { to: 0.1, under: 'sound' } } });
  });
  it('no caption word is wider than the caption box', () => {
    const style = edit.styles!.spoken!;
    const boxWidth = Math.round((edit.captions!.box.right - edit.captions!.box.left) * edit.canvas.width / 100);
    for (const word of edit.captions!.words) expect(textWidth(word.text, style, style.size), word.text).toBeLessThanOrEqual(boxWidth);
  });
  it('a customer with one photograph gets the two cards that show it, and the same document otherwise', () => {
    const onePhoto: FillJson = { ...fill, products: [{ ...fill.products[0]!, images: [fill.products[0]!.images[0]!] }] };
    const lean = resolve(template, onePhoto, placeholderMedia(template, onePhoto));
    expect(lean.cards!.map((card) => card.id)).toEqual(['card-name', 'card-close']);
    expect(checkFill(template, onePhoto)).toMatchObject({ errors: [], notes: [{ code: 'left-out', element: 'card-inside', picture: 'product:1.2' }, { code: 'left-out', element: 'card-routine', picture: 'product:1.3' }] });
    expect({ ...lean, cards: [], media: {} }).toEqual({ ...edit, cards: [], media: {} });
  });
});
