// The caption word judge: on a few frames of every word's active span, which word of the group shows the active mark (its
// colour, or a pill behind it) and which letters are there. No OCR: the letters are read as ink columns. Each line of a
// group must show as many runs of ink as it has words, each as wide and where the metrics table and the layout of the
// caption (centred lines, 0.14 em padding on each side of a word, one space between words) put that word. The mark must
// lie on the active word's place and nowhere else in the group. Two words of about the same width in the same place cannot
// be told apart: that stays a limit of reading without OCR.
import type { Picture } from '../compose/golden-helpers.ts';
import { valueAt } from '../compose/testing.ts';
import type { Timeline } from '../edit/timeline.ts';
import type { Edit } from '../edit/types.ts';
import { textWidth } from '../fit/index.ts';
import type { Wrong } from './analyse.ts';
import type { Rgb } from './media.ts';
import { clampBox, green, grow } from './frames.ts';
import type { Box, Weight } from './frames.ts';

const PAD = 0.28;                  // em: the padding of a word span, both sides together
const MIN_OPACITY = 0.25;          // below this the group is too faint to read words on
type Group = Timeline['captions'][number];

export interface WordReading { frames: number; judged: number; notes: string[] }

/** Letters of a caption in colour mode: red text and green active text. */
const lettersColour: Weight = (r, g, b) => r / 255 + green(r, g, b);
/**
 * Pill mode, unmixed against the blue `B` of the picture under the caption: every caption colour has red 255 and every
 * picture red 0, so r / 255 is how much caption covers the pixel; the pill adds blue beyond what that much cover leaves
 * of the picture, red text and the pill's text colour add none. Mark = that blue, letters = the cover that is not pill.
 */
const pillMark = (r: number, b: number, B: number) => Math.min(r, Math.max(0, b - (1 - r / 255) * B)) / 255;

/** Runs of indices where `values` is above `level`, merged across gaps shorter than `gap`. */
export function runs(values: ArrayLike<number>, level: number, gap: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i]! <= level) continue;
    const last = out.at(-1);
    if (last && i - last[1] < gap) last[1] = i + 1;
    else out.push([i, i + 1]);
  }
  return out;
}

interface Planned { text: string; line: number; centre: number; width: number; left: number; right: number }   // at scale 1, before the group's scale

/** Where the layout puts every word of a group horizontally (px, at the group's rest scale): lines centred in the rect. */
function plan(g: Group, size: number, fit: Parameters<typeof textWidth>[1]): Planned[] | null {
  const space = textWidth(' ', fit, size);
  if (space === null) return null;
  const out: Planned[] = [];
  const mid = g.rect.x + g.rect.width / 2;
  for (const [line, text] of g.lines.entries()) {
    const ws = text.split(' ');
    const widths = ws.map((w) => textWidth(w, fit, size));
    if (widths.some((w) => w === null)) return null;
    const boxes = widths.map((w) => w! + PAD * size);
    const total = boxes.reduce((a, b) => a + b, 0) + space * (ws.length - 1);
    let x = mid - total / 2;
    ws.forEach((w, i) => { out.push({ text: w, line, centre: x + boxes[i]! / 2, width: widths[i]!, left: x, right: x + boxes[i]! }); x += boxes[i]! + space; });
  }
  return out;
}

