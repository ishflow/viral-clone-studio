// checkOutput with the footage in hand (`sources`): the text rule that takes the footage away, the footage rule, and what is left without sources.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createMeasure } from '../adapters/measure.ts';
import type { Timeline } from '../edit/timeline.ts';
import { checkOutput } from './output.ts';
import { FFMPEG, FFPROBE, SLOW, type Box, type VideoSpec, haveFfmpeg, makeTimeline, makeVideo } from './samples.ts';

const RECT = { x: 20, y: 200, width: 230, height: 40 };
/** Six "letters" in the fill colour inside RECT, each on a black block 2 px larger (an outline), on frames from … to. */
function letters(from: number, to: number, outlined = true, shift = 0): Box[] {
  const bars = Array.from({ length: 6 }, (_, i) => ({ x: RECT.x + 6 + i * 36 + shift, y: RECT.y + 6, width: 24, height: 28, colour: '#ffffff', from, to }));
  return [...(outlined ? bars.map((b) => ({ ...b, x: b.x - 2, y: b.y - 2, width: b.width + 4, height: b.height + 4, colour: '#000000' })) : []), ...bars];
}
/** White clouds that drift over a blue sky: the text's own colour, crossing its rect within a few frames. */
const SKY = "nullsrc=s=54x96:r=30:d=3,format=gray,geq=lum='255*clip(2.5*(sin(X/W*9+N*0.06)*sin(Y/H*11+N*0.02)+0.5*sin(X/W*23-N*0.09+Y/H*5)-0.15)\\,0\\,1)',format=rgb24,lutrgb=r='90+165*val/255':g='160+95*val/255':b='235+20*val/255',scale=270x480:flags=bicubic";
const text = (at: number, length: number, rest: { at: number; for: number }): Partial<Timeline> => ({
  texts: [{ id: 'title', line: 0, element: 'title', copy: 'ABCDEF', at, for: length, rect: RECT, size: 28, colour: '#ffffff', rest }],
});
const LATE = text(20, 60, { at: 30, for: 40 });
/** White bars in RECT that the footage itself grows: one there from frame 13 on, a second from frame 26 on (equal ink, so the growth before and after the text start is the same). */
const bar = (x: number, from: number) => ({ x, y: RECT.y + 4, width: 60, height: 5, colour: '#ffffff', from, to: 89 });
const CREEP = text(20, 60, { at: 30, for: 4 });                    // frames 19 and 6 (before the text) and frame 32 (the rest) are three readings of the same rect
const WHOLE = text(0, 90, { at: 0, for: 90 });                     // on screen from the shot's first frame to its last: no frame without it
/** One word of three letters on frames 20 … 79 as the active mark draws it, never in the fill (#ffffff): in the mark's colour on a black outline, or dark on a pill. */
function lit(kind: 'colour' | 'pill'): Box[] {
  const bars = Array.from({ length: 3 }, (_, i) => ({ x: RECT.x + 6 + i * 36, y: RECT.y + 6, width: 24, height: 28, from: 20, to: 79 }));
  return kind === 'colour'
    ? [...bars.map((b) => ({ ...b, x: b.x - 2, y: b.y - 2, width: b.width + 4, height: b.height + 4, colour: '#000000' })), ...bars.map((b) => ({ ...b, colour: '#ffe000' }))]
    : [{ x: RECT.x + 2, y: RECT.y + 2, width: 112, height: 36, colour: '#ffe000', from: 20, to: 79 }, ...bars.map((b) => ({ ...b, colour: '#101010' }))];
}
/** A caption group of `count` words on frames 20 … 79, each the active one for an equal share (compose writes the mark as an `active` row on each word's element); one word: active for the whole group. `marked` false: no mark at all. */
const said = (marked = true, count = 1): Partial<Timeline> => {
  const words = Array.from({ length: count }, (_, i) => ({ index: i, text: 'ABC', at: 20 + (i * 60) / count, for: 60 / count }));
  return {
    captions: [{ group: 1, element: 'cap-1', at: 20, for: 60, rect: RECT, size: 28, colour: '#ffffff', lines: [words.map((w) => w.text).join(' ')], words, rest: { at: 30, for: 40 } }],
    animations: marked ? words.map((w, i) => ({ element: `cap-1-w${i + 1}`, property: 'active' as const, at: w.at, for: w.for, from: 0, to: 1, ease: 'step' as const, hold: 'none' as const })) : [],
  };
};

