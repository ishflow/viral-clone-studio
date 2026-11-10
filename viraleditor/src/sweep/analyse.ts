// Reads every frame of one render and compares it with timeline.json, the promise. One pass over the file collects the numbers
// of every frame (pixel samples against the predicted colour, the frame bar, the mass of every text line, caption group,
// active word and card); the judging happens after the pass, on the arrays.
import type { Picture } from '../compose/golden-helpers.ts';
import { readShot, showsExpected } from '../compose/golden-helpers.ts';
import { valueAt } from '../compose/testing.ts';
import type { Timeline } from '../edit/timeline.ts';
import type { Edit } from '../edit/types.ts';
import { extent, green, grow, magenta, measure, median, patch90, red, streamFrames } from './frames.ts';
import type { Box } from './frames.ts';
import { edgesOf } from './edges.ts';
import type { Edge } from './edges.ts';
import { CARDS } from './media.ts';
import type { Rgb, SweepMedia } from './media.ts';
import { hexRgb, pictureColour, place, predict, windowOf } from './model.ts';
import { captionWords } from './words.ts';
import type { WordReading } from './words.ts';

export interface Wrong { kind: string; frame: number; element: string; promise: string; shows: string }
export interface Analysis {
  frames: number; wrong: Wrong[];
  read: number;               // frames on which the picture was judged (colour samples, frame bar)
  byBar: number;              // of those: a frame bar of a shot was read and agreed
  byColourOnly: number;       // frames with footage on screen on which only the colour code could be read (bar unreadable: zoomed, windowed, blended, none in the clip)
  unreadable: number;         // frames that could not be judged at all
  elements: number;           // shots, texts, caption groups, cards, windows checked
  samples: number[][];        // the colour samples of every frame, to compare two renders by position
  notes: string[];
  sharpness: Record<string, { frame: number; opacity: number; sharp: number }[]>;   // solid ink of a text line (1 = as at rest) on every frame it is at least a quarter as dark as at rest
  edges: Edge[];              // enter / exit of 3 frames or more of every text line and card: where the ink crosses half, against the promise
  words: WordReading;         // the caption word judge: frames read, frames judged, what was not judged
  restSpread: Record<string, number>;   // per text line: the largest share by which its ink at rest differs from its median at rest
}
/** A text at rest whose ink differs from its median at rest by more than this share is wrong on that frame. */
export const REST_TOLERANCE = 0.005;
/** An edge of an enter or exit further than this (frames) from the promise is a wrong frame. */
export const EDGE_TOLERANCE = 0.5;

const SAMPLE_X = [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9];
const SAMPLE_Y = [0.04, 0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.96];
const TOLERANCE = 16;
const wrongAt = (list: Wrong[], kind: string, frame: number, element: string, promise: string, shows: string) => { list.push({ kind, frame, element, promise, shows }); };
const fixed = (n: number) => (Math.round(n * 100) / 100).toString();
const rgbText = (c: ArrayLike<number>) => `[${Math.round(c[0]!)},${Math.round(c[1]!)},${Math.round(c[2]!)}]`;

/** How far an element's animations carry it off its box (px): slides, and three times the blur radius. */
function reach(t: Timeline, element: string): { dx: number; dy: number } {
  let dx = 6; let dy = 6;
  for (const a of t.animations) {
    if (a.element !== element) continue;
    const v = Math.max(Math.abs(a.from), Math.abs(a.to));
    if (a.property === 'x') dx += v;
    if (a.property === 'y') dy += v;
    if (a.property === 'blur') { dx += 3 * v; dy += 3 * v; }
  }
  return { dx, dy };
}
const rectOf = (r: { x: number; y: number; width: number; height: number }): Box => ({ x: r.x, y: r.y, width: r.width, height: r.height });

