import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buttonColumn, maxWindowWidth, safeArea, stylesOf } from '../edit/presets.ts';
import { parseEdit } from '../edit/schema.ts';
import type { Timeline } from '../edit/timeline.ts';
import type { ComposeFacts, Edit, EditIssue } from '../edit/types.ts';
import { validate } from '../edit/validate.ts';
import type { Build } from './build.ts';
import { checkFrames } from './check.ts';
import { MOTION_CSS } from './css.ts';
import { resolve } from '../resolve/index.ts';
import { placeholderFacts, placeholderMedia } from '../resolve/placeholder.ts';
import { Fill, Template } from '../template/schema.ts';
import { limitEdit, limitFacts, richEdit, richFacts, shortEdit, shortFacts } from './fixture.ts';
import { ComposeError, compose, seconds } from './index.ts';
import type { Composition } from './index.ts';
import { containRect, rectOf, windowRect } from './layout.ts';
import { shotsHtml } from './shots.ts';
import { animationsOf, cssOf, tagsOf, valueAt, windowsOf } from './testing.ts';
import { glyphIssue } from './texts.ts';
import { PER_TRACK, createTracks, tracksAfterShots } from './tracks.ts';

const FPS = 30;
/** What compose throws for the short document after `change`. */
function errorOf(change: (edit: Edit, facts: Record<string, ComposeFacts>) => void, base: () => Edit = shortEdit): ComposeError {
  const edit = base();
  const facts = base === shortEdit ? shortFacts() : richFacts();
  change(edit, facts);
  try { compose(edit, facts); } catch (error) {
    expect(error).toBeInstanceOf(ComposeError);
    return error as ComposeError;
  }
  throw new Error('compose did not throw');
}
function only(change: (edit: Edit, facts: Record<string, ComposeFacts>) => void): EditIssue {
  const error = errorOf(change);
  expect(error.issues.map((i) => `${i.code} @ ${i.path}`)).toHaveLength(1);
  expect(error.code).toBe(error.issues[0]!.code);
  expect(error.issues[0]!.fix.length).toBeGreaterThan(10);
  return error.issues[0]!;
}
/** Everything of a composition that is markup or CSS: the stylesheet, the tag names, the attribute names and values. Not the text between the tags. */
function markupOf(html: string): string {
  return [cssOf(html), ...tagsOf(html).flatMap((tag) => [tag.name, ...Object.entries(tag.attrs).flat()])].join('\n');
}
const documents: [string, () => Composition][] = [
  ['the short document, 1080', () => compose(shortEdit(), shortFacts())],
  ['the short document, 720', () => compose(shortEdit(720), shortFacts())],
  ['the document with everything', () => compose(richEdit(), richFacts())],
];