describe.skipIf(!haveFfmpeg)('checkOutput against the footage', () => {
  const measure = createMeasure(FFMPEG, FFPROBE);
  const dir = mkdtempSync(join(tmpdir(), 've-footage-'));
  const file = (name: string) => join(dir, `${name}.mp4`);
  const specs: Record<string, VideoSpec> = {
    sky: { source: SKY },
    skyLate: { source: SKY, boxes: letters(20, 79) },
    skyWhole: { source: SKY, boxes: letters(0, 89) },
    white: { background: '#f4f4f4', noise: 4 },
    whiteWhole: { background: '#f4f4f4', noise: 4, boxes: letters(0, 89) },
    whiteBare: { background: '#f4f4f4', noise: 4, boxes: letters(0, 89, false) },
    pattern: { source: 'testsrc2=size=270x480:rate=30:duration=3' },
    // the freeze comes first; over it a patch flickers on every frame (as an animated caption does), so the picture as a whole never stands still
    held: { source: 'testsrc2=size=270x480:rate=30:duration=3', freeze: { first: 30, last: 89 }, filter: 'split[a][b];[a]crop=120:60:30:280,noise=alls=60:allf=t[n];[b][n]overlay=30:280' },
    creep: { boxes: [bar(RECT.x + 10, 13), bar(RECT.x + 100, 26)] },
    still: { boxes: [bar(RECT.x + 10, 0), bar(RECT.x + 100, 0)] },
    wide: { source: 'testsrc2=size=540x480:rate=30:duration=3' },
    wideLeft: { source: 'testsrc2=size=540x480:rate=30:duration=3', filter: 'crop=270:480:0:0' },
    wideCentre: { source: 'testsrc2=size=540x480:rate=30:duration=3', filter: 'crop=270:480:135:0' },
    groups: { boxes: [...letters(20, 49, false), ...letters(50, 79, false, 4)] },
    plain: {},
    lit: { boxes: lit('colour') },
    pill: { boxes: lit('pill') },
  };
  const codes = (issues: { code: string }[]) => issues.map((i) => i.code);
  const run = (name: string, over: Partial<Timeline>, source: string | null) => checkOutput(file(name), makeTimeline(over), measure, source === null ? undefined : { clip: file(source) });

  beforeAll(async () => {
    for (const [name, spec] of Object.entries(specs)) await makeVideo(file(name), spec);
  }, SLOW * 3);

  describe('text, with the footage taken away', () => {
    it('a text that did not render over bright footage that moves is missing; rendered, it raises nothing', async () => {
      const missing = await run('sky', LATE, 'sky');
      expect(codes(missing)).toEqual(['text-missing']);
      expect(missing[0]).toMatchObject({ severity: 'error', target: 'title' });
      expect(codes(await run('skyLate', LATE, 'sky'))).toEqual([]);
    }, SLOW);
    it('the same for a text that covers its whole shot from the first frame (no frame without it to compare with)', async () => {
      expect(codes(await run('sky', WHOLE, 'sky'))).toEqual(['text-missing']);
      expect(codes(await run('skyWhole', WHOLE, 'sky'))).toEqual([]);
    }, SLOW);
    it('over footage of the text\'s own colour: missing is found; with an outline the text is seen; without one nobody can see it, and that is an error too', async () => {
      expect(codes(await run('white', WHOLE, 'white'))).toEqual(['text-missing']);
      expect(codes(await run('whiteWhole', WHOLE, 'white'))).toEqual([]);
      const bare = await run('whiteBare', WHOLE, 'white');
      expect(codes(bare)).toEqual(['text-missing']);
      expect(bare[0]!.message).toMatch(/footage/);
      expect(bare[0]!.fix).toMatch(/outline/);
    }, SLOW);
    it('the fix names the viraleditor command, never the renderer\'s', async () => {
      const [issue] = await run('sky', LATE, 'sky');
      expect(issue!.fix).toContain('viraleditor check <edit.json> --deep');
      expect(issue!.fix).not.toMatch(/hyperframes/);
    }, SLOW);
  });

  describe('a caption group whose only word carries the active mark (no pixel of the fill)', () => {
    it('with the footage: the word in the mark\'s colour, or dark on a pill, raises nothing; the group not rendered is text-missing', async () => {
      expect(codes(await run('lit', said(), 'plain'))).toEqual([]);
      expect(codes(await run('pill', said(), 'plain'))).toEqual([]);
      const missing = await run('plain', said(), 'plain');
      expect(codes(missing)).toEqual(['text-missing']);
      expect(missing[0]).toMatchObject({ severity: 'error', target: 'cap-1' });
    }, SLOW);
    it('without a mark on that frame the fill must be there: the same word in another colour is text-missing, with the footage or without', async () => {
      expect(codes(await run('lit', said(false), 'plain'))).toEqual(['text-missing']);
      expect(codes(await run('lit', said(false), null))).toEqual(['text-missing']);
    }, SLOW);
    it('without the footage the mark\'s colour is not known: rendered or not, a warning that the group could not be verified, never an error and never silence', async () => {
      for (const name of ['lit', 'pill', 'plain']) {
        const found = await run(name, said(), null);
        expect(codes(found), name).toEqual(['text-unverified']);
        expect(found[0]).toMatchObject({ severity: 'warning', target: 'cap-1' });
      }
    }, SLOW);
    it('a group of four words with one marked shows the fill on the other three: too little of it is text-missing, with the footage or without', async () => {
      for (const source of ['plain', null]) {
        const found = await run('plain', said(true, 4), source);
        expect(codes(found), String(source)).toEqual(['text-missing']);
        expect(found[0]).toMatchObject({ severity: 'error', target: 'cap-1' });
      }
    }, SLOW);
    it('with the footage given but no frame of the rest where the shot is shown plain (the shot moved): a warning, never an error and never silence', async () => {
      const moved = { animations: [...said().animations!, { element: 'shot-main', property: 'x' as const, at: 0, for: 90, from: 4, to: 4, ease: 'linear' as const, hold: 'both' as const }] };
      for (const name of ['lit', 'plain']) {
        const found = await run(name, { ...said(), ...moved }, 'plain');
        expect(codes(found), name).toEqual(['text-unverified']);
        expect(found[0]!.message).toMatch(/could not be compared/);
      }
    }, SLOW);
    it('with the footage given but another element over most of the rect: a warning, never an error and never silence', async () => {
      const cover = { cards: [{ id: 'cover', element: 'cover', media: 'x', at: 0, for: 90, rect: RECT, rest: { at: 0, for: 90 } }] };
      for (const name of ['lit', 'plain']) {
        const found = await run(name, { ...said(), ...cover }, 'plain');
        expect(codes(found), name).toEqual(['text-unverified']);
        expect(found[0]!.message).toMatch(/other elements cover/);
      }
    }, SLOW);
  });

  describe('the footage itself', () => {
    it('a render that shows another clip than the timeline says is wrong-footage; the right clip raises nothing', async () => {
      const wrong = await run('sky', {}, 'pattern');
      expect(codes(wrong)).toEqual(['wrong-footage']);
      expect(wrong[0]).toMatchObject({ severity: 'error', target: 'main' });
      expect(wrong[0]!.message).toMatch(/Shot main does not show its footage/);
      expect(codes(await run('sky', {}, 'sky'))).toEqual([]);
    }, SLOW);
    it('a clip that holds a frame under things that keep changing (the picture never stops, so nothing reads as frozen) is found by its footage', async () => {
      expect(codes(await run('held', {}, null))).toEqual([]);                    // without the footage nothing can know
      const flicker = { cards: [{ id: 'patch', element: 'patch', media: 'x', at: 0, for: 90, rect: { x: 30, y: 280, width: 120, height: 60 }, rest: { at: 0, for: 90 } }] };
      const found = await run('held', flicker, 'pattern');
      expect(codes(found)).toEqual(['wrong-footage']);
      expect(found[0]!.message).toMatch(/source frame 89/);
    }, SLOW);
    it('a text that did not render is still told apart from wrong footage: the text rule falls back to its frames without the text', async () => {
      const found = await run('sky', LATE, 'pattern');
      expect(codes(found)).toContain('wrong-footage');
    }, SLOW);
  });

  describe('the footage rule is only sure where the place of the footage is known', () => {
    const zoom = { animations: [{ element: 'shot-main', property: 'scale' as const, at: 0, for: 90, from: 1.5, to: 1.5, ease: 'linear' as const, hold: 'both' as const }] };
    const focused = (focus: [number, number]): Partial<Timeline> => ({ shots: [{ id: 'main', element: 'shot-main', media: 'clip', kind: 'video', at: 0, for: 90, tail: 0, from: 0, focus } as Timeline['shots'][number]] });
    it('a shot shown cropped (a wider source) or zoomed, with no focus in the timeline: a different picture cannot be told from a crop, so no wrong-footage', async () => {
      expect(codes(await run('wideLeft', {}, 'wide'))).toEqual([]);                  // covers the canvas by cutting the sides off: the centre is only assumed
      expect(codes(await run('sky', zoom, 'pattern'))).toEqual([]);                   // same shape, but zoomed around a point the timeline does not carry
    }, SLOW);
    it('the same shot with the guard\'s conditions met (same shape, scale 1) and a really different picture is wrong-footage', async () => {
      const found = await run('sky', {}, 'pattern');
      expect(codes(found)).toEqual(['wrong-footage']);
      expect(found[0]).toMatchObject({ severity: 'error', target: 'main' });
    }, SLOW);
    it('with a focus in the timeline the place is known: the right crop raises nothing, another crop is wrong-footage even though the source is wider', async () => {
      expect(codes(await run('wideLeft', focused([0, 50]), 'wide'))).toEqual([]);
      expect(codes(await run('wideCentre', focused([0, 50]), 'wide'))).toEqual(['wrong-footage']);
    }, SLOW);
  });

  describe('without the footage', () => {
    it('footage that grows ink of the text colour by itself where a text should appear: a warning that it could not be verified, not an error', async () => {
      const found = await run('creep', CREEP, null);
      expect(codes(found)).toEqual(['text-unverified']);
      expect(found[0]).toMatchObject({ severity: 'warning', target: 'title' });
      expect(found[0]!.message).toMatch(/changes by itself/);
      expect(found[0]!.fix).toContain('viraleditor inspect <mp4> --timeline <timeline.json> --edit <edit.json>');
      expect(found[0]!.fix).not.toContain('check <edit.json> --deep');
    }, SLOW);
    it('the same rect with footage that does not change and no text: text-missing', async () => {
      const found = await run('still', CREEP, null);
      expect(codes(found)).toEqual(['text-missing']);
      expect(found[0]).toMatchObject({ severity: 'error', target: 'title' });
    }, SLOW);
    it('caption groups that follow each other in one rect are each seen (the frame before a group shows the group before it)', async () => {
      const group = (n: number, at: number) => ({ group: n, element: `cap-${n}`, at, for: 30, rect: RECT, size: 28, colour: '#ffffff', lines: ['ABC'], words: [], rest: { at: at + 4, for: 26 } });
      expect(codes(await run('groups', { captions: [group(0, 20), group(1, 50)] }, null))).toEqual([]);
    }, SLOW);
    it('a text with no frame of its shot without it, over footage of its own colour: what cannot be verified is said, not blamed on the style', async () => {
      const found = await run('sky', WHOLE, null);
      expect(codes(found)).toEqual(['text-unverified']);
      expect(found[0]).toMatchObject({ severity: 'warning', target: 'title' });
      expect(found[0]!.fix).toContain('viraleditor inspect <mp4> --timeline <timeline.json> --edit <edit.json>');      // the output check, not the renderer's
      expect(found[0]!.fix).not.toContain('check <edit.json> --deep');
      expect(codes(await run('skyWhole', WHOLE, null))).toEqual([]);
    }, SLOW);
    it('over bright footage that moves, a text that did not render is never passed in silence: missing, or a warning that it could not be verified', async () => {
      const found = await run('sky', LATE, null);
      expect(found.some((i) => i.target === 'title' && (i.code === 'text-missing' || i.code === 'text-unverified'))).toBe(true);
      const rendered = await run('skyLate', LATE, null);
      expect(rendered.filter((i) => i.severity === 'error')).toEqual([]);
    }, SLOW);
  });
});