export async function analyse(rendered: { timeline: Timeline; edit: Edit }, media: SweepMedia, file: string): Promise<Analysis> {
  const t = rendered.timeline;
  const F = t.frames;
  const background: Rgb = hexRgb(rendered.edit.background ?? '#000000');
  const wrong: Wrong[] = [];
  const notes: string[] = [];
  const sharpness: Analysis['sharpness'] = {};
  const edges: Edge[] = [];
  const restSpread: Record<string, number> = {};
  // the picture under the captions (the caption documents put them on flat pictures): its colour at the centre of the caption rect
  const capCentre = t.captions[0] ? [Math.round(t.captions[0].rect.x + t.captions[0].rect.width / 2), Math.round(t.captions[0].rect.y + t.captions[0].rect.height / 2)] as const : null;
  const words = captionWords(t, rendered.edit, wrong, (f) => (capCentre ? predict(t, media, background, f, capCentre[0], capCentre[1]) : null) ?? background);

  // ── what to measure ──
  const textRects = t.texts.map((x) => { const r = reach(t, x.element); return grow(rectOf(x.rect), r.dx + 24, r.dy); });
  const capRects = t.captions.map((g) => grow(rectOf(g.rect), 0.05 * t.width, 12));
  const capUnion: Box | null = capRects.length === 0 ? null : (() => {
    const x0 = Math.min(...capRects.map((r) => r.x)); const y0 = Math.min(...capRects.map((r) => r.y));
    return { x: x0, y: y0, width: Math.max(...capRects.map((r) => r.x + r.width)) - x0, height: Math.max(...capRects.map((r) => r.y + r.height)) - y0 };
  })();
  const activeKind = rendered.edit.captions?.active?.kind ?? (rendered.edit.captions ? 'colour' : 'none');
  const activeWeight = activeKind === 'pill' ? magenta : activeKind === 'colour' ? green : null;
  const cardPatches = t.cards.map((c) => ({ cx: Math.round(c.rect.x + c.rect.width / 2), cy: Math.round(c.rect.y + c.rect.height / 2) }));
  const cardRects = t.cards.map((c) => grow(rectOf(c.rect), 16, 16));
  const avoid: Box[] = [...textRects, ...(capUnion ? [capUnion] : []), ...cardRects].map((b) => grow(b, 30, 30));
  const points: [number, number][] = [];
  for (const fx of SAMPLE_X) for (const fy of SAMPLE_Y) {
    const x = Math.round(fx * t.width); const y = Math.round(fy * t.height);
    if (!avoid.some((b) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height)) points.push([x, y]);
  }

  // ── the pass ──
  const samples: number[][] = [];
  const bar: (boolean | null)[][] = [];                       // per frame, per shot: the frame bar agrees / disagrees / cannot be read
  const barEligible: boolean[] = [];
  const text = t.texts.map(() => ({ mass: new Float64Array(F), solid: new Float64Array(F), cx: new Float64Array(F), cy: new Float64Array(F) }));
  const cap = { mass: new Float64Array(F), amass: new Float64Array(F), acx: new Float64Array(F), acy: new Float64Array(F) };
  const card = t.cards.map(() => ({ p: new Float64Array(F), box: [] as ({ x0: number; x1: number; y0: number; y1: number } | null)[] }));
  const wRows = t.windows.map(() => ({ row: [] as (number | null)[][] }));

  const count = await streamFrames(file, t.width, t.height, (f, p: Picture) => {
    const row: number[] = [];
    for (const [x, y] of points) { const i = (y * t.width + x) * 3; row.push(p.rgb[i]!, p.rgb[i + 1]!, p.rgb[i + 2]!); }
    samples.push(row);
    if (f >= F) return;
    words.take(f, p);
    const visible = t.shots.map((s, i) => ({ s, i })).filter(({ s }) => f >= s.at && f < s.at + s.for + s.tail);
    const windowed = t.windows.some((w) => f >= w.at && f < w.at + w.for);
    const flat = visible.every(({ s }) => place(t, s, f).scale < 1.02);
    const fx = t.transitions.some((tr) => tr.colour !== null && valueAt(t, `${tr.to}-fx`, 'opacity', f, 0) > 0.02);
    barEligible[f] = flat && !windowed && !fx;
    bar[f] = t.shots.map((s, i) => (s.kind === 'video' && media.bars.has(s.media) && visible.some((v) => v.i === i) && barEligible[f] ? showsExpected(readShot(t, p, i, f)) : null));
    t.texts.forEach((x, k) => {
      const o = valueAt(t, x.element, 'opacity', f, 1);
      const m = measure(p, textRects[k]!, red, false, 0.85 * Math.min(1, Math.max(o, 0.05)));
      text[k]!.mass[f] = m.mass; text[k]!.solid[f] = m.solid; text[k]!.cx[f] = m.cx; text[k]!.cy[f] = m.cy;
    });
    if (capUnion) {
      cap.mass[f] = measure(p, capUnion, (r, g, b) => red(r, g, b) + (activeWeight ? activeWeight(r, g, b) : 0)).mass;
      if (activeWeight) { const m = measure(p, capUnion, activeWeight); cap.amass[f] = m.mass; cap.acx[f] = m.cx; cap.acy[f] = m.cy; }
    }
    t.cards.forEach((_, k) => {
      card[k]!.p[f] = patch90(p, cardPatches[k]!.cx, cardPatches[k]!.cy, 12, red);
      card[k]!.box.push(extent(p, cardRects[k]!, red, 0.5));
    });
    t.windows.forEach((w, k) => {
      const shot = t.shots.find((s) => s.id === w.shot)!;
      wRows[k]!.row.push(f < w.at || f >= w.at + w.for ? [null] : scanWindow(t, media, p, shot, f));
    });
  });
  if (count !== F) wrongAt(wrong, 'frames', count, '-', `${F} frames`, `${count} frames in the file`);

  // ── judge: the picture, by colour samples and frame bar ──
  let read = 0; let byBar = 0; let byColourOnly = 0; let unreadable = 0;
  for (let f = 0; f < Math.min(F, count); f++) {
    let judged = 0; let match = 0; let firstBad = -1;
    points.forEach(([x, y], i) => {
      const want = predict(t, media, background, f, x, y);
      if (want === null) return;
      judged++;
      const got = samples[f]!.slice(i * 3, i * 3 + 3);
      if (Math.max(...want.map((c, k) => Math.abs(c - got[k]!))) <= TOLERANCE) match++;
      else if (firstBad < 0) firstBad = i;
    });
    const barVotes = bar[f]!.filter((v) => v !== null) as boolean[];
    const footage = t.shots.some((s) => s.kind === 'video' && f >= s.at && f < s.at + s.for + s.tail);
    if (judged >= 4 && match / judged < 0.75) {
      const [x, y] = points[firstBad]!;
      const want = predict(t, media, background, f, x, y)!;
      wrongAt(wrong, 'shot', f, 'picture', `${match}/${judged} sample points at ${rgbText(want)} (first at ${x},${y})`, `${rgbText(samples[f]!.slice(firstBad * 3, firstBad * 3 + 3))}; ${judged - match} of ${judged} points off`);
    }
    if (barVotes.some((v) => !v)) {
      const s = t.shots[bar[f]!.findIndex((v) => v === false)]!;
      wrongAt(wrong, 'shot-bar', f, s.id, `source frame ${s.from + f - s.at} of ${s.media} (frame bar)`, 'the frame bar names another source frame (or none)');
    }
    if (judged < 4 && barVotes.length === 0) unreadable++;
    else { read++; if (barVotes.some((v) => v)) byBar++; else if (footage) byColourOnly++; }
  }

  // ── judge: texts ──
  t.texts.forEach((row, k) => {
    const d = text[k]!;
    const restFrames = Array.from({ length: row.rest.for }, (_, i) => row.rest.at + i);
    if (restFrames.length === 0) { notes.push(`text ${row.element}: no rest frame, not judged`); return; }
    const M = median(restFrames.map((f) => d.mass[f]!));
    const S = median(restFrames.map((f) => (d.mass[f]! > 0 ? d.solid[f]! / d.mass[f]! : 0)));
    const cx0 = median(restFrames.map((f) => d.cx[f]!)); const cy0 = median(restFrames.map((f) => d.cy[f]!));
    if (M < 200) { wrongAt(wrong, 'text', row.rest.at, row.element, `ink at rest (copy "${row.copy}")`, `mass ${fixed(M)}: no text`); return; }
    // at rest a text does not change: its ink stays within REST_TOLERANCE of the median of the rest frames that have the same
    // picture under it (a letter partly lost shows here). The chroma of the video bleeds between a letter's edge and the picture
    // under it, so the ink is only compared over one and the same flat picture; rest frames over footage that changes, or
    // near an edge of the picture, are not judged here.
    let restDev = 0;
    const cx = Math.round(row.rect.x + row.rect.width / 2); const cy = Math.round(row.rect.y + row.rect.height / 2);
    const byPicture = new Map<string, number[]>();
    for (const f of restFrames) {
      const under = predict(t, media, background, f, cx, cy);
      if (under) byPicture.set(rgbText(under), [...(byPicture.get(rgbText(under)) ?? []), f]);
    }
    for (const frames of byPicture.values()) {
      if (frames.length < 3) continue;
      const m = median(frames.map((f) => d.mass[f]!));
      for (const f of frames) {
        const dev = Math.abs(d.mass[f]! / m - 1);
        restDev = Math.max(restDev, dev);
        if (dev > REST_TOLERANCE) wrongAt(wrong, 'text-rest', f, row.element, `at rest: ink as on its other rest frames over the same picture (within ${REST_TOLERANCE * 100} %)`, `ink ${fixed(d.mass[f]! / m)} of their median`);
      }
    }
    restSpread[row.element] = Math.round(restDev * 10000) / 10000;
    const promised = (f: number) => valueAt(t, row.element, 'opacity', f, 1) * valueAt(t, row.element, 'scale', f, 1) ** 2;
    edges.push(...edgesOf(row, F, (f) => d.mass[f]! / M, promised));
    const hasBlur = t.animations.some((a) => a.element === row.element && a.property === 'blur');
    const hasScale = t.animations.some((a) => a.element === row.element && a.property === 'scale');
    for (let f = Math.max(0, row.at - 3); f < Math.min(F, row.at + row.for + 3); f++) {
      const on = f >= row.at && f < row.at + row.for;
      const want = on ? valueAt(t, row.element, 'opacity', f, 1) * valueAt(t, row.element, 'scale', f, 1) ** 2 : 0;
      const got = d.mass[f]! / M;
      if (!on ? got > 0.12 : Math.abs(got - want) > 0.2) wrongAt(wrong, 'text', f, row.element, `${on ? 'on' : 'off'}, ink ${fixed(want)} of rest`, `ink ${fixed(got)} of rest`);
      if (on && got > 0.25) {
        const dx = valueAt(t, row.element, 'x', f, 0); const dy = valueAt(t, row.element, 'y', f, 0);
        if (Math.abs(d.cx[f]! - cx0 - dx) > 6 || Math.abs(d.cy[f]! - cy0 - dy) > 6) wrongAt(wrong, 'text-move', f, row.element, `centre moved by (${fixed(dx)}, ${fixed(dy)}) px`, `moved by (${fixed(d.cx[f]! - cx0)}, ${fixed(d.cy[f]! - cy0)})`);
        const sharp = d.solid[f]! / d.mass[f]! / S;   // share of the ink that is as dark as a flat fill at this opacity; a blur wears the strokes down, a fade does not
        const blurPx = valueAt(t, row.element, 'blur', f, 0);
        (sharpness[row.element] ??= []).push({ frame: f, opacity: Math.round(got * 100) / 100, sharp: Math.round(sharp * 100) / 100 });
        if (hasBlur && blurPx >= 8 && sharp > 0.85) wrongAt(wrong, 'text-blur', f, row.element, `blurred by ${fixed(blurPx)} px (8 px or more): solid ink under 0.85 of rest`, `solid ink ${fixed(sharp)} of rest (a fade, not a blur)`);
        if (!hasBlur && !hasScale && sharp < 0.85) wrongAt(wrong, 'text-blur', f, row.element, 'not blurred: solid ink 0.85 or more of rest', `solid ink ${fixed(sharp)}`);
      }
    }
  });

  // ── judge: captions ──
  if (capUnion) {
    const groups = t.captions;
    const restMass = groups.map((g) => Array.from({ length: g.rest.for }, (_, i) => cap.mass[g.rest.at + i]!));
    const lo = restMass.map((m) => (m.length ? Math.min(...m) : 0)); const hi = restMass.map((m) => (m.length ? Math.max(...m) : 0));
    const top = Math.max(...hi, 1);
    const pillMax = activeKind === 'pill' ? Math.max(...cap.amass) : 0;      // a pill counts as ink and is as large as its word: rest frames show only some of them
    for (let f = Math.max(0, Math.min(...groups.map((g) => g.at)) - 3); f < Math.min(F, Math.max(...groups.map((g) => g.at + g.for)) + 3); f++) {
      // the mass of a group depends on which word is active (a pill is as wide as its word): the promise is a bracket
      let low = 0; let high = 0;
      groups.forEach((g, i) => {
        if (f >= g.at && f < g.at + g.for) { const r = valueAt(t, g.element, 'opacity', f, 1) * valueAt(t, g.element, 'scale', f, 1) ** 2; low += lo[i]! * r; high += (hi[i]! + pillMax) * r; }
      });
      const m = cap.mass[f]!;
      if (m < low - 0.12 * top || m > high + 0.12 * top) wrongAt(wrong, 'caption', f, 'captions', `ink ${fixed(low / top)}…${fixed(high / top)} of the largest group`, `ink ${fixed(m / top)}`);
    }
    if (activeWeight) {
      const activeAt = (f: number): { g: number; w: number } | null => {
        for (let g = 0; g < groups.length; g++) for (const w of groups[g]!.words) if (f >= w.at && f < w.at + w.for) return { g, w: w.index };
        return null;
      };
      const inRest = (f: number, g: number) => f >= groups[g]!.rest.at && f < groups[g]!.rest.at + groups[g]!.rest.for;
      const typical = median(Array.from({ length: F }, (_, f) => f).filter((f) => { const a = activeAt(f); return a !== null && inRest(f, a.g); }).map((f) => cap.amass[f]!));
      let prev: { f: number; id: string } | null = null;
      for (let f = 0; f < F; f++) {
        const a = activeAt(f);
        const r = a ? valueAt(t, groups[a.g]!.element, 'opacity', f, 1) : 0;
        if (a && r >= 0.3 && cap.amass[f]! < 0.35 * typical * r) wrongAt(wrong, 'caption-word', f, `${groups[a.g]!.element}-w${a.w}`, 'word active', `no active colour (mass ${fixed(cap.amass[f]! / typical)} of typical)`);
        if (!a && cap.amass[f]! > 0.08 * typical) wrongAt(wrong, 'caption-word', f, 'captions', 'no word active', `active colour present (mass ${fixed(cap.amass[f]! / typical)} of typical)`);
        const rest = a !== null && inRest(f, a.g);
        const id = a ? `${a.g}.${a.w}` : '';
        if (a && rest && prev && prev.f === f - 1) {
          const moved = Math.hypot(cap.acx[f]! - cap.acx[f - 1]!, cap.acy[f]! - cap.acy[f - 1]!);
          if (prev.id === id && moved > 3) wrongAt(wrong, 'caption-word', f, `word ${id}`, 'same word as the frame before: active mark stays', `mark moved ${fixed(moved)} px`);
          if (prev.id !== id && moved < 3) wrongAt(wrong, 'caption-word', f, `word ${id}`, `word ${prev.id} → ${id}: mark moves`, `mark moved ${fixed(moved)} px`);
        }
        prev = a && rest ? { f, id } : null;
      }
    }
  }

  // ── judge: cards ──
  t.cards.forEach((c, k) => {
    const d = card[k]!;
    for (let f = Math.max(0, c.at - 3); f < Math.min(F, c.at + c.for + 3); f++) {
      const on = f >= c.at && f < c.at + c.for;
      const want = on ? valueAt(t, c.element, 'opacity', f, 1) * valueAt(t, `${c.id}-box`, 'opacity', f, 1) : 0;
      if (Math.abs(d.p[f]! - want) > 0.2) wrongAt(wrong, 'card', f, c.element, `${on ? 'on' : 'off'}, opacity ${fixed(want)}`, `opacity ${fixed(d.p[f]!)}`);
    }
    edges.push(...edgesOf(c, F, (f) => d.p[f]!, (f) => valueAt(t, c.element, 'opacity', f, 1) * valueAt(t, `${c.id}-box`, 'opacity', f, 1)));
    const spec = rendered.edit.cards?.find((x) => x.id === c.id);
    const info = CARDS[c.media];
    if (spec && info && !spec.motion) {
      const fit = spec.fit ?? 'contain';
      const s = fit === 'contain' ? Math.min(c.rect.width / info.width, c.rect.height / info.height) : Math.max(c.rect.width / info.width, c.rect.height / info.height);
      const w = Math.min(c.rect.width, info.width * s); const h = Math.min(c.rect.height, info.height * s);
      const want = { x0: c.rect.x + (c.rect.width - w) / 2, x1: c.rect.x + (c.rect.width + w) / 2, y0: c.rect.y + (c.rect.height - h) / 2, y1: c.rect.y + (c.rect.height + h) / 2 };
      for (let i = 0; i < c.rest.for; i++) {
        const f = c.rest.at + i; const got = d.box[f];
        if (!got || [got.x0 - want.x0, got.x1 - want.x1, got.y0 - want.y0, got.y1 - want.y1].some((v) => Math.abs(v) > 4)) wrongAt(wrong, 'card-box', f, c.element, `picture at x ${fixed(want.x0)}…${fixed(want.x1)}, y ${fixed(want.y0)}…${fixed(want.y1)} (${fit})`, got ? `x ${got.x0}…${got.x1}, y ${got.y0}…${got.y1}` : 'no picture');
      }
    }
  });

  // ── judge: windows (edges of the window along its centre row and column) ──
  t.windows.forEach((w, k) => {
    for (let f = w.at; f < Math.min(F, w.at + w.for); f++) {
      const got = wRows[k]!.row[f]!;
      const win = windowOf(t, media, t.shots.find((s) => s.id === w.shot)!, f);
      if (!win || got[0] === null) continue;
      const want = [win.rect[0], win.rect[2], win.rect[1], win.rect[3]];
      if (got.some((v, i) => v === -1 || Math.abs(v! - want[i]!) > 3.5)) wrongAt(wrong, 'window', f, w.shot, `window edges l/r/t/b ${want.map(fixed).join('/')} (progress ${fixed(win.p)})`, `edges ${got.join('/')}`);
    }
  });

  // ── judge: the frame of every faded edge (to a fraction of a frame) ──
  for (const e of edges) {
    if (e.error === null || Math.abs(e.error) > EDGE_TOLERANCE) {
      const kind = t.cards.some((c) => c.element === e.element) ? 'card-edge' : 'text-edge';
      wrongAt(wrong, kind, Math.round(e.promise ?? 0), e.element, `${e.side} (${e.frames} frames) crosses half its ink at frame ${e.promise}`, e.shows === null ? 'never crosses half' : `at frame ${e.shows} (${e.error! > 0 ? '+' : ''}${e.error} frames)`);
    }
  }
  notes.push(...words.reading.notes);

  const elements = t.shots.length + t.texts.length + t.captions.length + t.cards.length + t.windows.length;
  return { frames: count, wrong, read, byBar, byColourOnly, unreadable, elements, samples, notes, sharpness, edges, words: words.reading, restSpread };
}