describe('compose: the rules are in the output', () => {
  it.each(documents)('%s: no script, no outside URL in the markup or the CSS, nothing that broke a render in the spike', (_, make) => {
    const { html } = make();
    for (const banned of ['<script', 'will-change', '-webkit-text-stroke', 'text-transform', '@import', 'box-shadow']) expect(html).not.toContain(banned);
    for (const banned of ['http', '://']) expect(markupOf(html)).not.toContain(banned);
    expect(html).not.toMatch(/[\s;"{]border\s*:/);                                   // §12.4: nothing draws on a <video>
    expect([...html.matchAll(/url\(/g)].length).toBe([...html.matchAll(/url\("assets\/fonts\/[a-z-]+\.woff2"\)/g)].length);
  });

  it.each(documents)('%s: no keyframe names opacity, scale, translate, transform or filter (R3)', (_, make) => {
    const blocks = [...cssOf(make().html).matchAll(/@keyframes\s+([a-z-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)];
    expect(blocks.length).toBe(15);
    for (const [, name, body] of blocks) {
      expect(`${name}: ${body}`).not.toMatch(/(?:^|[\s{;])(?:opacity|scale|translate|transform|filter|border-radius)\s*:/);
    }
  });

  it.each(documents)('%s: every left, top, width, height, font-size and line-height is whole pixels (R5)', (_, make) => {
    const { html } = make();
    const values = [...html.matchAll(/(?:^|[\s;{"])(left|top|width|height|font-size|line-height)\s*:\s*([^;}"]+)/g)].map((m) => m[2]!.trim());
    expect(values.length).toBeGreaterThan(20);
    for (const value of values) expect(value).toMatch(/^(?:\d+px|0|100%)$/);
  });

  it.each(documents)('%s: the root is a composition without a timeline, and its length is frames / fps', (_, make) => {
    const { html, timeline } = make();
    const root = tagsOf(html).find((tag) => tag.attrs.id === 'root')!;
    expect(root.attrs).toMatchObject({ 'data-composition-id': 'main', 'data-start': '0', 'data-fps': '30', 'data-duration': seconds(timeline.frames, FPS), 'data-width': String(timeline.width), 'data-height': String(timeline.height) });
    expect('data-no-timeline' in root.attrs).toBe(true);
  });

  it.each(documents)('%s: every animation edge lies half a frame before a frame (R2), and enter and exit fill as R4 says', (_, make) => {
    const tags = tagsOf(make().html);
    const animations = tags.flatMap((tag) => animationsOf(tag.attrs.style));
    expect(animations.length).toBeGreaterThan(10);
    for (const animation of animations) {
      expect(Math.abs((animation.delay * FPS + 0.5) - Math.round(animation.delay * FPS + 0.5))).toBeLessThan(1e-9);
      expect(Math.abs(animation.duration * FPS - Math.round(animation.duration * FPS))).toBeLessThan(1e-9);
      expect(animation.duration).toBeGreaterThan(0);
      if (/-in$/.test(animation.name)) expect(animation.fill).toBe(animation.name === 've-window-in' ? 'forwards' : 'backwards');
      if (/-out$/.test(animation.name)) expect(animation.fill).toBe('forwards');
      if (animation.name === 've-scale' || animation.name === 've-flash') expect(animation.fill).toBe('both');
    }
  });

  it.each(documents)('%s: no timed element has a timed ancestor (R6), every timed element is a clip with an id', (_, make) => {
    const timed = tagsOf(make().html).filter((tag) => 'data-start' in tag.attrs && tag.attrs.id !== 'root');
    expect(timed.length).toBeGreaterThan(5);
    for (const tag of timed) {
      expect(tag.ancestors.filter((a) => 'data-start' in a.attrs).map((a) => a.attrs.id)).toEqual(['root']);
      expect(tag.attrs.id).toMatch(/^[a-z][a-z0-9-]*$/);
      if (tag.name !== 'audio') expect(tag.attrs.class!.split(' ')).toContain('clip');
      expect(tag.attrs['data-duration']).toBeDefined();
    }
  });

  it.each(documents)('%s: a track index carries at most three timed elements, and never two at the same time', (_, make) => {
    const byTrack = new Map<string, { at: number; end: number }[]>();
    for (const tag of tagsOf(make().html)) {
      if (!('data-track-index' in tag.attrs)) continue;
      const at = Number(tag.attrs['data-start']) * FPS;
      const spans = byTrack.get(tag.attrs['data-track-index']!) ?? [];
      for (const other of spans) expect(at >= other.end - 1e-6 || at + Number(tag.attrs['data-duration']) * FPS <= other.at + 1e-6).toBe(true);
      spans.push({ at, end: at + Number(tag.attrs['data-duration']) * FPS });
      byTrack.set(tag.attrs['data-track-index']!, spans);
    }
    for (const spans of byTrack.values()) expect(spans.length).toBeLessThanOrEqual(PER_TRACK);
  });

  it.each(documents)('%s: media that is scaled may overflow its box (R11), a video is muted and closed properly', (_, make) => {
    const { html } = make();
    for (const tag of tagsOf(html)) {
      if (tag.name !== 'video' && tag.name !== 'img') continue;
      // scaled by a motion of its own, or by the motion of the wrapper it is in (a picture behind a window, a card's box is not scaled)
      const scaled = [tag, tag.ancestors.at(-1)!].some((t) => animationsOf(t.attrs.style).some((a) => a.name === 've-scale'));
      expect('data-layout-allow-overflow' in tag.attrs).toBe(scaled);
      if (tag.name === 'video') { expect('muted' in tag.attrs).toBe(true); expect('playsinline' in tag.attrs).toBe(true); }
    }
    expect(html).not.toMatch(/<(?:audio|video)\b[^>]*\/>/);
  });

  it.each(documents)('%s: carries the motion stylesheet of the spike, byte for byte (§5.2)', (_, make) => {
    // sha256 of VE_CSS in spike/viraleditor-motion/lib/vecss.mjs (the folder is not in the repository)
    expect(createHash('sha256').update(MOTION_CSS).digest('hex')).toBe('ae2671dabdaed99fa8c74ee91d8602c5a1a15226642bee6757b48774604a4533');
    expect(cssOf(make().html)).toContain(MOTION_CSS);
    expect(cssOf(make().html).match(/@property/g)).toHaveLength(9);
  });

  it('lets a copy name an address: "no http" is a rule about markup and CSS, and a copy is escaped text', () => {
    const edit = shortEdit();
    edit.texts![0]!.copy = 'see http://example.com/a?b=1&c=2';
    edit.captions!.words[3]!.text = 'http://a.co';
    const { html } = compose(edit, shortFacts());
    expect(html).toContain('http://example.com/a?b=1&amp;c=2');
    expect(html).toContain('HTTP://A.CO');
    for (const banned of ['http', 'HTTP', '://']) expect(markupOf(html)).not.toContain(banned);
    expect(markupOf(html)).toContain('assets/a.mp4');                                  // the markup is in what was searched
  });

  it('writes the same text for the same input, and leaves its input alone', () => {
    const edit = richEdit();
    const before = JSON.stringify(edit);
    const first = compose(edit, richFacts());
    expect(JSON.stringify(edit)).toBe(before);
    expect(JSON.stringify(compose(richEdit(), richFacts()))).toBe(JSON.stringify(first));
  });
});

describe('compose: what the design writes, word for word (§5)', () => {
  const { html, fonts, files } = compose(shortEdit(), shortFacts());
  const tags = tagsOf(html);
  const tag = (id: string) => tags.find((t) => t.attrs.id === id)!;

  it('puts a shot in an untimed wrapper, the transition on the wrapper and the motion on the video (§5.3)', () => {
    expect(html).toContain('<div id="s2" class="ve-shot ve-m ve-mb" style="z-index:2;--ve-out-x:-100%;--ve-out-y:0px;--ve-out-b:36px;'
      + `animation:ve-fade-in ${seconds(8, FPS)}s linear ${seconds(59.5, FPS)}s backwards, ve-move-out ${seconds(8, FPS)}s cubic-bezier(0.8,0,0.2,1) ${seconds(119.5, FPS)}s forwards, ve-blur-out ${seconds(8, FPS)}s cubic-bezier(0.8,0,0.2,1) ${seconds(119.5, FPS)}s forwards">`);
    expect(html).toContain(`<video id="s2-v" class="clip ve-m" data-layout-allow-overflow src="assets/b.mp4" data-start="2" data-duration="${seconds(68, FPS)}" data-media-start="${seconds(20, FPS)}" data-track-index="1" muted playsinline `
      + `style="--ve-s0:1;--ve-s1:1.2;transform-origin:50% 50%;animation:ve-scale ${seconds(4, FPS)}s cubic-bezier(0.16,1,0.3,1) ${seconds(29.5, FPS)}s both"></video>`);
    expect(tag('s1-v').attrs.style).toBe(`--ve-s0:1;--ve-s1:1.08;transform-origin:50% 50%;animation:ve-scale ${seconds(68, FPS)}s linear ${seconds(-0.5, FPS)}s both`);
    expect(tag('s3').attrs.style).toBe(`z-index:3;--ve-in-x:100%;--ve-in-y:0px;--ve-in-b:36px;animation:ve-move-in ${seconds(8, FPS)}s cubic-bezier(0.8,0,0.2,1) ${seconds(119.5, FPS)}s backwards, ve-blur-in ${seconds(8, FPS)}s cubic-bezier(0.8,0,0.2,1) ${seconds(119.5, FPS)}s backwards`);
    expect(tag('s3-v').attrs.style).toContain('--ve-s0:1.08;--ve-s1:1;');
    expect(['s1-v', 's2-v', 's3-v'].map((id) => tag(id).attrs['data-track-index'])).toEqual(['0', '1', '0']);
  });

  it('fits the hook and writes one timed leaf per line, the second one staggered (§5.4)', () => {
    expect(tag('hook-1').text).toBe('My lashes grew');
    expect(tag('hook-2').text).toBe('visibly in three weeks');
    expect(tag('hook-1').attrs.class).toBe('clip ve-line ve-m ve-al-center st-hook-72');
    expect(tag('hook-1').attrs.style).toBe('left:97px;top:320px;width:886px;height:83px;--ve-in-s:0.6;'
      + `animation:ve-scale-in ${seconds(8, FPS)}s cubic-bezier(0.34,1.56,0.64,1) ${seconds(-0.5, FPS)}s backwards, ve-fade-in ${seconds(4, FPS)}s linear ${seconds(-0.5, FPS)}s backwards, ve-fade-out ${seconds(6, FPS)}s linear ${seconds(47.5, FPS)}s forwards`);
    expect(tag('hook-2').attrs.style).toContain(`top:403px;`);
    expect(tag('hook-2').attrs.style).toContain(`ve-scale-in ${seconds(8, FPS)}s cubic-bezier(0.34,1.56,0.64,1) ${seconds(1.5, FPS)}s backwards`);
    expect(cssOf(html)).toMatch(/\.st-hook-72 \{ font-family: "Inter", sans-serif; font-weight: 800; font-size: 72px; line-height: 83px; color: #ffffff; text-shadow: 5\.76px 0\.00px 0 #000000, .*, 0px 4px 14px #00000080; \}/);
  });

  it('draws the outline as a ring of hard shadows (R7): n = clamp(⌈2πr / 1.5⌉, 8, 32) copies', () => {
    const shadow = /\.st-hook-72 \{[^}]*text-shadow: ([^;]+);/.exec(cssOf(html))![1]!.split(', ');
    expect(shadow).toHaveLength(Math.ceil((2 * Math.PI * 0.08 * 72) / 1.5) + 1);
    expect(shadow.slice(0, -1).every((layer) => /^-?\d+\.\d\dpx -?\d+\.\d\dpx 0 #000000$/.test(layer))).toBe(true);
  });

  it('groups the caption words, one timed element per group, the active word by animations on the spans (§5.5)', () => {
    expect(tag('cap-1').attrs.style).toBe('left:97px;top:1006px;width:832px;height:216px;'
      + `animation:ve-scale-in ${seconds(5, FPS)}s cubic-bezier(0.16,1,0.3,1) ${seconds(-0.5, FPS)}s backwards, ve-fade-in ${seconds(5, FPS)}s cubic-bezier(0.16,1,0.3,1) ${seconds(-0.5, FPS)}s backwards`);
    expect(tag('cap-1-w2').attrs.style).toBe(`animation:ve-word-colour ${seconds(14, FPS)}s step-end ${seconds(11.5, FPS)}s 1 normal none, ve-word-pop ${seconds(14, FPS)}s linear ${seconds(11.5, FPS)}s 1 normal none`);
    expect(tag('cap-1-w2').text).toBe('LOOKED');
    expect(cssOf(html)).toMatch(/\.st-caption-84 \{ font-family: "Montserrat", sans-serif; font-weight: 900; font-size: 84px; line-height: 108px; color: #ffffff; text-shadow: [^;]+; --ve-in-s: 0\.8; --ve-active: #ffe000; --ve-pop-s: 1\.12; --ve-hold-s: 1\.06; \}/);
  });

  it('gives the lines of a caption group a whole top (R5): the element is as high as its lines, placed in the middle of the box', () => {
    // the box is 231 px high, two lines are 216: centred by the browser they would sit 7.5 px down
    expect(tag('cap-1').attrs.style).toContain('top:1006px;width:832px;height:216px;');
    expect(tag('cap-2').attrs.style).toContain('top:1060px;width:832px;height:108px;');     // one line: 998 + round(123 / 2)
    for (const [, make] of documents) {
      const made = make();
      const lineHeight = Number(/\.st-caption-\d+ \{[^}]*line-height: (\d+)px/.exec(cssOf(made.html))![1]);
      for (const group of made.timeline.captions) {
        const style = tagsOf(made.html).find((t) => t.attrs.id === group.element)!.attrs.style!;
        const [top, height] = [Number(/top:(\d+)px/.exec(style)![1]), Number(/height:(\d+)px/.exec(style)![1])];
        expect(height).toBe(group.lines.length * lineHeight);
        expect(top).toBe(group.rect.y + Math.round((group.rect.height - height) / 2));
      }
    }
  });

  it('pops the card in and out (§5.6); the card has the shape of its picture, as large as its box allows', () => {
    expect(html).toContain(`<img id="product" class="clip ve-card ve-m" src="assets/serum.png" alt="" data-start="${seconds(70, FPS)}" data-duration="${seconds(40, FPS)}" data-track-index="2" `
      + 'style="left:421px;top:691px;width:238px;height:423px;border-radius:36px;--ve-in-s:0.6;--ve-out-s:0.8;'
      + `animation:ve-scale-in ${seconds(8, FPS)}s cubic-bezier(0.34,1.56,0.64,1) ${seconds(-0.5, FPS)}s backwards, ve-fade-in ${seconds(4, FPS)}s linear ${seconds(-0.5, FPS)}s backwards, `
      + `ve-scale-out ${seconds(8, FPS)}s cubic-bezier(0.7,0,0.84,0) ${seconds(31.5, FPS)}s forwards, ve-fade-out ${seconds(8, FPS)}s linear ${seconds(31.5, FPS)}s forwards" />`);
  });

  it('writes the music as a volume lane in seconds local to the element, ducked under the caption words (§5.7)', () => {
    const music = tag('music-1');
    expect(music.attrs).toMatchObject({ src: 'assets/beat.mp3', 'data-start': '0', 'data-duration': '6', 'data-media-start': '0' });
    expect('data-volume' in music.attrs).toBe(false);
    expect(JSON.parse(music.attrs['data-automation']!)).toEqual({ version: 1, lanes: [{ target: 'volume', points: [[0, 0.5], [56, 0.5], [62, 0.2], [116, 0.2], [122, 0.5], [168, 0.5], [180, 0]].map(([f, v]) => ({ t: f! / FPS, v })) }] });
  });

  it('emits two @font-face rules per font used (R9) and lists what the HTML names', () => {
    const faces = [...cssOf(html).matchAll(/@font-face \{ font-family: "(\w+)"; src: url\("([^"]+)"\) format\("woff2"\); font-weight: 100 900; font-style: normal; font-display: block; unicode-range: (U\+[0-9A-F,U+-]+); \}/g)];
    expect(faces.map((f) => f[2])).toEqual(['assets/fonts/inter-latin-wght-normal.woff2', 'assets/fonts/inter-latin-ext-wght-normal.woff2', 'assets/fonts/montserrat-latin-wght-normal.woff2', 'assets/fonts/montserrat-latin-ext-wght-normal.woff2']);
    expect(faces[1]![3]).toContain('U+0100-02BA');
    expect(fonts).toEqual(faces.map((f) => f[2]));
    expect(files).toEqual(['assets/a.mp4', 'assets/b.mp4', 'assets/beat.mp3', 'assets/c.mp4', 'assets/serum.png']);
    expect(compose({ ...shortEdit(), texts: [], captions: undefined }, shortFacts()).fonts).toEqual([]);
  });

  it('scales the presets for the 720 canvas: sizes times 2/3, rounded', () => {
    const small = compose(shortEdit(720), shortFacts());
    expect(cssOf(small.html)).toContain('.st-hook-48 { font-family: "Inter", sans-serif; font-weight: 800; font-size: 48px; line-height: 55px;');
    expect(cssOf(small.html)).toContain('0px 3px 9px #00000080');
    expect(cssOf(small.html)).toContain('.st-caption-56 {');
    expect(tagsOf(small.html).find((t) => t.attrs.id === 's3')!.attrs.style).toContain('--ve-in-b:24px');
  });
});

describe('compose: the document with everything', () => {
  const { html, timeline } = compose(richEdit(), richFacts());
  const tags = tagsOf(html);
  const tag = (id: string) => tags.find((t) => t.attrs.id === id)!;

  it('pushes both wrappers, zooms out and in around the cut, and lays a colour over a flash and a dip (§5.3)', () => {
    expect(tag('s1').attrs.style).toContain(`--ve-out-x:-100%;--ve-out-y:0px;`);
    expect(tag('s1').attrs.style).toContain(`ve-move-out ${seconds(10, FPS)}s cubic-bezier(0.65,0,0.35,1) ${seconds(59.5, FPS)}s forwards`);
    expect(tag('s2').attrs.style).toBe(`z-index:2;--ve-in-x:100%;--ve-in-y:0px;--ve-out-s:1.3;animation:ve-move-in ${seconds(10, FPS)}s cubic-bezier(0.65,0,0.35,1) ${seconds(59.5, FPS)}s backwards, ve-scale-out ${seconds(4, FPS)}s cubic-bezier(0.7,0,0.84,0) ${seconds(95.5, FPS)}s forwards`);
    expect(tag('s3').attrs.style).toBe(`z-index:3;--ve-in-s:1.3;animation:ve-scale-in ${seconds(4, FPS)}s cubic-bezier(0.16,1,0.3,1) ${seconds(99.5, FPS)}s backwards`);
    expect(html).toContain(`<div id="s4-fx" class="clip ve-fx ve-m" data-start="${seconds(137, FPS)}" data-duration="${seconds(6, FPS)}" data-track-index="4" style="z-index:100;background:#ffffff;animation:ve-flash ${seconds(6, FPS)}s linear ${seconds(-0.5, FPS)}s both"></div>`);
    expect(tag('s5-fx').attrs).toMatchObject({ 'data-start': seconds(175, FPS), 'data-duration': seconds(11, FPS) });
    expect(tag('s6').attrs.style).toContain('--ve-in-x:0px;--ve-in-y:100%;');
    expect(tag('s5').attrs.style).toContain('--ve-out-x:0px;--ve-out-y:-100%;');
  });

  it('shows an image shot as an <img>, keeps a focus as object-position and as the origin of the motion', () => {
    expect(tag('s5-v').name).toBe('img');
    expect('data-media-start' in tag('s5-v').attrs).toBe(false);
    expect(tag('s5-v').attrs['data-duration']).toBe(seconds(48, FPS));
    expect(tag('s6-v').attrs.style).toBe(`object-position:30% 40%;--ve-s0:1;--ve-s1:1.2;transform-origin:30% 40%;animation:ve-scale ${seconds(4, FPS)}s cubic-bezier(0.16,1,0.3,1) ${seconds(19.5, FPS)}s both`);
  });

  it('shrinks a shot into a window over the picture behind it, which sits directly before it (§5.3)', () => {
    const order = tags.filter((t) => t.ancestors.length === 3 && t.ancestors[2]!.attrs.id === 'root').map((t) => t.attrs.id);
    expect(order.slice(0, 2)).toEqual(['s1-b1', 's1']);
    expect(tag('s1').attrs.class).toBe('ve-shot ve-m ve-win');
    expect(tag('s1').attrs.style).toContain(`--ve-win-x:515px;--ve-win-y:512px;--ve-win-s:${414 / 1080};--ve-win-r:${28 / (414 / 1080)}px;`);
    expect(tag('s1').attrs.style).toContain(`ve-window-in ${seconds(10, FPS)}s cubic-bezier(0.65,0,0.35,1) ${seconds(9.5, FPS)}s forwards, ve-window-out ${seconds(10, FPS)}s cubic-bezier(0.65,0,0.35,1) ${seconds(39.5, FPS)}s forwards`);
    expect((414 * 1920) / 1080).toBe(736);
    expect(timeline.windows).toMatchObject([{ shot: 's1', behind: 'proof', at: 10, for: 40, frames: 10, rect: { x: 515, y: 512, width: 414, height: 736 }, radius: 28 }]);
  });

  it('writes the windows of a shot in the order of their frames, whatever order they are given in', () => {
    // validate refuses such a document; the emitter must not depend on it: in a list of animations the later one wins
    const edit = richEdit();
    const base = { corner: 'bottom-right' as const, behind: 'proof' };
    edit.shots[0]!.windows = [{ ...base, at: 32, for: 22 }, { ...base, at: 2, for: 22 }];
    const table = { windows: [], animations: [], shots: [], transitions: [] } as unknown as Timeline;
    const b: Build = { edit, facts: richFacts(), styles: stylesOf(edit), fps: FPS, canvas: edit.canvas, tracks: createTracks(tracksAfterShots(edit.shots.length)), timeline: table, files: new Set() };
    const wrapper = tagsOf(shotsHtml(b, 100).join('\n')).find((t) => t.attrs.id === 's1')!;
    expect(table.windows.map((w) => [w.at, w.pictures[0]!.element])).toEqual([[2, 's1-b1-v'], [32, 's1-b2-v']]);
    expect(table.animations.filter((a) => a.element === 's1' && a.property === 'window').map((a) => [a.at, a.to])).toEqual([[2, 1], [14, 0], [32, 1], [44, 0]]);
    const delays = animationsOf(wrapper.attrs.style).filter((a) => a.name.startsWith('ve-window')).map((a) => Math.round(a.delay * FPS + 0.5));
    expect(delays).toEqual([2, 14, 32, 44]);
  });

  it('rests a window at the same place on both canvases, and never in the column of the buttons (§12.16)', () => {
    const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
    for (const safe of [undefined, 'tiktok', 'reels', 'none'] as const) {
      for (const corner of corners) {
        for (let width = 20; width <= 60; width += 0.5) {
          const [small, large] = ([720, 1080] as const).map((canvas) => {
            const edit = { ...shortEdit(canvas), safe };
            const rect = windowRect({ at: 0, for: 30, corner, width, behind: 'serum' }, edit);
            const column = buttonColumn(edit) && rectOf(buttonColumn(edit)!, edit.canvas);
            // not one pixel of the window lies in the column
            if (column) expect(rect.x + rect.width <= column.x || rect.y + rect.height <= column.y || rect.y >= column.y + column.height, `${canvas} ${safe} ${corner} ${width}`).toBe(true);
            const percent = (pixels: number, of: number) => (pixels / of) * 100;
            return { left: percent(rect.x, canvas), right: percent(rect.x + rect.width, canvas), top: percent(rect.y, edit.canvas.height), bottom: percent(rect.y + rect.height, edit.canvas.height) };
          });
          // the edge that rests against the safe area is the same percent on both (to the pixel: a pixel of 720 is 0.14 %)
          const [across, down] = corner.split('-').reverse() as ['left' | 'right', 'top' | 'bottom'];
          expect(Math.abs(small![across] - large![across]), `${safe} ${corner} ${width}: ${small![across]} and ${large![across]}`).toBeLessThan(0.15);
          expect(Math.abs(small![down] - large![down]), `${safe} ${corner} ${width}`).toBeLessThan(0.15);
        }
      }
    }
    // the switch from the right edge of the rectangle (94) to the column (86), for a window at the top right of 'both' (top 14, column from 45):
    const right = (width: number, canvas: 720 | 1080) => { const rect = windowRect({ at: 0, for: 30, corner: 'top-right', width, behind: 'serum' }, shortEdit(canvas)); return Math.round(((rect.x + rect.width) / canvas) * 100); };
    expect([20, 30, 30.5, 31, 38, 60].map((width) => [right(width, 720), right(width, 1080)])).toEqual([[94, 94], [94, 94], [86, 86], [86, 86], [86, 86], [86, 86]]);
  });

  it('keeps every window the validation lets through inside the safe area, on both canvases (I1)', () => {
    for (const safe of [undefined, 'tiktok', 'reels', 'none'] as const) {
      for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
        for (const canvas of [720, 1080] as const) {
          const edit = { ...shortEdit(canvas), safe };
          const area = rectOf(safeArea(edit), edit.canvas);
          const widest = maxWindowWidth(edit);
          expect(widest, `${safe}`).toBeGreaterThanOrEqual(20);
          for (let width = 20; width <= widest; width += 0.5) {
            const rect = windowRect({ at: 0, for: 30, corner, width, behind: 'serum' }, edit);
            const inside = rect.x >= area.x && rect.y >= area.y && rect.x + rect.width <= area.x + area.width && rect.y + rect.height <= area.y + area.height;
            expect(inside, `${canvas} ${safe} ${corner} ${width}: ${JSON.stringify(rect)} in ${JSON.stringify(area)}`).toBe(true);
          }
        }
      }
    }
    // the rule is not a loose one: the widest window of 'both' is 50 % and one a few percent wider does leave the area
    expect([undefined, 'tiktok', 'reels', 'none'].map((safe) => maxWindowWidth({ ...shortEdit(), safe } as Edit))).toEqual([50, 60, 50, 60]);
    const edit = shortEdit(1080);
    const tooWide = windowRect({ at: 0, for: 30, corner: 'bottom-left', width: 60, behind: 'serum' }, edit);
    expect(tooWide.y).toBeLessThan(rectOf(safeArea(edit), edit.canvas).y);
  });

  it('writes the padding and the radius of a plate in whole pixels (R5), as many as the fit reserved', () => {
    const css = cssOf(html);
    // the "tag" style at 40 px (on its own size when the text fits): 0.22 em = 8.8 px → 9 px, 0.5 em = 20 px, 0.3 em = 12 px
    expect(css).toContain('.st-tag-40 .ve-plate { background: #e0508c; border-radius: 12px; padding: 9px 20px; }');
    expect(css).not.toMatch(/\.ve-plate \{[^}]*\dem/);
  });

  it('pins the window of the golden template lashly-01 (top right, width 30): it ends above the column and rests at 94 %, on both canvases', () => {
    const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`../resolve/golden/lashly-01/${file}.json`, import.meta.url), 'utf8'));
    const template = Template.parse(read('template'));
    const fill = Fill.parse(read('fill'));
    const media = placeholderMedia(template, fill);
    const edit = resolve(template, fill, media);
    expect(edit.shots.flatMap((shot) => shot.windows ?? []).map((window) => [window.corner, window.width])).toEqual([['top-right', 30]]);
    expect(edit.canvas.width).toBe(720);
    expect(compose(edit, placeholderFacts(edit, media)).timeline.windows.map((window) => window.rect)).toEqual([{ x: 461, y: 179, width: 216, height: 384 }]);
    const large = { ...edit, canvas: { width: 1080 as const, height: 1920 as const, fps: 30 as const } };
    expect(compose(large, placeholderFacts(edit, media)).timeline.windows.map((window) => window.rect)).toEqual([{ x: 691, y: 269, width: 324, height: 576 }]);
    expect([(461 + 216) / 720, (691 + 324) / 1080].map((share) => Math.round(share * 100))).toEqual([94, 94]);
  });

  it('changes the picture behind a window on the frame of a swap, and zooms across the swap on the wrapper', () => {
    expect(html).toContain([
      `      <div id="s1-b1" class="ve-shot ve-m" style="z-index:1;--ve-s0:1;--ve-s1:1.1;animation:ve-scale ${seconds(40, FPS)}s linear ${seconds(9.5, FPS)}s both">`,
      `        <img id="s1-b1-v" class="clip" data-layout-allow-overflow src="assets/proof.png" alt="" data-start="${seconds(10, FPS)}" data-duration="${seconds(20, FPS)}" data-track-index="4" />`,
      `        <img id="s1-b1-s1" class="clip" data-layout-allow-overflow src="assets/serum.png" alt="" data-start="1" data-duration="${seconds(20, FPS)}" data-track-index="4" />`,
      '      </div>',
      '      <div id="s1" class="ve-shot ve-m ve-win"',
    ].join('\n'));
    expect(timeline.windows[0]!.pictures).toEqual([{ behind: 'proof', element: 's1-b1-v', at: 10, for: 20 }, { behind: 'serum', element: 's1-b1-s1', at: 30, for: 20 }]);
    expect(timeline.animations.filter((a) => a.element === 's1-b1')).toEqual([{ element: 's1-b1', property: 'scale', at: 10, for: 40, from: 1, to: 1.1, ease: 'linear', hold: 'both' }]);
  });

  it('keeps one picture behind a window without a swap, and no motion on its wrapper when none is asked for', () => {
    const edit = richEdit();
    edit.shots[0]!.windows = [{ at: 10, for: 40, corner: 'top-left', behind: 'b', swaps: [{ at: 20, behind: 'proof' }, { at: 35, behind: 'c' }] }];
    const plain = compose(edit, richFacts());
    const picture = (id: string) => tagsOf(plain.html).find((t) => t.attrs.id === id)!;
    expect(picture('s1-b1').attrs).toEqual({ id: 's1-b1', class: 've-shot', style: 'z-index:1' });
    expect(['s1-b1-v', 's1-b1-s1', 's1-b1-s2'].map((id) => [picture(id).name, picture(id).attrs.src, Number(picture(id).attrs['data-start']) * FPS, Math.round(Number(picture(id).attrs['data-duration']) * FPS)]))
      .toEqual([['video', 'assets/b.mp4', 10, 10], ['img', 'assets/proof.png', 20, 15], ['video', 'assets/c.mp4', 35, 15]]);
    expect(picture('s1-b1-s2').attrs['data-media-start']).toBe('0');
    expect('data-layout-allow-overflow' in picture('s1-b1-v').attrs).toBe(false);
    expect(plain.timeline.windows).toEqual([{
      shot: 's1', behind: 'b', at: 10, for: 40, frames: 10, rect: { x: 65, y: 269, width: 414, height: 736 }, radius: 28,
      pictures: [{ behind: 'b', element: 's1-b1-v', at: 10, for: 10 }, { behind: 'proof', element: 's1-b1-s1', at: 20, for: 15 }, { behind: 'c', element: 's1-b1-s2', at: 35, for: 15 }],
    }]);
    delete edit.shots[0]!.windows![0]!.swaps;
    expect(compose(edit, richFacts()).timeline.windows[0]!.pictures).toEqual([{ behind: 'b', element: 's1-b1-v', at: 10, for: 40 }]);
  });

  it('upper-cases in the language of the document, never by CSS (R10)', () => {
    expect(tag('claim-1').text).toBe('CLİNİCALLY TESTED');
    expect(html).toContain('<html lang="tr">');
    expect(tag('note-1').text).toBe('İşte ğüşöç bakımı ✨ şimdi');
  });

  it('wraps a line on a plate, slides and blurs, and leaves out what a text does not have', () => {
    expect(html).toContain('<span class="ve-plate">New formula</span>');
    expect(cssOf(html)).toContain('.st-tag-40 .ve-plate { background: #e0508c; border-radius: 12px; padding: 9px 20px; }');
    expect(tag('title-1').attrs.class).toBe('clip ve-line ve-m ve-mb ve-al-center st-hook-72');
    expect(tag('title-1').attrs.style).toContain(`--ve-in-x:-77px;--ve-in-y:0px;--ve-out-b:24px;animation:ve-move-in ${seconds(8, FPS)}s cubic-bezier(0.16,1,0.3,1) ${seconds(-0.5, FPS)}s backwards, ve-fade-in ${seconds(8, FPS)}s linear ${seconds(-0.5, FPS)}s backwards, ve-blur-out`);
    expect(tag('claim-1').attrs.class).toBe('clip ve-line ve-m ve-al-left st-mine-52');
    expect(animationsOf(tag('claim-1').attrs.style).map((a) => a.name)).toEqual(['ve-scale-out', 've-fade-out']);
    expect(cssOf(html)).toMatch(/\.st-mine-52 \{ font-family: "Montserrat", sans-serif; font-weight: 700; font-size: 52px; line-height: 62px; color: #ffe000; letter-spacing: 0\.05em; text-shadow: 0px 2px 6px #000000; \}/);
  });

  it('shows a card whole by default (contain: the rect has the shape of the picture), or fills its box when it says cover', () => {
    const card = (id: string) => timeline.cards.find((c) => c.id === id)!;
    expect(card('zoom-card').rect).toEqual({ x: 216, y: 806, width: 432, height: 384 });          // cover: the box
    expect(card('product').rect).toEqual({ x: 421, y: 691, width: 238, height: 423 });            // contain: 720×1280 inside 410×423
    expect(tag('product').attrs.style).toContain('left:421px;top:691px;width:238px;height:423px;border-radius:36px;');
    const edit = shortEdit();
    edit.cards![0]!.fit = 'cover';
    expect(compose(edit, shortFacts()).timeline.cards[0]!.rect).toEqual({ x: 335, y: 691, width: 410, height: 423 });
    // a wide picture in the same box: as wide as the box, centred in its height
    const wide = compose(shortEdit(), { ...shortFacts(), serum: { frames: 0, audio: false, width: 1600, height: 900 } });
    expect(wide.timeline.cards[0]!.rect).toEqual({ x: 335, y: 787, width: 410, height: 231 });
    expect(wide.html).toContain('left:335px;top:787px;width:410px;height:231px;');
  });

  it('fits a picture into a box in whole pixels, centred, never larger than the box', () => {
    const box = { x: 100, y: 200, width: 400, height: 100 };
    expect(containRect(box, { width: 300, height: 600 })).toEqual({ x: 275, y: 200, width: 50, height: 100 });       // tall picture, wide box
    expect(containRect({ x: 100, y: 200, width: 100, height: 400 }, { width: 600, height: 300 })).toEqual({ x: 100, y: 375, width: 100, height: 50 });   // wide picture, tall box
    expect(containRect({ x: 0, y: 0, width: 173, height: 294 }, { width: 422, height: 1167 })).toEqual({ x: 34, y: 0, width: 106, height: 294 });        // the tube of the golden
    expect(containRect(box, { width: 800, height: 200 })).toEqual(box);                                                // the same shape: the box
    expect(containRect({ x: 0, y: 0, width: 16, height: 16 }, { width: 4000, height: 10 })).toEqual({ x: 0, y: 8, width: 16, height: 1 });
  });

  it('puts the enter and exit of a card with a motion on a box around it, as a shot has them on its wrapper', () => {
    expect(tag('zoom-card-box').attrs.style).toBe(`left:216px;top:806px;width:432px;height:384px;border-radius:36px;animation:ve-fade-in ${seconds(6, FPS)}s linear ${seconds(149.5, FPS)}s backwards, ve-fade-out ${seconds(6, FPS)}s linear ${seconds(203.5, FPS)}s forwards`);
    expect('data-start' in tag('zoom-card-box').attrs).toBe(false);
    expect(tag('zoom-card').attrs.style).toBe(`--ve-s0:1;--ve-s1:1.1;animation:ve-scale ${seconds(60, FPS)}s linear ${seconds(-0.5, FPS)}s both`);
  });

  it('highlights the active word with a pill, and closes a group on a pause, a full stop or four words', () => {
    expect(timeline.captions.map((group) => group.lines.join(' / '))).toEqual(['THİS İS WHAT / NOBODY', 'TELLS YOU.', 'USE İT / EVERY NİGHT', 'AND WAİT / A FULL', 'MİNUTE OKAY']);
    expect(tag('cap-2-w2').attrs.style).toBe(`animation:ve-word-pill ${seconds(18, FPS)}s step-end ${seconds(7.5, FPS)}s 1 normal none, ve-word-colour ${seconds(18, FPS)}s step-end ${seconds(7.5, FPS)}s 1 normal none`);
    expect(cssOf(html)).toContain('--ve-in-s: 0.8; --ve-active: #ffffff; --ve-pill: #7c3aed; }');
    expect(timeline.captions[1]).toMatchObject({ at: 94, for: 26 });                        // until 8 frames after "you." ends
    expect(timeline.captions[4]!.words).toEqual([{ index: 14, text: 'MİNUTE', at: 195, for: 20 }, { index: 15, text: 'OKAY', at: 215, for: 18 }]);
  });

  it('loops the music in passes that start on whole milliseconds, each with its own lane (§12.1)', () => {
    const music = timeline.audio.filter((a) => a.media === 'beat');
    expect(music.map((a) => [a.element, a.at, a.for, a.from])).toEqual([['music-1', 0, 99, 0], ['music-2', 99, 99, 0], ['music-3', 198, 99, 0], ['music-4', 297, 63, 0]]);
    for (const pass of music) {
      expect(pass.at % 3).toBe(0);
      expect(pass.gain[0]![0]).toBe(pass.at);
      expect(pass.gain.at(-1)![0]).toBe(pass.at + pass.for);
      const lane = JSON.parse(tag(pass.element).attrs['data-automation']!).lanes[0].points as { t: number; v: number }[];
      expect(lane).toEqual(pass.gain.map(([frame, v]) => ({ t: (frame - pass.at) / FPS, v })));
      expect(lane.every((point, i) => i === 0 || point.t > lane[i - 1]!.t)).toBe(true);
    }
    expect(music[0]!.gain).toEqual([[0, 0], [6, 0.2], [70, 0.2], [76, 0.6], [99, 0.6]]);         // fades in under the first shot's own sound
    expect(music[3]!.gain).toEqual([[297, 0.6], [348, 0.6], [360, 0]]);
  });

  it("plays a shot's own sound and an effect at a constant gain", () => {
    expect(html).toContain(`<audio id="s1-sound" src="assets/a.mp4" data-start="0" data-duration="${seconds(70, FPS)}" data-media-start="0" data-track-index="10" data-volume="1"></audio>`);
    expect(tag('ping').attrs).toMatchObject({ src: 'assets/ping.mp3', 'data-start': '5', 'data-duration': seconds(20, FPS), 'data-volume': '0.8' });
    expect(timeline.audio.find((a) => a.element === 'ping')).toEqual({ element: 'ping', media: 'ping', at: 150, for: 20, from: 0, gain: [[150, 0.8], [170, 0.8]] });
    expect(timeline.master).toEqual({ lufs: -16, peak: -1 });
  });

  it('describes a flash of an odd length exactly: the rise ends on the cut frame', () => {
    const rows = timeline.animations.filter((a) => a.element === 's5-fx');
    expect(rows).toEqual([
      { element: 's5-fx', property: 'opacity', at: 175, for: 6, from: 0, to: 12 / 11, ease: 'linear', hold: 'before' },
      { element: 's5-fx', property: 'opacity', at: 181, for: 5, from: 10 / 11, to: 0, ease: 'linear', hold: 'after' },
    ]);
    const value = (f: number) => { const r = rows.find((row) => f >= row.at && f < row.at + row.for)!; return r.from + (r.to - r.from) * ((f - r.at + 0.5) / r.for); };
    for (let f = 175; f < 186; f++) { const q = (f - 175 + 0.5) / 11; expect(value(f)).toBeCloseTo(q < 0.5 ? 2 * q : 2 * (1 - q), 12); }
    expect(value(180)).toBeCloseTo(1, 12);
  });
});

describe('compose: the frame table of the short document (§7)', () => {
  const { html, timeline } = compose(shortEdit(), shortFacts());
  const tags = tagsOf(html);
  const byId = (id: string) => tags.filter((t) => t.attrs.id === id);
  const frame = (text: string | undefined) => Math.round(Number(text) * FPS * 1e6) / 1e6;

  it('says the size, the rate and the length', () => {
    expect(timeline).toMatchObject({ fps: 30, frames: 180, width: 1080, height: 1920 });
  });

  it('lists the shots: they tile the video, and at / for / tail / from are the data-* values of their elements', () => {
    expect(timeline.shots).toEqual([
      { id: 's1', element: 's1-v', media: 'a', kind: 'video', at: 0, for: 60, tail: 8, from: 0 },
      { id: 's2', element: 's2-v', media: 'b', kind: 'video', at: 60, for: 60, tail: 8, from: 20 },
      { id: 's3', element: 's3-v', media: 'c', kind: 'video', at: 120, for: 60, tail: 0, from: 40 },
    ]);
    for (const shot of timeline.shots) {
      const [element, ...more] = byId(shot.element);
      expect(more).toEqual([]);
      expect(frame(element!.attrs['data-start'])).toBe(shot.at);
      expect(frame(element!.attrs['data-duration'])).toBe(shot.for + shot.tail);
      expect(frame(element!.attrs['data-media-start'])).toBe(shot.from);
    }
  });

  it('lists the transitions with the frames on which each is visible, and the colour of a flash or a dip', () => {
    expect(timeline.transitions).toEqual([
      { kind: 'crossfade', from: 's1', to: 's2', cut: 60, at: 60, for: 8, overlap: true, colour: null },
      { kind: 'whip', from: 's2', to: 's3', cut: 120, at: 120, for: 8, overlap: true, colour: null },
    ]);
    const rich = compose(richEdit(), richFacts()).timeline.transitions;
    expect(rich.map((t) => [t.kind, t.cut, t.at, t.for, t.overlap, t.colour])).toEqual([
      ['push', 60, 60, 10, true, null], ['zoom', 100, 96, 8, false, null], ['flash', 140, 137, 6, false, '#ffffff'], ['dip', 180, 175, 11, false, '#000000'],
      ['whip', 220, 220, 8, true, null], ['crossfade', 260, 260, 8, true, null], ['cut', 300, 300, 0, false, null],
    ]);
    const blue = compose({ ...richEdit(), shots: richEdit().shots.map((s) => (s.id === 's4' ? { ...s, in: { kind: 'flash' as const, colour: '#0AF' } } : s)) }, richFacts());
    expect(blue.timeline.transitions[2]!.colour).toBe('#00aaff');
    expect(blue.html).toContain('background:#0AF;');
  });

  it('lists every text line, caption group and card with an element that exists once and the same timing', () => {
    expect(timeline.texts.map((t) => [t.id, t.line, t.element, t.copy, t.size, t.colour])).toEqual([['hook', 1, 'hook-1', 'My lashes grew', 72, '#ffffff'], ['hook', 2, 'hook-2', 'visibly in three weeks', 72, '#ffffff']]);
    expect(timeline.texts.map((t) => t.rect)).toEqual([{ x: 97, y: 320, width: 886, height: 83 }, { x: 97, y: 403, width: 886, height: 83 }]);
    expect(timeline.captions.map((c) => [c.group, c.element, c.at, c.for, c.lines])).toEqual([[1, 'cap-1', 62, 34, ['NEVER', 'LOOKED SO']], [2, 'cap-2', 96, 32, ['GOOD']]]);
    expect(timeline.captions[0]!.words).toEqual([{ index: 0, text: 'NEVER', at: 62, for: 12 }, { index: 1, text: 'LOOKED', at: 74, for: 14 }, { index: 2, text: 'SO', at: 88, for: 8 }]);
    expect(timeline.captions[1]).toMatchObject({ rect: { x: 97, y: 998, width: 832, height: 231 }, size: 84, colour: '#ffffff', words: [{ index: 3, text: 'GOOD', at: 96, for: 32 }] });
    expect(timeline.cards).toEqual([{ id: 'product', element: 'product', media: 'serum', at: 70, for: 40, rect: { x: 421, y: 691, width: 238, height: 423 }, rest: { at: 78, for: 24 } }]);
    for (const entry of [...timeline.texts, ...timeline.captions, ...timeline.cards]) {
      const [element, ...more] = byId(entry.element);
      expect(more).toEqual([]);
      expect(frame(element!.attrs['data-start'])).toBe(entry.at);
      expect(frame(element!.attrs['data-duration'])).toBe(entry.for);
    }
  });

  it('gives every element a rest window inside its time, and checkAt the middle of each', () => {
    expect(timeline.texts.map((t) => t.rest)).toEqual([{ at: 8, for: 40 }, { at: 10, for: 38 }]);
    expect(timeline.captions.map((c) => c.rest)).toEqual([{ at: 67, for: 29 }, { at: 101, for: 27 }]);
    const rests = [...timeline.texts, ...timeline.captions, ...timeline.cards];
    for (const entry of rests) {
      expect(entry.rest.for).toBeGreaterThanOrEqual(1);
      expect(entry.rest.at).toBeGreaterThanOrEqual(entry.at);
      expect(entry.rest.at + entry.rest.for).toBeLessThanOrEqual(entry.at + entry.for);
    }
    expect(timeline.checkAt).toEqual([28, 29, 81, 90, 114]);
    for (const at of timeline.checkAt) expect(rests.some((entry) => at >= entry.rest.at && at < entry.rest.at + entry.rest.for)).toBe(true);
  });

  it('gives a style of the document that replaces a preset the motion of a style of its own, not the preset\'s (M7)', () => {
    const edit = shortEdit();
    const mine = { font: 'Inter' as const, weight: 700, size: 40, align: 'center' as const, fill: '#ffffff', shadows: [] as string[] };
    edit.styles = { hook: mine, own: mine };
    edit.texts!.push(
      { id: 'a', at: 10, for: 40, box: { left: 10, top: 30, right: 80, bottom: 36 }, style: 'hook', copy: 'one' },
      { id: 'b', at: 10, for: 40, box: { left: 10, top: 38, right: 80, bottom: 44 }, style: 'own', copy: 'two' },
    );
    const { timeline } = compose(edit, shortFacts());
    const rest = (id: string) => timeline.texts.find((t) => t.id === id)!.rest;
    expect(rest('a')).toEqual({ at: 16, for: 28 });                  // fade 6 in, fade 6 out, as the style "own"
    expect(rest('a')).toEqual(rest('b'));
    // the preset itself is untouched
    const preset = shortEdit();
    preset.texts!.push({ id: 'p', at: 10, for: 40, box: { left: 10, top: 30, right: 80, bottom: 36 }, style: 'hook', copy: 'one' });
    expect(compose(preset, shortFacts()).timeline.texts.find((t) => t.id === 'p')!.rest).toEqual({ at: 18, for: 26 });          // pop 8 in
  });

  it('does not sample a frame on which a window shrinks or returns (M1)', () => {
    // a label on frames 20 … 49 (rest 26 … 43) and a window on 30 … 54 that moves 10 frames each way: the middle of the rest (35) is
    // mid-shrink; the still frames of the rest are 26 … 29 and 40 … 43, and 40 is the nearer to the middle
    const table = {
      fps: FPS, frames: 100, transitions: [], captions: [], cards: [],
      windows: [{ shot: 's', behind: 'b', at: 30, for: 25, frames: 10, rect: { x: 0, y: 0, width: 1, height: 1 }, radius: 0, pictures: [] }],
      texts: [{ at: 20, for: 30, rest: { at: 26, for: 18 } }],
    } as unknown as Timeline;
    expect(checkFrames(table)).toEqual([40]);
    // and through compose: no sample inside any window's two moves
    const edit = shortEdit();
    edit.shots[0]!.windows = [{ at: 2, for: 21, corner: 'bottom-right', behind: 'serum' }];
    const made = compose(edit, shortFacts()).timeline;
    for (const at of made.checkAt) for (const w of made.windows) expect(at >= w.at && at < w.at + w.frames || at >= w.at + w.for - w.frames && at < w.at + w.for, `${at}`).toBe(false);
  });

  it('samples a rest only outside every transition and outside the enter and exit of every other element (§12.17)', () => {
    const edit = shortEdit();
    edit.shots[2]!.in = { kind: 'dip', frames: 30 };                                 // visible on frames 105 … 134
    edit.texts!.push({ id: 'late', at: 106, for: 20, box: { left: 10, top: 30, right: 80, bottom: 36 }, style: 'label', copy: 'late', enter: { kind: 'none' }, exit: { kind: 'none' } });
    const dipped = compose(edit, shortFacts()).timeline;
    expect(dipped.transitions[1]).toMatchObject({ kind: 'dip', at: 105, for: 30 });
    expect(dipped.texts.find((t) => t.id === 'late')!.rest).toEqual({ at: 106, for: 20 });     // wholly inside the dip: no sample
    // the last caption group rests on 101 … 127: its middle (114) is inside the dip, 102 … 104 are inside the exit of the card
    expect(dipped.captions[1]!.rest).toEqual({ at: 101, for: 27 });
    expect(dipped.cards[0]!.rest).toEqual({ at: 78, for: 24 });
    expect(dipped.checkAt).toEqual([28, 29, 81, 90, 101]);
    for (const [, make] of documents) {
      const made = make().timeline;
      const entries = [...made.texts, ...made.captions, ...made.cards];
      expect(made.checkAt.length).toBeGreaterThan(3);
      for (const at of made.checkAt) {
        expect(made.transitions.some((t) => at >= t.at && at < t.at + t.for), `frame ${at} in a transition`).toBe(false);
        const resting = entries.filter((entry) => at >= entry.rest.at && at < entry.rest.at + entry.rest.for);
        expect(resting.length).toBeGreaterThanOrEqual(1);
        // nothing that is on screen on a sampled frame is entering or leaving
        const moving = entries.filter((entry) => at >= entry.at && at < entry.at + entry.for && !resting.includes(entry));
        expect(moving.map((entry) => entry.element), `frame ${at}`).toEqual([]);
      }
    }
  });

  it('lists the sound with its gain on the timeline, and the loudness target (§12.3)', () => {
    expect(timeline.audio).toEqual([{ element: 'music-1', media: 'beat', at: 0, for: 180, from: 0, gain: [[0, 0.5], [56, 0.5], [62, 0.2], [116, 0.2], [122, 0.5], [168, 0.5], [180, 0]] }]);
    expect(byId('music-1')).toHaveLength(1);
    expect(timeline.master).toEqual({ lufs: -14, peak: -1 });
    expect(compose({ ...shortEdit(), audio: { ...shortEdit().audio, master: false } }, shortFacts()).timeline.master).toBeNull();
    expect(compose({ ...shortEdit(), audio: { ...shortEdit().audio, master: { lufs: -16, peak: -2 } } }, shortFacts()).timeline.master).toEqual({ lufs: -16, peak: -2 });
  });

  it('lists every animation with an element that exists once, inside the time of that element', () => {
    const windows = windowsOf(timeline);
    expect(timeline.animations.length).toBe(26);
    for (const animation of timeline.animations) {
      expect(byId(animation.element)).toHaveLength(1);
      const window = windows.get(animation.element)!;
      expect(animation.at).toBeGreaterThanOrEqual(window.at);
      expect(animation.at + animation.for).toBeLessThanOrEqual(window.end);
    }
    expect(timeline.animations.filter((a) => a.element === 's2')).toEqual([
      { element: 's2', property: 'opacity', at: 60, for: 8, from: 0, to: 1, ease: 'linear', hold: 'before' },
      { element: 's2', property: 'x', at: 120, for: 8, from: 0, to: -1080, ease: 'whip', hold: 'after' },
      { element: 's2', property: 'blur', at: 120, for: 8, from: 0, to: 36, ease: 'whip', hold: 'after' },
    ]);
    expect(timeline.animations.find((a) => a.element === 's2-v')).toEqual({ element: 's2-v', property: 'scale', at: 90, for: 4, from: 1, to: 1.2, ease: 'out', hold: 'both' });
    expect(timeline.animations.filter((a) => a.property === 'active').map((a) => [a.element, a.at, a.for, a.ease, a.hold])).toEqual([
      ['cap-1-w1', 62, 12, 'step', 'none'], ['cap-1-w2', 74, 14, 'step', 'none'], ['cap-1-w3', 88, 8, 'step', 'none'], ['cap-2-w1', 96, 32, 'step', 'none'],
    ]);
  });

  it('gives the value of a property on a frame by the rule of §7: from + (to − from) · ease((f − at + 0.5) / for)', () => {
    expect(valueAt(timeline, 's2', 'opacity', 59, 1)).toBe(0);                    // held before
    expect(valueAt(timeline, 's2', 'opacity', 60, 1)).toBe(0.5 / 8);
    expect(valueAt(timeline, 's2', 'opacity', 67, 1)).toBe(7.5 / 8);
    expect(valueAt(timeline, 's2', 'opacity', 68, 1)).toBe(1);                    // not held after: the resting value
    expect(valueAt(timeline, 's1-v', 'scale', 0, 1)).toBeCloseTo(1 + 0.08 * (0.5 / 68), 12);
    expect(valueAt(timeline, 's1-v', 'scale', 67, 1)).toBeCloseTo(1 + 0.08 * (67.5 / 68), 12);
    expect(valueAt(timeline, 's2-v', 'scale', 89, 1)).toBe(1);
    expect(valueAt(timeline, 's2-v', 'scale', 94, 1)).toBe(1.2);                  // a punch-in stays
    expect(valueAt(timeline, 's3', 'x', 119, 0)).toBe(1080);
    expect(valueAt(timeline, 's3', 'x', 124, 0)).toBeGreaterThan(0);
    expect(valueAt(timeline, 's3', 'x', 128, 0)).toBe(0);
    expect(valueAt(timeline, 'hook-1', 'opacity', 53, 1)).toBeCloseTo(1 - 5.5 / 6, 12);
    expect(valueAt(timeline, 'cap-1-w2', 'active', 73, 0)).toBe(0);
    expect(valueAt(timeline, 'cap-1-w2', 'active', 74, 0)).toBe(1);
    expect(valueAt(timeline, 'cap-1-w2', 'active', 88, 0)).toBe(0);
  });

  it('matches every animation of the HTML with a row of the table: same first frame, same length', () => {
    for (const tag of tags) {
      const base = 'data-start' in tag.attrs ? frame(tag.attrs['data-start']) : tag.ancestors.findLast((a) => 'data-start' in a.attrs && a.attrs.id !== 'root') ? frame(tag.ancestors.findLast((a) => 'data-start' in a.attrs)!.attrs['data-start']) : 0;
      for (const animation of animationsOf(tag.attrs.style)) {
        if (animation.name === 've-word-pop') continue;                          // the pop of a word is not in the table
        const at = Math.round(animation.delay * FPS + 0.5 + base);
        const length = Math.round(animation.duration * FPS);
        expect(timeline.animations.some((row) => row.element === tag.attrs.id && row.at === at && row.for === length)).toBe(true);
      }
    }
  });
});

describe('compose: errors that need the fit, and errors together', () => {
  it('schema: a document of the wrong shape is refused before anything else looks at it', () => {
    const issue = only((e) => { e.shots[0]!.id = 'S 1'; });
    expect(issue).toMatchObject({ code: 'schema', path: 'shots[0].id' });
    expect(only((e) => { (e as unknown as Record<string, unknown>).extra = 1; })).toMatchObject({ code: 'schema', path: 'extra' });
    expect(only((e) => { (e.shots[1] as unknown as Record<string, unknown>).at = 60.5; }).path).toBe('shots[1].at');
  });

  it('text-glyph: a character the font table does not cover', () => {
    const issue = only((e) => { e.texts![0]!.copy = '你好 lashes'; });
    expect(issue).toMatchObject({ code: 'text-glyph', path: 'texts[0].copy' });
    expect(issue.message).toContain('"你", "好"');
    expect(issue.message).toContain('Inter');
    expect(only((e) => { e.captions!.words[1]!.text = 'ресницы'; })).toMatchObject({ code: 'text-glyph', path: 'captions.words[1].text' });
    // the fit names an invisible character by its code point: it is shown as it is
    expect(glyphIssue('texts[0].copy', 'Inter', ['你', 'U+200B']).message).toBe('texts[0].copy has characters the font Inter has no width for: "你", U+200B');
  });

  it('text-empty: a copy of which nothing visible is left', () => {
    expect(only((e) => { e.texts![0]!.copy = '\u200b\u200b'; })).toMatchObject({ code: 'text-empty', path: 'texts[0].copy' });
    expect(only((e) => { e.captions!.words[2]!.text = '\u200b'; })).toMatchObject({ code: 'text-empty', path: 'captions.words[2].text' });
  });

  it('text-too-long, one word too wide: says shorten the word or widen the box', () => {
    const issue = only((e) => { e.texts![0]!.copy = 'Supercalifragilisticexpialidocious'; e.texts![0]!.box = { left: 9, top: 15, right: 29, bottom: 27 }; });
    expect(issue).toMatchObject({ code: 'text-too-long', path: 'texts[0].copy' });
    expect(issue.message).toMatch(/smallest size allowed \(44 px.*needs 734 px.*gives 211 px/);
    expect(issue.fix).toContain('shorten that word');
    expect(issue.fix).toMatch(/widen texts\[0\]\.box by at least \d+ px/);
  });

  it('text-too-long, too many lines: says raise lines, shorten the copy or lower shrink', () => {
    const issue = only((e) => { e.texts![0]!.copy = 'My lashes grew visibly in three weeks and everybody keeps asking me what I did'; e.texts![0]!.lines = 1; });
    expect(issue).toMatchObject({ code: 'text-too-long', path: 'texts[0].copy' });
    expect(issue.message).toContain('needs 3 lines, 1 is allowed');
    expect(issue.fix).toContain('raise texts[0].lines to 3');
    expect(issue.fix).toContain('shorten the copy');
    expect(issue.fix).toContain('lower texts[0].shrink');
  });

  it('text-too-long, too tall: says make the box taller, never wider', () => {
    const issue = only((e) => { e.texts![0]!.copy = 'My lashes grew visibly in three weeks and everybody keeps asking'; e.texts![0]!.box = { left: 9, top: 15, right: 91, bottom: 18.2 }; });
    expect(issue).toMatchObject({ code: 'text-too-long', path: 'texts[0].copy' });
    expect(issue.message).toMatch(/need 102 px of height, the box is 6\d px high/);
    expect(issue.fix).toMatch(/make texts\[0\]\.box taller by at least \d+ px/);
    expect(issue.fix).toContain('lower texts[0].lines');
    expect(issue.fix).not.toContain('widen');
  });

  it('caption-word-too-long: one word wider than the caption box', () => {
    const issue = only((e) => { e.captions!.words[1]!.text = 'incomprehensibilities'; });
    expect(issue).toMatchObject({ code: 'caption-word-too-long', path: 'captions.words[1].text' });
    expect(issue.message).toContain('"INCOMPREHENSIBILITIES"');
    expect(issue.message).toContain('815 px');
    expect(issue.fix).toMatch(/lower the size of the style "caption" to \d+ px or less/);
  });

  it('box-out-of-range: a caption box too low for one line', () => {
    const issue = only((e) => { e.captions!.box = { left: 9, top: 52, right: 86, bottom: 56 }; });
    expect(issue).toMatchObject({ code: 'box-out-of-range', path: 'captions.box' });
    expect(issue.message).toContain('108 px');
  });

  it('animation-too-long: the stagger of the lines leaves the last one no frame at rest', () => {
    const issue = only((e) => { e.texts![0]!.for = 16; e.texts![0]!.stagger = 3; });
    expect(issue).toMatchObject({ code: 'animation-too-long', path: 'texts[0]' });
    expect(issue.message).toContain('8 + 6 + 3 × 1 = 17');
    expect(issue.fix).toContain('texts[0].stagger to 1');
  });

  it('blur-too-many: more blurred elements than the renderer captures without black frames', () => {
    const issue = only((e) => {
      e.captions!.enter = { kind: 'blur' };
      e.captions!.group = { words: 1 };
      e.captions!.words = Array.from({ length: 24 }, (_, i) => ({ text: 'go', at: 60 + i * 4, for: 4 }));
    });
    expect(issue).toMatchObject({ code: 'blur-too-many', path: 'captions.enter' });
    expect(issue.message).toContain('26 elements');                                 // 24 groups and the two shots of the whip
    expect(issue.fix).toContain('"pop"');
    const fewer = shortEdit();
    fewer.captions!.enter = { kind: 'blur' };
    expect(compose(fewer, shortFacts()).html.match(/class="[^"]*ve-mb/g)).toHaveLength(4);
  });

  it('blur-too-many: counted again after the fit, which makes the lines validate could not know of', () => {
    const edit = shortEdit();
    // one line each as far as validate can tell (2 shots of the whip + 12), two lines each once fitted (2 + 24)
    edit.texts = Array.from({ length: 12 }, (_, i) => ({ ...shortEdit().texts![0]!, id: `t${i}`, enter: { kind: 'blur' as const } }));
    expect(validate(edit, shortFacts())).toEqual([]);
    const issue = only((e) => { e.texts = edit.texts; });
    expect(issue).toMatchObject({ code: 'blur-too-many', path: 'texts[11].enter' });
    expect(issue.message).toContain('26 elements');
  });

  it('blur-too-many: counts what carries a blur: a caption group of one frame has no enter', () => {
    const edit = shortEdit();
    edit.captions = { ...edit.captions!, enter: { kind: 'blur' }, group: { words: 1, hold: 0 }, words: Array.from({ length: 23 }, (_, i) => ({ text: 'go', at: 60 + i, for: 1 })) };
    const { html, timeline } = compose(edit, shortFacts());
    expect(timeline.captions.map((group) => group.for)).toEqual(Array.from({ length: 23 }, () => 1));
    expect(html.match(/class="[^"]*ve-mb/g)).toHaveLength(2);                          // the two shots of the whip
  });

  it('more-issues: a list that was cut is not fitted (what is wrong beyond it is not known), and compose still throws its own error', () => {
    const error = errorOf((e) => { e.texts = Array.from({ length: 150 }, (_, i) => ({ id: `t${i}`, at: 0, for: 30, box: { left: 10, top: 20, right: 80, bottom: 30 }, style: 'nope', copy: '你好' })); });
    expect(error.issues).toHaveLength(100);
    expect(error.issues.slice(0, 99).every((issue) => issue.code === 'style-unknown')).toBe(true);
    expect(error.issues[99]).toMatchObject({ code: 'more-issues' });
    expect(error.issues[99]!.message).toContain('51 more');
    // issues of the fit are counted in the same way: 120 texts that do not fit, after nothing else is wrong
    const fit = errorOf((e) => { e.texts = Array.from({ length: 120 }, (_, i) => ({ id: `t${i}`, at: 0, for: 30, box: { left: 10, top: 20, right: 80, bottom: 30 }, style: 'label', copy: '你好' })); });
    expect(fit.issues).toHaveLength(100);
    expect(fit.issues[98]).toMatchObject({ code: 'text-glyph', path: 'texts[98].copy' });
    expect(fit.issues[99]!.message).toContain('21 more');
  });

  it('too-many: a document of thousands of entries is refused at once, with a flat heap (the probes of the review)', () => {
    const media = (n: number) => { const doc = shortEdit(); for (let i = 0; i < n; i++) doc.media[`m${i}`] = { file: `assets/m${i}.mp4`, kind: 'video' }; doc.shots = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, at: i, for: 1, media: `nope${i}` })); return doc; };
    const styles = (n: number) => {
      const doc = shortEdit();
      doc.styles = Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, { font: 'Inter' as const, weight: 700, size: 40, align: 'center' as const, fill: '#ffffff', shadows: [] }]));
      doc.texts = Array.from({ length: n }, (_, i) => ({ id: `t${i}`, at: 0, for: 30, box: { left: 10, top: 20, right: 80, bottom: 30 }, style: `nope${i}`, copy: 'x' }));
      return doc;
    };
    const cases: [Edit, string[]][] = [
      [media(8000), ['too-many @ media', 'too-many @ shots']], [media(20000), ['too-many @ media', 'too-many @ shots']], [styles(8000), ['too-many @ styles', 'too-many @ texts']],
    ];
    for (const [doc, expected] of cases) {
      const heap = process.memoryUsage().heapUsed;
      const started = performance.now();
      const parsed = parseEdit(doc);
      expect((parsed.ok ? [] : parsed.issues).map((i) => `${i.code} @ ${i.path}`)).toEqual(expected);
      expect(validate(doc, shortFacts()).map((i) => `${i.code} @ ${i.path}`)).toEqual(expected);
      let thrown: unknown;
      try { compose(doc, shortFacts()); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(ComposeError);
      expect((thrown as ComposeError).issues.map((i) => `${i.code} @ ${i.path}`)).toEqual(expected);
      // loose bounds, the machine is shared: before the limits the first document took 9 s and 2.2 GB, the second ran out of memory
      expect(performance.now() - started).toBeLessThan(5000);
      expect(process.memoryUsage().heapUsed - heap).toBeLessThan(200 * 1024 * 1024);
    }
  });

  it('composes a document that is exactly at every limit, and one whose rests have no free frame, without a scan that grows with the square of its entries', () => {
    const started = performance.now();
    const full = compose(limitEdit(), limitFacts());
    expect([full.timeline.shots.length, full.timeline.texts.length, full.timeline.captions.length, full.timeline.cards.length, full.timeline.windows.length]).toEqual([120, 200, 200, 100, 8]);
    expect(full.timeline.checkAt.length).toBeGreaterThan(100);
    // the worst case for the samples: 198 texts of four lines that rest all the time, and two texts whose enter and exit cover every frame
    const edit = limitEdit();
    const still = { box: { left: 10, top: 20, right: 80, bottom: 34 }, style: 'label', enter: { kind: 'none' as const }, exit: { kind: 'none' as const } };
    edit.texts = [
      ...Array.from({ length: 198 }, (_, i) => ({ ...still, id: `t${i}`, at: 0, for: edit.frames, copy: 'a\nb\nc\nd' })),
      { ...still, id: 'ta', at: 0, for: edit.frames, copy: 'ok', enter: { kind: 'fade' as const, frames: 880 }, exit: { kind: 'fade' as const, frames: 880 } },   // rests on 880 … 895
      { ...still, id: 'tb', at: 800, for: 200, copy: 'ok', enter: { kind: 'fade' as const, frames: 100 }, exit: { kind: 'fade' as const, frames: 50 } },             // comes in on 800 … 899
    ];
    const busy = compose(edit, limitFacts());
    expect(busy.timeline.texts).toHaveLength(198 * 4 + 2);
    expect(busy.timeline.checkAt).toEqual([]);
    // loose, the machine is shared: on a quiet one both together take well under 2 s
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('too-long: a huge "frames" is refused by the shape of the document, before any rule walks its frames', () => {
    const issue = only((e, facts) => { e.frames = 300_000_000; e.audio!.music!.loop = true; facts.beat = { frames: 90, audio: true }; });
    expect(issue).toMatchObject({ code: 'too-long', path: 'frames' });
  });

  it('id-duplicate: no id of the composition is written twice', () => {
    expect(errorOf((e) => { e.texts![0]!.id = 'cap'; }).issues.map((i) => `${i.code} @ ${i.path}`)).toEqual(['id-duplicate @ texts[0].id']);
    expect(errorOf((e) => { e.texts![0]!.id = 'music'; }).code).toBe('id-duplicate');
  });

  it('media-facts: facts that are missing or are not facts are issues, never a foreign throw', () => {
    for (const facts of [null, undefined, 7, [], { a: null, b: 'x', c: [], beat: { frames: null } }]) {
      let thrown: unknown;
      try { compose(shortEdit(), facts as never); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(ComposeError);
      expect((thrown as ComposeError).issues.map((i) => `${i.code} @ ${i.path}`)).toEqual(['media-facts @ media.a', 'media-facts @ media.b', 'media-facts @ media.c', 'media-facts @ media.beat', 'media-size-unknown @ cards[0]']);
    }
    expect(only((_, facts) => { (facts as Record<string, unknown>).serum = null; })).toMatchObject({ code: 'media-facts', path: 'media.serum' });
    // a document that needs no facts composes without any
    const still: Edit = { version: 1, language: 'en', canvas: { width: 720, height: 1280, fps: 30 }, frames: 30, media: { p: { file: 'assets/p.png', kind: 'image' } },
      shots: [{ id: 's1', at: 0, for: 30, media: 'p' }], cards: [{ id: 'c1', at: 1, for: 29, media: 'p', box: { left: 20, top: 20, right: 60, bottom: 40 }, fit: 'cover', enter: { kind: 'none' }, exit: { kind: 'none' } }] };
    expect(compose(still, null as never).timeline.cards).toHaveLength(1);
    expect(() => compose(still, { p: null } as never)).toThrow(ComposeError);            // given, and not facts
  });

  it('several faults: the rules and the fit report together, in one error', () => {
    const error = errorOf((e, facts) => {
      e.shots[2]!.at = 121; e.shots[2]!.for = 59;                              // shots-gap
      e.texts![0]!.copy = '你好';                                              // text-glyph
      e.captions!.words[0]!.text = 'incomprehensibilities';                    // caption-word-too-long
      e.cards![0]!.media = 'nope';                                             // media-unknown
      facts.a = { frames: 20, audio: false };                                  // clip-short
    });
    expect(error.issues.map((i) => i.code).sort()).toEqual(['caption-word-too-long', 'clip-short', 'media-unknown', 'shots-gap', 'text-glyph']);
    expect(error.code).toBe(error.issues[0]!.code);
    expect(error.message).toContain('and 4 more');
  });

  it('does not fit a text whose style or box is already wrong', () => {
    const error = errorOf((e) => { e.texts![0]!.style = 'nope'; e.texts![0]!.copy = '你好'; e.captions!.box = { left: 9, top: 52, right: 5, bottom: 64 }; });
    expect(error.issues.map((i) => i.code)).toEqual(['style-unknown', 'box-out-of-range']);
  });
});

describe('compose: nothing of the document reaches the output unchecked (§5.9)', () => {
  it('escapes copy and caption words', () => {
    const edit = shortEdit();
    edit.texts![0]!.copy = `<b>&"'</b>`;
    edit.captions!.words[0]!.text = '<i>&';
    const { html, timeline } = compose(edit, shortFacts());
    expect(html).toContain('&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
    expect(html).toContain('&lt;I&gt;&amp;');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<I>');
    expect(timeline.texts[0]!.copy).toBe(`<b>&"'</b>`);
  });

  it('refuses a colour, a shadow, an id, a style name, a language or a file that fails its pattern', () => {
    const style = { font: 'Inter' as const, weight: 700, size: 40, align: 'center' as const, fill: '#ffffff', shadows: [] as string[] };
    const cases: [string, (e: Edit) => void][] = [
      ['style-value', (e) => { e.styles = { mine: { ...style, fill: 'red;background:url(x)' } }; }],
      ['style-value', (e) => { e.styles = { mine: { ...style, shadows: ['0px 0px 4px #000;} body{display:none'] } }; }],
      ['style-value', (e) => { e.background = '#000;} *{color:red'; }],
      ['style-value', (e) => { e.captions!.active = { kind: 'colour', colour: 'expression(alert(1))' }; }],
      ['style-value', (e) => { e.shots[1]!.in = { kind: 'flash', colour: '#fff" onload="x' }; }],
      ['schema', (e) => { e.texts![0]!.id = 'x" onclick="alert(1)'; }],
      ['schema', (e) => { e.styles = { 'a{}b': style }; }],
      ['schema', (e) => { e.language = 'en"><script>alert(1)</script>'; }],
      ['schema', (e) => { e.media['a b'] = { file: 'assets/x.png', kind: 'image' }; }],
      ['media-file', (e) => { e.media.a!.file = 'assets/a.mp4" onerror="alert(1)'; }],
      ['media-file', (e) => { e.media.a!.file = 'https://example.com/a.mp4'; }],
      ['media-file', (e) => { e.media.a!.file = 'assets/../../etc/passwd'; }],
    ];
    for (const [code, change] of cases) expect(errorOf(change).issues.map((i) => i.code)).toEqual([code]);
  });
});
