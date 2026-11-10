// What timeline.json promises about the colour of a pixel on a frame: a stack of shots (opacity, move, zoom), the effect layer
// of a flash or a dip, and the windows. The media of the sweep are flat colours (media.ts), so a pixel far from every edge has
// one predicted colour, and a frame that shows another source frame, another picture or another opacity has another one.
import { valueAt } from '../compose/testing.ts';
import type { Timeline } from '../edit/timeline.ts';
import { codeColour } from './media.ts';
import type { Rgb, SweepMedia } from './media.ts';

export const hexRgb = (hex: string): Rgb => [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
type Shot = Timeline['shots'][number];

export interface Placed { opacity: number; blur: number; scale: number; rect: [number, number, number, number] }
/** Where shot `shot` is on frame `f`: the picture scaled around the centre (motion on the media, zoom on the wrapper), then moved. */
export function place(t: Timeline, shot: Shot, f: number): Placed {
  const scale = valueAt(t, shot.element, 'scale', f, 1) * valueAt(t, shot.id, 'scale', f, 1);
  const dx = valueAt(t, shot.id, 'x', f, 0);
  const dy = valueAt(t, shot.id, 'y', f, 0);
  const map = (x: number, y: number): [number, number] => [t.width / 2 + scale * (x - t.width / 2) + dx, t.height / 2 + scale * (y - t.height / 2) + dy];
  const [l, tp] = map(0, 0);
  const [r, b] = map(t.width, t.height);
  return { opacity: valueAt(t, shot.id, 'opacity', f, 1), blur: valueAt(t, shot.id, 'blur', f, 0), scale, rect: [l, tp, r, b] };
}

/** The colour source frame / picture `media` shows on timeline frame `f`, for a picture that starts on `at` with source frame `from`. */
export function pictureColour(media: SweepMedia, key: string, from: number, f: number, at: number): Rgb {
  return media.clips.has(key) ? codeColour(from + f - at) : media.colours[key]!;
}

export interface WindowState { p: number; rect: [number, number, number, number]; behind: Rgb }
/** The window of `shot` on frame `f`: how far it has shrunk, where it is (edges move linearly from the frame to the rect), what is behind it. */
export function windowOf(t: Timeline, media: SweepMedia, shot: Shot, f: number): WindowState | null {
  const w = t.windows.find((x) => x.shot === shot.id && f >= x.at && f < x.at + x.for);
  if (!w) return null;
  const rows = t.animations.filter((a) => a.property === 'window' && (a.element === shot.id || a.element === shot.element));
  let p = 1;
  for (const row of rows) {
    if (f < row.at) { if (row.hold === 'before' || row.hold === 'both') p = row.from; }
    else if (f >= row.at + row.for) { if (row.hold === 'after' || row.hold === 'both') p = row.to; }
    else p = valueAt({ ...t, animations: [row] }, row.element, 'window', f, 1);
  }
  const lerp = (a: number, b: number) => a + (b - a) * p;
  const rect: [number, number, number, number] = [lerp(0, w.rect.x), lerp(0, w.rect.y), lerp(t.width, w.rect.x + w.rect.width), lerp(t.height, w.rect.y + w.rect.height)];
  const picture = w.pictures.find((x) => f >= x.at && f < x.at + x.for) ?? w.pictures[0]!;
  return { p, rect, behind: pictureColour(media, picture.behind, 0, f, picture.at) };
}

/** The colour of the pixel (x, y) on frame `f`, or null when it lies too near an edge for a flat prediction. */
export function predict(t: Timeline, media: SweepMedia, background: Rgb, f: number, x: number, y: number): Rgb | null {
  let out: number[] = [...background];
  const visible = t.shots.filter((s) => f >= s.at && f < s.at + s.for + s.tail);
  for (const shot of visible) {
    const placed = place(t, shot, f);
    const margin = 14 + 3 * placed.blur;
    const content = pictureColour(media, shot.media, shot.from, f, shot.at);
    const win = windowOf(t, media, shot, f);
    let rect = placed.rect;
    if (win) {
      out = [...win.behind];
      rect = win.rect;
    }
    const radius = win ? 0.06 * t.width * 0.45 : 0;                       // the corner zone of a rounded window is not read
    const [l, tp, r, b] = rect;
    const inside = x > l + margin + radius && x < r - margin - radius && y > tp + margin + radius && y < b - margin - radius;
    const outside = x < l - margin || x > r + margin || y < tp - margin || y > b + margin;
    if (!inside && !outside) return null;
    if (inside) out = out.map((c, i) => c * (1 - placed.opacity) + content[i]! * placed.opacity);
  }
  for (const tr of t.transitions) {
    if (tr.colour === null) continue;
    const o = valueAt(t, `${tr.to}-fx`, 'opacity', f, 0);
    if (o > 0) out = out.map((c, i) => c * (1 - o) + hexRgb(tr.colour!)[i]! * o);
  }
  return out as Rgb;
}
