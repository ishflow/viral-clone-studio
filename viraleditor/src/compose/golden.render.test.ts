// Real HyperFrames (`pnpm test:render`): two documents are composed, checked, rendered and read back frame by frame.
// The clips carry the frame bar of adapters/framebar.ts, so every frame says which source frame it shows.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFakeGenerator } from '../adapters/fake-generator.ts';
import { readBar } from '../adapters/framebar.ts';
import type { Timeline } from '../edit/timeline.ts';
import type { ComposeFacts, Edit } from '../edit/types.ts';
import { shortEdit } from './fixture.ts';
import { available, count, decode, frameMd5, hyperframes, jsonOf, probe, readShot, showsExpected } from './golden-helpers.ts';
import type { Picture, Probe } from './golden-helpers.ts';
import { compose } from './index.ts';
import { writeComposition } from './write.ts';

const FPS = 30;
const SLOW = 900_000;                                    // the machine is shared: a render may take minutes
const TIER = { model: 'seedance-2-mini', resolution: '720p' };   // the `fast` tier of the default settings

interface Made { dir: string; timeline: Timeline; lint: any; check: any; renders: string[] }

/** Three bar clips of 5 s, a picture and 30 s of music, made by the fake generator; the facts are probed from the files. */
async function media(): Promise<{ sources: Record<string, string>; facts: Record<string, ComposeFacts> }> {
  const dir = mkdtempSync(join(tmpdir(), 've-golden-media-'));
  const generator = createFakeGenerator({ log: join(dir, 'fake.log') });
  const file = (name: string) => join(dir, name);
  await generator.image({ prompt: 'serum bottle', references: [], aspect: '9:16' }, file('serum.png'), () => {});
  for (const clip of ['a', 'b', 'c']) await generator.clip({ mode: 'first-frame', firstFrame: file('serum.png'), prompt: `clip ${clip}`, seconds: 5, tier: TIER }, file(`${clip}.mp4`), () => {});
  await generator.music({ prompt: 'a quiet beat' }, file('beat.mp3'), () => {});
  const picture = probe(file('serum.png'));
  const facts: Record<string, ComposeFacts> = {
    serum: { frames: 0, audio: false, width: picture.width, height: picture.height },
    beat: { frames: Math.floor(probe(file('beat.mp3')).seconds * FPS), audio: true },
  };
  for (const clip of ['a', 'b', 'c']) { const p = probe(file(`${clip}.mp4`)); facts[clip] = { frames: p.frames, audio: p.audio }; }
  return { sources: Object.fromEntries(['a.mp4', 'b.mp4', 'c.mp4', 'serum.png', 'beat.mp3'].map((name) => [`assets/${name}`, file(name)])), facts };
}

/** compose → write → lint → check at the rest frames → render `renders` times. */
function make(edit: Edit, facts: Record<string, ComposeFacts>, sources: Record<string, string>, renders: number): Made {
  const composition = compose(edit, facts);
  const dir = mkdtempSync(join(tmpdir(), 've-golden-'));
  writeComposition(dir, composition, sources);
  const lint = jsonOf(hyperframes(['lint', dir, '--json']).stdout);
  const at = composition.timeline.checkAt.map((frame) => String(frame / FPS)).join(',');
  const check = jsonOf(hyperframes(['check', dir, '--no-contrast', '--json', ...(at === '' ? [] : ['--at', at])]).stdout);
  mkdirSync(join(dir, 'out'), { recursive: true });
  const files = Array.from({ length: renders }, (_, i) => join(dir, 'out', `render-${i + 1}.mp4`));
  for (const output of files) {
    const run = hyperframes(['render', dir, '--fps', '30', '--quality', 'looks', '--workers', '4', '--output', output]);
    if (run.status !== 0) throw new Error(`render failed (${run.status}): ${run.stderr.slice(-2000)}\n${run.stdout.slice(-2000)}`);
  }
  return { dir, timeline: composition.timeline, lint, check, renders: files };
}

const findings = (report: any): string[] => [...(report.findings ?? []), ...(report.lint?.findings ?? []), ...(report.runtime?.findings ?? []), ...(report.layout?.findings ?? [])]
  .map((f: any) => `${f.severity}:${f.code}:${f.selector ?? f.elementId ?? ''}`);