/** Collects, on the frames it chose, what every caption group shows word by word; `wrong` gets what differs from the timeline. */
export function captionWords(t: Timeline, edit: Edit, wrong: Wrong[], under: (f: number) => Rgb): { take: (f: number, p: Picture) => void; reading: WordReading } {
  const reading: WordReading = { frames: 0, judged: 0, notes: [] };
  const kind = edit.captions?.active?.kind ?? 'colour';
  const style = edit.styles?.[edit.captions?.style ?? 'caption'];
  if (!edit.captions || kind === 'none' || !style) {
    if (edit.captions) reading.notes.push(`caption words not judged: ${!style ? 'the style is a preset the sweep has no metrics call for' : 'no active mark'}`);
    return { take: () => {}, reading };
  }
  const fit = { font: style.font, weight: style.weight, size: style.size, tracking: style.tracking, leading: style.leading };
  const grows = kind === 'colour' ? ((edit.captions.active as { scale?: number }).scale ?? 1.06) : 1;
  const plans = t.captions.map((g) => plan(g, g.size, fit));
  const centred = style.align === 'center';                               // else the places of the words are not predicted, only their count and widths
  const at = new Map<number, number>();                                     // frame → the group to judge there
  t.captions.forEach((g, gi) => {
    if (!plans[gi]) { reading.notes.push(`caption group ${g.group}: a word has no metrics, not judged`); return; }
    g.words.forEach((w) => {
      const span = Array.from({ length: w.for }, (_, i) => w.at + i).filter((f) => f >= g.at && f < g.at + g.for && f < t.frames && valueAt(t, g.element, 'opacity', f, 1) >= MIN_OPACITY);
      if (span.length === 0) { reading.notes.push(`caption word "${w.text}" (group ${g.group}): no frame of its span with the group at opacity ${MIN_OPACITY} or more, not judged`); return; }
      for (const f of [span[0]!, span[Math.floor(span.length / 2)]!, span.at(-1)!]) at.set(f, gi);
    });
  });

  const take = (f: number, p: Picture) => {
    const gi = at.get(f);
    if (gi === undefined) return;
    reading.frames++;
    const g = t.captions[gi]!;
    const planned = plans[gi]!;
    const o = valueAt(t, g.element, 'opacity', f, 1);
    const s = valueAt(t, g.element, 'scale', f, 1);
    const mid = g.rect.x + g.rect.width / 2;
    const em = g.size * s;
    const box = clampBox(grow(g.rect, 0.05 * t.width, 12), p.width, p.height);
    const L = new Float64Array(box.width * box.height); const M = new Float64Array(box.width * box.height); const R = new Float64Array(box.width * box.height);
    const B = under(f)[2];
    for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
      const i = ((box.y + y) * p.width + box.x + x) * 3;
      const r = p.rgb[i]!; const g = p.rgb[i + 1]!; const b = p.rgb[i + 2]!;
      const j = y * box.width + x;
      if (kind === 'pill') { M[j] = pillMark(r, b, B); L[j] = r / 255 - M[j]!; }
      else { M[j] = green(r, g, b); L[j] = lettersColour(r, g, b); R[j] = r / 255; }   // R: the fill (red) of a word
    }
    const sum = (a: Float64Array, x0: number, x1: number, y0: number, y1: number) => {
      let v = 0;
      for (let y = Math.max(0, y0); y < Math.min(box.height, y1); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(box.width, Math.ceil(x1)); x++) v += a[y * box.width + x]!;
      return v;
    };
    const tell = (k: string, element: string, promise: string, shows: string) => wrong.push({ kind: k, frame: f, element, promise, shows });
    const active = g.words.findIndex((w) => f >= w.at && f < w.at + w.for);
    const id = (k: number) => `${g.element}-w${k + 1} "${g.words[k]?.text}"`;

    // the lines: bands of rows with letters
    const rows = new Float64Array(box.height);
    for (let y = 0; y < box.height; y++) rows[y] = sum(L, 0, box.width, y, y + 1);
    // a band thinner than a quarter em is no line of letters: the top or bottom edge of a pill, where the chroma of the video bleeds
    const bands = runs(rows, 0.05 * Math.max(...rows), 0.12 * em).filter(([a, b]) => b - a >= 0.25 * em);
    if (bands.length !== g.lines.length) {
      tell('caption-letters', g.element, `${g.lines.length} line(s): ${g.lines.join(' / ')}`, `${bands.length} band(s) of letters`);
      return;
    }
    reading.judged++;
    // the words of every line: runs of letter columns, against the planned places (scaled about the group's centre)
    const scaled = (x: number) => mid + s * (x - mid) - box.x;
    for (const [line, [y0, y1]] of bands.entries()) {
      const cols = new Float64Array(box.width);
      for (let x = 0; x < box.width; x++) cols[x] = sum(L, x, x + 1, y0, y1);
      const blobs = runs(cols, 0.04 * Math.max(...cols), 0.22 * em);
      const want = planned.map((w, k) => ({ w, k })).filter(({ w }) => w.line === line);
      if (blobs.length !== want.length) { tell('caption-letters', g.element, `line ${line + 1} "${g.lines[line]}": ${want.length} word(s)`, `${blobs.length} run(s) of letters`); continue; }
      want.forEach(({ w, k }, i) => {
        const [x0, x1] = blobs[i]!;
        const lit = k === active;
        const hi = lit && kind === 'colour' ? grows + 0.06 : 1;           // the colour mark pops past its scale
        const lo = 1;
        const pill = lit && kind === 'pill' ? PAD * g.size : 0;             // the edges of a pill (chroma bleed) can join its word's letters
        const width = x1 - x0; const centre = (x0 + x1) / 2;
        const wantCentre = scaled(w.centre);
        if (width < s * lo * (w.width - 0.3 * g.size) - 2 || width > s * hi * (w.width + 0.06 * g.size + pill) + 2) tell('caption-letters', `${id(k)}`, `ink ${Math.round(s * lo * (w.width - 0.3 * g.size))}…${Math.round(s * hi * (w.width + 0.06 * g.size + pill))} px wide`, `${width} px`);
        if (centred && Math.abs(centre - wantCentre) > 0.08 * em + 3) tell('caption-letters', `${id(k)}`, `centre at x ${Math.round(wantCentre + box.x)}`, `x ${Math.round(centre + box.x)}`);
      });
    }
    // the mark: on the active word's place, nowhere else in the group
    const total = sum(M, 0, box.width, 0, box.height);
    const placeOf = (k: number, a: Float64Array = M) => {
      const w = planned[k]!;
      const same = planned.filter((x) => x.line === w.line);
      const i = same.indexOf(w);
      const left = i === 0 ? -Infinity : (same[i - 1]!.right + w.left) / 2;
      const right = i === same.length - 1 ? Infinity : (w.right + same[i + 1]!.left) / 2;
      // rows: the line's band of letters, out to half way to the next band (a pill is taller than the letters)
      const [y0, y1] = bands[w.line]!;
      const pad = Math.ceil(0.4 * em);
      const top = w.line === 0 ? y0 - pad : Math.ceil((bands[w.line - 1]![1] + y0) / 2);
      const bottom = w.line === bands.length - 1 ? y1 + pad : Math.floor((y1 + bands[w.line + 1]![0]) / 2);
      return sum(a, left === -Infinity ? 0 : scaled(left), right === Infinity ? box.width : scaled(right), top, bottom);
    };
    const marks = planned.map((_, k) => placeOf(k));
    if (active < 0) {
      if (total > 0.02 * em * em * o) tell('caption-lit', g.element, 'no word active', `mark mass ${Math.round(total)}`);
      return;
    }
    const need = 0.08 * planned[active]!.width * g.size * s * s * o;
    if (marks[active]! < need || marks[active]! < 0.8 * total) tell('caption-lit', id(active), `the active word shows the mark (${Math.round(need)} or more, 80 % of the group's)`, `${Math.round(marks[active]!)} of ${Math.round(total)} on it`);
    marks.forEach((m, k) => { if (k !== active && m > 0.1 * Math.max(marks[active]!, need)) tell('caption-lit', id(k), `not active (word ${active + 1} is)`, `mark mass ${Math.round(m)} (active word: ${Math.round(marks[active]!)})`); });
    if (kind === 'colour') {
      // the active word is drawn in the mark's colour: no red letters on its place
      const red = placeOf(active, R);
      if (red > 0.25 * Math.max(marks[active]!, need)) tell('caption-lit', id(active), 'drawn in the mark colour', `fill-coloured ink ${Math.round(red)} on it (mark ${Math.round(marks[active]!)})`);
    }
  };
  return { take, reading };
}
