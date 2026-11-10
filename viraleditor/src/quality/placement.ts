// Where a shot's picture is on a frame of the render, read from the timeline: what the footage alone would show there.
import { EASINGS } from '../edit/presets.ts';
import type { Timeline } from '../edit/timeline.ts';
import type { Picture } from '../ports.ts';

type Row = Timeline['animations'][number];
type Shot = Timeline['shots'][number];

/** CSS cubic-bezier(x1, y1, x2, y2) at progress p. */
function bezier(x1: number, y1: number, x2: number, y2: number, p: number): number {
  const at = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i++) { const t = (low + high) / 2; if (at(t, x1, x2) < p) low = t; else high = t; }
  return at((low + high) / 2, y1, y2);
}
function eased(ease: Row['ease'], p: number): number {
  if (ease === 'step') return 1;
  const points = EASINGS[ease];
  return points ? bezier(points[0], points[1], points[2], points[3], p) : p;
}

/**
 * The value of an animated property of an element on frame `f` (design §7); `resting` where no row holds it. Rows apply in
 * order: a later one that is running or holding wins. A frame shows the value at its middle.
 */
export function valueOn(rows: Row[], element: string, property: Row['property'], f: number, resting: number): number {
  let value = resting;
  for (const row of rows) {
    if (row.element !== element || row.property !== property) continue;
    if (f < row.at) { if (row.hold === 'before' || row.hold === 'both') value = row.from; }
    else if (f >= row.at + row.for) { if (row.hold === 'after' || row.hold === 'both') value = row.to; }
    else value = row.from + (row.to - row.from) * eased(row.ease, (f - row.at + 0.5) / row.for);
  }
  return value;
}

export interface Plain { shot: Shot; source: number; scale: number }

/**
 * The one shot whose picture fills output frame `f` with nothing of the edit over or under it: no second shot (a transition
 * that overlaps), no transition effect, no window, and the shot itself not moved, faded or blurred. `source`: the frame of
 * its media that is shown (0 for an image); `scale`: the motion on the picture (push-in, pull-out, punch-in), around its focus.
 * null: no such shot on that frame.
 */
export function plainShot(timeline: Timeline, f: number): Plain | null {
  const on = timeline.shots.filter((s) => s.at <= f && f < s.at + s.for + s.tail);
  if (on.length !== 1) return null;
  const shot = on[0]!;
  if (timeline.transitions.some((t) => t.at <= f && f < t.at + t.for)) return null;
  if (timeline.windows.some((w) => w.shot === shot.id && w.at <= f && f < w.at + w.for)) return null;
  const is = (element: string, property: Row['property'], resting: number) => Math.abs(valueOn(timeline.animations, element, property, f, resting) - resting) < 1e-6;
  for (const element of [shot.id, shot.element]) {
    if (!is(element, 'x', 0) || !is(element, 'y', 0) || !is(element, 'opacity', 1) || !is(element, 'blur', 0)) return null;
  }
  if (!is(shot.id, 'scale', 1)) return null;
  return { shot, source: shot.kind === 'video' ? shot.from + (f - shot.at) : 0, scale: valueOn(timeline.animations, shot.element, 'scale', f, 1) };
}

/**
 * A source picture as the canvas shows it: covering the canvas (object-fit: cover) with the focus point kept
 * (object-position), then scaled around the focus. `focus`: percent of the width and of the height. Bilinear.
 */
export function placed(source: Picture, width: number, height: number, scale: number, focus: [number, number]): Picture {
  if (source.width === width && source.height === height && scale === 1) return source;
  const k = Math.max(width / source.width, height / source.height);
  const ox = ((width - source.width * k) * focus[0]) / 100;
  const oy = ((height - source.height * k) * focus[1]) / 100;
  const cx = (width * focus[0]) / 100;
  const cy = (height * focus[1]) / 100;
  const rgb = new Uint8Array(width * height * 3);
  const s = source.rgb;
  for (let y = 0; y < height; y++) {
    const v = Math.min(source.height - 1, Math.max(0, (((y + 0.5 - cy) / scale + cy - oy) / k) - 0.5));
    const v0 = Math.floor(v);
    const v1 = Math.min(source.height - 1, v0 + 1);
    const fv = v - v0;
    for (let x = 0; x < width; x++) {
      const u = Math.min(source.width - 1, Math.max(0, (((x + 0.5 - cx) / scale + cx - ox) / k) - 0.5));
      const u0 = Math.floor(u);
      const u1 = Math.min(source.width - 1, u0 + 1);
      const fu = u - u0;
      const a = (v0 * source.width + u0) * 3;
      const b = (v0 * source.width + u1) * 3;
      const c = (v1 * source.width + u0) * 3;
      const d = (v1 * source.width + u1) * 3;
      const i = (y * width + x) * 3;
      for (let ch = 0; ch < 3; ch++) {
        rgb[i + ch] = Math.round((s[a + ch]! * (1 - fu) + s[b + ch]! * fu) * (1 - fv) + (s[c + ch]! * (1 - fu) + s[d + ch]! * fu) * fv);
      }
    }
  }
  return { width, height, rgb };
}