/**
 * Every frame of a transition and the frame before it: each shot that can be read shows the source frame the table says
 * (`from + f − at`), and each of the two shots can be read at least once. Returns what was read, for the assertion message.
 */
function readTransition(timeline: Timeline, pictures: Map<number, Picture>, t: Timeline['transitions'][number]): { wrong: string[]; read: Record<string, number[]> } {
  const a = timeline.shots.findIndex((s) => s.id === t.from);
  const b = timeline.shots.findIndex((s) => s.id === t.to);
  const wrong: string[] = [];
  const read: Record<string, number[]> = { [t.from]: [], [t.to]: [] };
  for (const f of transitionFrames(t)) {
    for (const index of [a, b]) {
      const reading = readShot(timeline, pictures.get(f)!, index, f);
      const ok = showsExpected(reading);
      if (ok === null) continue;
      read[timeline.shots[index]!.id]!.push(f);
      if (!ok) wrong.push(`frame ${f}: ${timeline.shots[index]!.id} should show source frame ${reading!.source}: ${JSON.stringify(reading)}`);
    }
  }
  return { wrong, read };
}
/** The frame before the cut, the frames of the effect, and the cut frame itself. */
function transitionFrames(t: Timeline['transitions'][number]): number[] {
  return [...new Set([t.cut - 1, t.cut, ...Array.from({ length: t.for }, (_, i) => t.at + i)])].sort((x, y) => x - y);
}

const dark = (r: number, g: number, b: number) => Math.max(r, g, b) < 50;                 // the ring outline of a text
const yellow = (r: number, g: number, b: number) => r > 190 && g > 170 && b < 110;         // the active caption word
const red = (r: number, g: number, b: number) => r > 100 && g < 80 && b < 80;              // the picture of the fake generator's first request

