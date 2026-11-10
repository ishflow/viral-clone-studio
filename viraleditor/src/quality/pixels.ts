// Pure pixel arithmetic for the text checks: which pixels are the text, what is around them, and how well they stand out.
import type { Picture } from '../ports.ts';
import { INK_DISTANCE, MATCH_DISTANCE, MATCH_RADIUS, RING_PIXELS, SOLID_MIN_SHARE } from './thresholds.ts';

export interface RectLike { x: number; y: number; width: number; height: number }
export interface Rgb { r: number; g: number; b: number }

export function parseColour(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 || h.length === 4 ? [...h].map((c) => c + c).join('') : h;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function toHex(c: Rgb): string {
  return `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance. */
export function luminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}
/** WCAG contrast ratio, 1 … 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface InkReading {
  area: number;                    // pixels in the rect (clipped to the picture)
  ink: number;                     // pixels close to the fill colour
  connected: number;               // of those, the ones with at least two ink neighbours (up, down, left, right): strokes and blocks count, scattered specks of footage mostly do not
  ring: number;                    // non-ink pixels within RING_PIXELS of ink
  solid: boolean;                  // enough of the ink is thick (3x3 all ink) to be letters; false: thin text, the ring was taken around all strokes
  contrast: number | null;         // median contrast of the ring pixels against the fill; null when there is no ring
}

/** Reads the rect of a picture: finds the ink, the ring around it, and the median contrast of the ring against the fill. */
export function readInk(picture: Picture, rect: RectLike, fill: Rgb): InkReading {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(picture.width, rect.x + rect.width);
  const y1 = Math.min(picture.height, rect.y + rect.height);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return { area: 0, ink: 0, connected: 0, ring: 0, solid: false, contrast: null };
  const near = new Uint8Array(w * h);
  let ink = 0;
  const limit = INK_DISTANCE * INK_DISTANCE;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * picture.width + x0 + x) * 3;
      const dr = picture.rgb[i]! - fill.r;
      const dg = picture.rgb[i + 1]! - fill.g;
      const db = picture.rgb[i + 2]! - fill.b;
      if (dr * dr + dg * dg + db * db <= limit) { near[y * w + x] = 1; ink++; }
    }
  }
  let connected = 0;
  const strokes = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!near[y * w + x]) continue;
      const n = (x > 0 ? near[y * w + x - 1]! : 0) + (x < w - 1 ? near[y * w + x + 1]! : 0) + (y > 0 ? near[(y - 1) * w + x]! : 0) + (y < h - 1 ? near[(y + 1) * w + x]! : 0);
      if (n >= 2) { connected++; strokes[y * w + x] = 1; }
    }
  }
  // Solid ink: pixels whose 3x3 neighbourhood is all ink. Specks of footage that happen to be near the fill colour (noise on a bright background) are not letters and must not own a ring.
  const solid = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (!near[(y + dy) * w + x + dx]) { all = 0; break; }
      solid[y * w + x] = all;
    }
  }
  // Thin text (strokes of 3 px or less) has almost no solid ink: then the ring is taken around the connected ink (strokes, not specks), grown by RING_PIXELS only.
  // "Almost": a share, not a count. On the larger canvas the same thin text has a few solid pixels where strokes meet, and a ring around those alone reads a spot, not the text.
  let solidCount = 0;
  for (let i = 0; i < solid.length; i++) solidCount += solid[i]!;
  const hasSolid = solidCount > 0 && solidCount >= SOLID_MIN_SHARE * ink;
  const seeds = hasSolid ? solid : strokes;
  // dilate the seeds by RING_PIXELS (+1 for the solid ones: the erosion took one pixel off) in both directions: a square, as two separable passes
  const reach = hasSolid ? RING_PIXELS + 1 : RING_PIXELS;
  const across = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!seeds[y * w + x]) continue;
      for (let k = Math.max(0, x - reach); k <= Math.min(w - 1, x + reach); k++) across[y * w + k] = 1;
    }
  }
  const grown = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!across[y * w + x]) continue;
      for (let k = Math.max(0, y - reach); k <= Math.min(h - 1, y + reach); k++) grown[k * w + x] = 1;
    }
  }
  const ratios: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grown[y * w + x] || near[y * w + x]) continue;
      const i = ((y0 + y) * picture.width + x0 + x) * 3;
      ratios.push(contrast(fill, { r: picture.rgb[i]!, g: picture.rgb[i + 1]!, b: picture.rgb[i + 2]! }));
    }
  }
  ratios.sort((a, b) => a - b);
  return { area: w * h, ink, connected, ring: ratios.length, solid: hasSolid, contrast: ratios.length ? ratios[Math.floor(ratios.length / 2)]! : null };
}

export interface OverReading {
  area: number;                    // pixels read (the rect clipped to the picture, less the masked ones)
  drawn: number;                   // of those, the ones whose colour the footage does not show at that place: something lies over the footage there
  ink: number;                     // of the drawn ones, the ones close to the fill colour
  colour: Rgb | null;              // the colour most drawn pixels have (the mean of the busiest bin of 16 levels a channel); null: nothing drawn
}

/**
 * Compares the render with what the footage alone would show (`footage`: the source frame as the canvas shows it, the same
 * size as `output`). A pixel is drawn when its colour lies more than MATCH_DISTANCE outside the range of the footage's
 * colours within MATCH_RADIUS pixels of its place: an edge that the encoder moved or softened stays inside that range,
 * a letter or an outline does not. `masks`: rects that are left out (other elements). `step`: read every n-th pixel only.
 */
export function readOver(output: Picture, footage: Picture, rect: RectLike, fill: Rgb, masks: RectLike[] = [], step = 1): OverReading {
  const reading: OverReading = { area: 0, drawn: 0, ink: 0, colour: null };
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  if (output.width !== footage.width || output.height !== footage.height) return reading;
  const W = output.width;
  const H = output.height;
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(W, rect.x + rect.width);
  const y1 = Math.min(H, rect.y + rect.height);
  const limit = MATCH_DISTANCE * MATCH_DISTANCE;
  const inkLimit = INK_DISTANCE * INK_DISTANCE;
  const o = output.rgb;
  const f = footage.rgb;
  for (let y = y0; y < y1; y += step) {
    const across = masks.filter((m) => y >= m.y && y < m.y + m.height);
    for (let x = x0; x < x1; x += step) {
      if (across.some((m) => x >= m.x && x < m.x + m.width)) continue;
      reading.area++;
      const i = (y * W + x) * 3;
      const r = o[i]!;
      const g = o[i + 1]!;
      const b = o[i + 2]!;
      if ((r - f[i]!) ** 2 + (g - f[i + 1]!) ** 2 + (b - f[i + 2]!) ** 2 <= limit) continue;      // the footage at the same place: most pixels
      let outside = 0;
      for (let c = 0; c < 3; c++) {
        const v = o[i + c]!;
        let low = 255;
        let high = 0;
        for (let ny = Math.max(0, y - MATCH_RADIUS); ny <= Math.min(H - 1, y + MATCH_RADIUS); ny++) {
          for (let nx = Math.max(0, x - MATCH_RADIUS); nx <= Math.min(W - 1, x + MATCH_RADIUS); nx++) {
            const s = f[(ny * W + nx) * 3 + c]!;
            if (s < low) low = s;
            if (s > high) high = s;
          }
        }
        const e = v < low ? low - v : v > high ? v - high : 0;
        outside += e * e;
      }
      if (outside <= limit) continue;
      reading.drawn++;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bin = bins.get(key);
      if (bin) { bin.n++; bin.r += r; bin.g += g; bin.b += b; } else bins.set(key, { n: 1, r, g, b });
      if ((r - fill.r) ** 2 + (g - fill.g) ** 2 + (b - fill.b) ** 2 <= inkLimit) reading.ink++;
    }
  }
  let busiest: { n: number; r: number; g: number; b: number } | null = null;
  for (const bin of bins.values()) if (!busiest || bin.n > busiest.n) busiest = bin;
  if (busiest) reading.colour = { r: Math.round(busiest.r / busiest.n), g: Math.round(busiest.g / busiest.n), b: Math.round(busiest.b / busiest.n) };
  return reading;
}