/** Left, right, top and bottom edge (pixels) of the run of the shot's colour through the predicted window centre; -1 when there is none. */
function scanWindow(t: Timeline, media: SweepMedia, p: Picture, shot: Timeline['shots'][number], f: number): (number | null)[] {
  const win = windowOf(t, media, shot, f);
  if (!win) return [null];
  const colour = pictureColour(media, shot.media, shot.from, f, shot.at);
  const bars = media.bars.has(shot.media);          // the frame bar of a clip is white and crosses the scan line: it belongs to the picture
  const near = (x: number, y: number) => {
    const i = (y * p.width + x) * 3;
    if (bars && p.rgb[i]! > 20) return true;                  // every picture of the sweep has red 0: red is the bar, or its blurred edge
    return Math.abs(p.rgb[i]! - colour[0]) < 12 && Math.abs(p.rgb[i + 1]! - colour[1]) < 12 && Math.abs(p.rgb[i + 2]! - colour[2]) < 12;
  };
  const cx = Math.round((win.rect[0] + win.rect[2]) / 2); const cy = Math.round((win.rect[1] + win.rect[3]) / 2);
  if (cx < 0 || cx >= p.width || cy < 0 || cy >= p.height || !near(cx, cy)) return [-1, -1, -1, -1];
  let l = cx; while (l > 0 && near(l - 1, cy)) l--;
  let r = cx; while (r < p.width - 1 && near(r + 1, cy)) r++;
  let tp = cy; while (tp > 0 && near(cx, tp - 1)) tp--;
  let b = cy; while (b < p.height - 1 && near(cx, b + 1)) b++;
  return [l, r + 1, tp, b + 1];
}