describe.skipIf(!available)('golden: the short document of the design, 720×1280', () => {
  let made: Made;
  let facts: Probe;
  let pictures: Map<number, Picture>;

  beforeAll(async () => {
    const { sources, facts: mediaFacts } = await media();
    // the design's only text starts on frame 0, where nothing can be seen before it: a second one starts later
    const edit = shortEdit(720);
    edit.texts!.push({ id: 'later', at: 130, for: 40, box: { left: 10, top: 30, right: 80, bottom: 38 }, style: 'hook', copy: 'Week three' });
    made = make(edit, mediaFacts, sources, 2);
    facts = probe(made.renders[0]!);
    const { timeline } = made;
    const wanted = [
      ...timeline.transitions.flatMap((t) => [...transitionFrames(t), t.at + t.for]),
      ...timeline.texts.flatMap((t) => [t.at - 1, t.rest.at, t.rest.at + Math.floor(t.rest.for / 2), t.rest.at + t.rest.for - 1, t.at + t.for]),
      ...timeline.captions.flatMap((c) => [c.at - 1, c.rest.at, c.rest.at + c.rest.for - 1, c.at + c.for, ...c.words.flatMap((w) => [w.at - 1, w.at])]),
      ...timeline.cards.flatMap((c) => [c.at - 1, c.rest.at, c.rest.at + c.rest.for - 1, c.at + c.for]),
    ].filter((f) => f >= 0 && f < timeline.frames);
    pictures = decode(made.renders[0]!, timeline.width, timeline.height, wanted);
  }, SLOW);

  it('passes lint without an error and the check on its rest frames', () => {
    expect(made.lint.errorCount).toBe(0);
    expect(findings(made.lint)).toEqual([]);
    expect(made.check.ok).toBe(true);
    expect(findings(made.check)).toEqual([]);
    expect(made.check.layout.samples.map((s: number) => Math.round(s * FPS))).toEqual(made.timeline.checkAt);
  });

  it('renders 720×1280 at 30 fps, exactly `frames` frames, with a sound stream', () => {
    expect(facts).toMatchObject({ width: 720, height: 1280, fps: '30/1', frames: made.timeline.frames, audio: true });
  });

  it('shows the right source frame on both sides of every cut, and of both shots inside every overlap', () => {
    for (const t of made.timeline.transitions) {
      const { wrong, read } = readTransition(made.timeline, pictures, t);
      expect(wrong, `${t.kind} at ${t.cut}`).toEqual([]);
      expect(read[t.from], `${t.from} before the ${t.kind} at ${t.cut}`).toContain(t.cut - 1);        // the frame before the cut: the outgoing shot
      expect(read[t.to]!.length, `${t.to} inside the ${t.kind} at ${t.cut}`).toBeGreaterThanOrEqual(1);
      expect(Math.min(...read[t.to]!)).toBeLessThan(t.cut + Math.max(1, t.for));                       // the incoming shot, on a frame of the transition
    }
    // a crossfade shows the incoming shot's `from` on the cut frame itself, at 1/16 of its opacity
    const crossfade = made.timeline.transitions.find((t) => t.kind === 'crossfade')!;
    const first = readShot(made.timeline, pictures.get(crossfade.cut)!, made.timeline.shots.findIndex((s) => s.id === crossfade.to), crossfade.cut)!;
    expect(first.source).toBe(made.timeline.shots.find((s) => s.id === crossfade.to)!.from);
    expect(showsExpected(first)).toBe(true);
    // and the reader of the frame bar itself agrees, on the first frame on which the incoming shot is alone and not yet scaled
    const alone = crossfade.at + crossfade.for;
    const incoming = made.timeline.shots.find((s) => s.id === crossfade.to)!;
    expect(readBar(pictures.get(alone)!.rgb, 720, 1280)).toBe(incoming.from + (alone - incoming.at));
  });

  it('shows each text line only on its frames: absent before and after, solid on its rest', () => {
    expect(made.timeline.texts.filter((line) => line.at > 0).map((line) => [line.element, line.at])).toEqual([['later-1', 130]]);     // "absent on at − 1" is asserted for it
    for (const line of made.timeline.texts) {
      const ink = (f: number) => count(pictures.get(f)!, line.rect, dark).n;
      const rest = [line.rest.at, line.rest.at + Math.floor(line.rest.for / 2), line.rest.at + line.rest.for - 1].map(ink);
      if (line.at > 0) expect(ink(line.at - 1), `${line.element} on frame ${line.at - 1}`).toBe(0);
      expect(ink(line.at + line.for), `${line.element} on frame ${line.at + line.for}`).toBe(0);
      expect(Math.min(...rest), `${line.element} at rest: ${rest.join(', ')}`).toBeGreaterThan(300);
      expect(Math.max(...rest) / Math.min(...rest)).toBeLessThan(1.15);
    }
  });

  it('shows each caption group on its frames, and moves the active word on the frame the table says', () => {
    const { captions } = made.timeline;
    const box = captions[0]!.rect;
    expect(count(pictures.get(captions[0]!.at - 1)!, box, dark).n).toBe(0);
    expect(count(pictures.get(captions.at(-1)!.at + captions.at(-1)!.for)!, box, dark).n).toBe(0);
    for (const group of captions) {
      for (const f of [group.rest.at, group.rest.at + group.rest.for - 1]) {
        expect(count(pictures.get(f)!, box, dark).n, `${group.element} on frame ${f}`).toBeGreaterThan(300);
        expect(count(pictures.get(f)!, box, yellow).n, `${group.element} active word on frame ${f}`).toBeGreaterThan(100);
      }
    }
    // NEVER (line 1) → LOOKED (line 2, left) → SO (line 2, right)
    const [never, looked, so] = captions[0]!.words;
    const active = (f: number) => count(pictures.get(f)!, box, yellow);
    expect(active(looked!.at).cy - active(looked!.at - 1).cy).toBeGreaterThan(captions[0]!.size * 0.8);
    expect(active(so!.at).cx - active(so!.at - 1).cx).toBeGreaterThan(captions[0]!.size);
    expect(Math.abs(active(so!.at - 1).cy - active(looked!.at).cy)).toBeLessThan(6);
    expect(never!.at).toBe(captions[0]!.at);
  });

  it('shows the card on its frames only', () => {
    for (const card of made.timeline.cards) {
      const middle = { x: card.rect.x + Math.floor(card.rect.width / 4), y: card.rect.y + Math.floor(card.rect.height / 4), width: Math.floor(card.rect.width / 2), height: 40 };
      const seen = (f: number) => count(pictures.get(f)!, middle, red).n / (middle.width * middle.height);
      expect(seen(card.at - 1)).toBe(0);
      expect(seen(card.rest.at)).toBeGreaterThan(0.9);
      expect(seen(card.rest.at + card.rest.for - 1)).toBeGreaterThan(0.9);
      expect(seen(card.at + card.for)).toBe(0);
    }
  });

  it('renders the same frames twice (ffmpeg -f framemd5)', () => {
    const [first, second] = made.renders.map(frameMd5);
    expect(first).toHaveLength(made.timeline.frames);
    expect(second).toEqual(first);
  });
});

