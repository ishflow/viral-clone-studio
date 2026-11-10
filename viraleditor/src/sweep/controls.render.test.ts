// Negative controls: the net of the sweep must catch a document that is wrong by ONE frame. Two documents are rendered once;
// their frame tables are then falsified by one frame, and the same read of the same pixels must flag it.
import { beforeAll, describe, expect, it } from 'vitest';
import { analyse } from './analyse.ts';
import { captionsPill, cuts, textExits } from './documents.ts';
import { sweepMedia } from './media.ts';
import type { SweepMedia } from './media.ts';
import { SLOW, available, renderDoc } from './run.ts';
import type { Rendered } from './run.ts';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe.skipIf(!available)('sweep controls: a falsified frame table is caught', () => {
  let media: SweepMedia;
  let cutsRender: Rendered;
  let exitsRender: Rendered;
  let pillRender: Rendered;
  beforeAll(async () => {
    media = sweepMedia();
    cutsRender = await renderDoc('ctl-cuts', cuts(), media, 1);
    exitsRender = await renderDoc('ctl-exits', textExits(), media, 1);
    pillRender = await renderDoc('ctl-pill', captionsPill(), media, 1);
  }, SLOW);

  it('the true tables pass', async () => {
    expect((await analyse(cutsRender, media, cutsRender.outputs[0]!)).wrong).toEqual([]);
    expect((await analyse(exitsRender, media, exitsRender.outputs[0]!)).wrong).toEqual([]);
    expect((await analyse(pillRender, media, pillRender.outputs[0]!)).wrong).toEqual([]);
  }, SLOW);

  it('a faded exit one frame late is caught by its edge, to the frame (the ink thresholds alone let it pass)', async () => {
    const t = clone(exitsRender.timeline);
    const row = t.texts.find((x) => x.id === 'fade')!;
    for (const a of t.animations) if (a.element === row.element && a.property === 'opacity' && a.at >= row.rest.at) a.at += 1;
    row.for += 1; row.rest.for += 1;
    const a = await analyse({ ...exitsRender, timeline: t }, media, exitsRender.outputs[0]!);
    const edge = a.edges.find((e) => e.element === row.element && e.side === 'exit')!;
    expect(edge.error).toBeLessThan(-0.8);
    expect(edge.error).toBeGreaterThan(-1.2);
    expect(a.wrong.some((w) => w.kind === 'text-edge' && w.element === row.element)).toBe(true);
    expect(a.wrong.filter((w) => w.kind === 'text').length, 'the ink judge alone').toBe(0);
  }, SLOW);

  it('an active caption word one frame early is caught on that frame', async () => {
    const t = clone(pillRender.timeline);
    const g = t.captions.find((x) => x.element === 'cap-2')!;           // FRIEND 17+8, LOOK 25+2: LOOK now from 24
    g.words[0]!.for -= 1; g.words[1]!.at -= 1; g.words[1]!.for += 1;
    const a = await analyse({ ...pillRender, timeline: t }, media, pillRender.outputs[0]!);
    expect(a.wrong.filter((w) => w.kind === 'caption-lit').map((w) => w.frame)).toContain(24);
  }, SLOW);

  it('two caption words in the wrong order are caught by their letters', async () => {
    const t = clone(pillRender.timeline);
    const g = t.captions.find((x) => x.element === 'cap-1')!;           // HELLO / THERE MY → HELLO / MY THERE
    g.lines = ['HELLO', 'MY THERE'];
    const a = await analyse({ ...pillRender, timeline: t }, media, pillRender.outputs[0]!);
    expect(a.wrong.some((w) => w.kind === 'caption-letters' && w.frame >= 8 && w.frame < 17)).toBe(true);
  }, SLOW);

  it('a shot that starts one source frame later is caught on every frame of it', async () => {
    const t = clone(cutsRender.timeline);
    t.shots.find((s) => s.id === 's4')!.from += 1;
    const a = await analyse({ ...cutsRender, timeline: t }, media, cutsRender.outputs[0]!);
    expect(a.wrong.filter((w) => w.kind === 'shot').length).toBeGreaterThanOrEqual(40);
  }, SLOW);

  it('a cut one frame early is caught', async () => {
    const t = clone(cutsRender.timeline);
    const s2 = t.shots.find((s) => s.id === 's2')!;
    const s1 = t.shots.find((s) => s.id === 's1')!;
    s1.for -= 1; s2.at -= 1; s2.for += 1;
    const a = await analyse({ ...cutsRender, timeline: t }, media, cutsRender.outputs[0]!);
    expect(a.wrong.some((w) => w.kind === 'shot' && w.frame === 36)).toBe(true);
  }, SLOW);

  it('a text that appears one frame late is caught on its first and its first absent frame', async () => {
    const t = clone(cutsRender.timeline);
    const row = t.texts.find((x) => x.id === 'tb')!;
    row.at += 1; row.for -= 1; row.rest.at += 1; row.rest.for -= 1;
    const a = await analyse({ ...cutsRender, timeline: t }, media, cutsRender.outputs[0]!);
    expect(a.wrong.filter((w) => w.kind === 'text').map((w) => w.frame)).toContain(58);
  }, SLOW);

  it('a blur that is only a fade is told from a blur: the edge sharpness measure', async () => {
    const real = await analyse(exitsRender, media, exitsRender.outputs[0]!);
    const sharp = (name: string) => (real.sharpness[name] ?? []).filter((x) => x.opacity < 0.9 && x.opacity > 0.25 && (real.sharpness[name] ?? []).length > 0);
    const blur = sharp('blur-1');
    const fade = sharp('fade-1');
    console.log('SHARP blur', JSON.stringify(blur.map((x) => `${x.frame}:${x.opacity}/${x.sharp}`)), 'fade', JSON.stringify(fade.map((x) => `${x.frame}:${x.opacity}/${x.sharp}`)));
    expect(blur.length).toBeGreaterThan(2);
    expect(fade.length).toBeGreaterThan(2);
    expect(Math.min(...blur.map((x) => x.sharp))).toBeLessThan(0.7);       // the last frames of the exit, where the radius is largest
    expect(Math.min(...fade.map((x) => x.sharp))).toBeGreaterThan(0.9);
    // the same pixels judged against a table that calls the blur a fade (blur rows removed) and a fade a blur (rows added)
    const asFade = clone(exitsRender.timeline);
    asFade.animations = asFade.animations.filter((a) => !(a.element === 'blur-1' && a.property === 'blur'));
    const a1 = await analyse({ ...exitsRender, timeline: asFade }, media, exitsRender.outputs[0]!);
    expect(a1.wrong.some((w) => w.kind === 'text-blur')).toBe(true);
    const asBlur = clone(exitsRender.timeline);
    const fadeRow = asBlur.texts.find((x) => x.id === 'fade')!;
    asBlur.animations.push({ element: fadeRow.element, property: 'blur', at: fadeRow.at + fadeRow.for - 12, for: 12, from: 0, to: 16, ease: 'linear', hold: 'none' });
    const a2 = await analyse({ ...exitsRender, timeline: asBlur }, media, exitsRender.outputs[0]!);
    expect(a2.wrong.some((w) => w.kind === 'text-blur' && w.element === fadeRow.element)).toBe(true);
  }, SLOW);
});