/** Five shots joined by a crossfade, a push, a zoom and a plain cut; no motion on the shots, so a bar is where its clip put it. */
function transitionsEdit(): Edit {
  return {
    version: 1, language: 'en', canvas: { width: 720, height: 1280, fps: 30 }, frames: 180,
    media: { a: { file: 'assets/a.mp4', kind: 'video' }, b: { file: 'assets/b.mp4', kind: 'video' }, c: { file: 'assets/c.mp4', kind: 'video' } },
    shots: [
      { id: 's1', at: 0, for: 40, media: 'a' },
      { id: 's2', at: 40, for: 40, media: 'b', from: 15, in: { kind: 'crossfade' } },      // 15: its bar never stands on the bar of s1
      { id: 's3', at: 80, for: 40, media: 'c', from: 30, in: { kind: 'push', to: 'left' } },
      { id: 's4', at: 120, for: 30, media: 'a', from: 70, in: { kind: 'zoom' } },
      { id: 's5', at: 150, for: 30, media: 'b', from: 100 },
    ],
  };
}

describe.skipIf(!available)('golden: a crossfade, a push, a zoom and a cut, 720×1280', () => {
  let made: Made;
  let pictures: Map<number, Picture>;

  beforeAll(async () => {
    const { sources, facts } = await media();
    made = make(transitionsEdit(), facts, sources, 1);
    pictures = decode(made.renders[0]!, made.timeline.width, made.timeline.height, made.timeline.transitions.flatMap(transitionFrames));
  }, SLOW);

  it('passes lint and check, and renders every frame without a sound stream', () => {
    expect(made.lint.errorCount).toBe(0);
    expect(made.check.ok).toBe(true);
    expect(probe(made.renders[0]!)).toMatchObject({ width: 720, height: 1280, fps: '30/1', frames: 180, audio: false });
  });

  it('keeps both sources right inside each overlap, and around the zoom', () => {
    expect(made.timeline.transitions.map((t) => [t.kind, t.at, t.for, t.overlap])).toEqual([['crossfade', 40, 8, true], ['push', 80, 10, true], ['zoom', 116, 8, false], ['cut', 150, 0, false]]);
    for (const t of made.timeline.transitions) {
      const { wrong, read } = readTransition(made.timeline, pictures, t);
      expect(wrong, `${t.kind} at ${t.cut}`).toEqual([]);
      expect(read[t.from], `${t.from} on the frame before the ${t.kind}`).toContain(t.cut - 1);
      if (t.kind !== 'push') expect(read[t.to], `${t.to} on the cut frame of the ${t.kind}`).toContain(t.cut);   // a pushed shot starts off screen
      if (t.kind === 'cut') continue;
      const inside = (id: string) => read[id]!.filter((f) => f >= t.at && f < t.at + t.for);
      // a crossfade shows both on every frame; in a push each shot is partly off screen; around a zoom one shot is on screen at a time
      const least = t.kind === 'crossfade' ? t.for : t.kind === 'push' ? 4 : 3;
      expect(inside(t.from).length, `${t.from} inside the ${t.kind}: ${read[t.from]}`).toBeGreaterThanOrEqual(least);
      expect(inside(t.to).length, `${t.to} inside the ${t.kind}: ${read[t.to]}`).toBeGreaterThanOrEqual(least);
    }
  });

  it('cuts on the frame: the reader of the frame bar itself sees the last frame of one clip, then the first of the next', () => {
    const cut = made.timeline.transitions.find((t) => t.kind === 'cut')!;
    const [before, after] = [cut.from, cut.to].map((id) => made.timeline.shots.find((s) => s.id === id)!);
    expect(readBar(pictures.get(cut.cut - 1)!.rgb, 720, 1280)).toBe(before!.from + (cut.cut - 1 - before!.at));
    expect(readBar(pictures.get(cut.cut)!.rgb, 720, 1280)).toBe(after!.from);
    expect([before!.from + (cut.cut - 1 - before!.at), after!.from]).toEqual([99, 100]);
  });
});
