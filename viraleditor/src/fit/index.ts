// Text fitting without a browser: glyph advances from src/fit/metrics.json (built by scripts/metrics.ts), design §5.8.
// Pure and synchronous. The table has no kerning, so an estimate is a little wider than the ink: the safe side.
import metricsJson from './metrics.json' with { type: 'json' };

/**
 * size px; tracking em; leading default 1.15. plateY (em): the vertical padding of a plate behind each line. Lines of a plated text stand
 * lineHeight + 2 × ⌈plateY × size⌉ apart (so no plate covers another); box.height is then what is left of the box after the padding at the
 * style's own size, which is what a single line needs.
 */
export interface FitStyle { font: 'Inter' | 'Montserrat'; weight: number; size: number; tracking?: number; leading?: number; plateY?: number }
export type FitResult =
  | { ok: true; size: number; lineHeight: number; lines: string[]; widths: number[] }          // integer px; widths: the estimate per line
  | { ok: false; code: 'text-too-long'; reason: 'word' | 'lines' | 'height'; smallest: number; needed: number; available: number }
  // reason word:   a word is wider than the wrap width at the smallest size (px; available = box width × 0.98, floored)
  // reason lines:  every word fits but the copy needs more lines than allowed (needed: lines it needs; available: options.lines)
  // reason height: the lines fit but lines × lineHeight exceeds the box (px; available: the box height)
  | { ok: false; code: 'text-glyph'; characters: string[] };                                   // the graphemes without an entry, each once

interface FontTable { weights: number[]; advances: Record<string, number[]> }
const TABLE = metricsJson as unknown as Record<FitStyle['font'], FontTable>;

const MAX_SIZE = 2000;                     // px: a larger size is invalid
const SAFETY = 0.98;                       // the wrap width is the box width times this
const DEFAULT_LEADING = 1.15;
const EMOJI_ADVANCE = 1250;                // thousandths of an em: Apple Color Emoji is 1 em, Noto Color Emoji about 1.245 em
const SEGMENTER = new Intl.Segmenter('en', { granularity: 'grapheme' });
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const KEYCAP = /^[0-9#*]️?⃣$/u;
const FLAG = /^\p{Regional_Indicator}+$/u;
const MARKS = /^\p{M}+$/u;
const WHITESPACE = /\s+/u;
const ZERO_WIDTH = /[​‌‍﻿⁠]/gu;

function graphemes(text: string): string[] {
  const out: string[] = [];
  for (const s of SEGMENTER.segment(text)) out.push(s.segment);
  return out;
}

const inTable = (font: FitStyle['font'], ch: string) => Object.hasOwn(TABLE[font].advances, ch);
const isEmoji = (g: string) => KEYCAP.test(g) || FLAG.test(g) || PICTOGRAPHIC.test(g);

/** NFC, and the zero-width characters removed (one inside an emoji sequence stays: it joins the emoji) */
function clean(text: string): string {
  const out: string[] = [];
  for (const g of graphemes(text.normalize('NFC'))) out.push(isEmoji(g) ? g : g.replace(ZERO_WIDTH, ''));
  return out.join('');
}

/** advance of one grapheme at 1000 px, interpolated at the weight; null when the table does not know it */
function advance(font: FitStyle['font'], weight: number, grapheme: string): number | null {
  if (KEYCAP.test(grapheme) || FLAG.test(grapheme)) return EMOJI_ADVANCE;
  const table = TABLE[font];
  const chars = [...grapheme];
  if (chars.every((ch) => inTable(font, ch))) return sum(table, weight, chars);       // table first: © and ™ keep their real width
  if (PICTOGRAPHIC.test(grapheme)) return EMOJI_ADVANCE;
  if (inTable(font, chars[0]) && !/\s/u.test(chars[0]) && MARKS.test(grapheme.slice(chars[0].length))) return sum(table, weight, [chars[0]]);
  return null;
}

function sum(table: FontTable, weight: number, chars: string[]): number {
  const last = table.weights.length - 1;
  const w = Math.min(table.weights[last], Math.max(table.weights[0], weight));
  const i = Math.min(last - 1, Math.floor((w - table.weights[0]) / 100));
  const t = (w - table.weights[i]) / (table.weights[i + 1] - table.weights[i]);
  let total = 0;
  for (const ch of chars) { const row = table.advances[ch]; total += row[i] + (row[i + 1] - row[i]) * t; }
  return total;
}

const finiteOr = (v: number | undefined, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** the invisible and control characters are named by code point so that a message can show them */
function describe(g: string): string {
  return /^[\p{C}\p{Z}\p{M}]+$/u.test(g) ? [...g].map((ch) => `U+${(ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}`).join(' ') : g;
}

/** the graphemes of the text that have no entry (each once, in order of appearance). Whitespace is never reported. */
export function unknownGlyphs(text: string, font: FitStyle['font']): string[] {
  const seen = new Set<string>();
  for (const g of graphemes(clean(text))) {
    if (/^\s+$/u.test(g) || advance(font, 400, g) !== null) continue;
    seen.add(describe(g));
  }
  return [...seen];
}

/** advance sum of a text at 1000 px and its grapheme count; null: a grapheme without an entry */
function measure(text: string, font: FitStyle['font'], weight: number): { adv: number; count: number } | null {
  let adv = 0, count = 0;
  for (const g of graphemes(text)) {
    const a = advance(font, weight, g);
    if (a === null) return null;
    adv += a; count++;
  }
  return { adv, count };
}

/** width in px of the text at a size: Σ advance × size / 1000 + tracking × size per grapheme. Negative tracking leaves out the trailing one (the last glyph ink does not move). null: a character without an entry. */
export function textWidth(text: string, style: FitStyle, size: number): number | null {
  const m = measure(clean(text), style.font, finiteOr(style.weight, 400));
  if (!m) return null;
  const tracking = finiteOr(style.tracking, 0) * size;
  return (m.adv * size) / 1000 + tracking * (tracking < 0 ? Math.max(0, m.count - 1) : m.count);
}

interface Word { text: string; adv: number; count: number }
const wordWidth = (w: Word, size: number, tracking: number) => (w.adv * size) / 1000 + tracking * size * w.count;   // gross: every grapheme carries its tracking

/** starts of the lines of a greedy wrap; widths are gross, `max` is the room left for them */
function breaks(words: Word[], size: number, tracking: number, space: number, max: number): number[] {
  const starts: number[] = [];
  let w = 0;
  for (let k = 0; k < words.length; k++) {
    const ww = wordWidth(words[k], size, tracking);
    if (k > 0 && starts.length && w + space + ww <= max) { w += space + ww; continue; }
    starts.push(k); w = ww;
  }
  return starts;
}

const slice = (words: Word[], starts: number[]) => starts.map((s, i) => words.slice(s, starts[i + 1] ?? words.length).map((w) => w.text).join(' '));

/** the narrowest wrap width (between the widest word and `limit`) that keeps the line count of the wrap at `limit` */
function balance(words: Word[], size: number, tracking: number, space: number, limit: number, widest: number): number[] {
  let best = breaks(words, size, tracking, space, limit);
  let lo = widest, hi = limit;
  for (let i = 0; i < 24 && lo < hi; i++) {
    const mid = (lo + hi) / 2;
    const b = breaks(words, size, tracking, space, mid);
    if (b.length <= best.length) { best = b; hi = mid; } else lo = mid;
  }
  return best;
}

function tooLong(reason: 'word' | 'lines' | 'height', smallest: number, needed: number, available: number): FitResult {
  return { ok: false, code: 'text-too-long', reason, smallest, needed, available };
}

/**
 * The largest whole-pixel size from style.size down to ⌈size × shrink⌉ at which the copy sits in the box on at most options.lines lines.
 * '\n' forces a line break (empty lines are dropped). Each paragraph is wrapped greedily into box.width × 0.98, then balanced.
 * The copy is NFC-normalised and loses its zero-width characters; the returned lines are that text.
 */
export function fitText(copy: string, style: FitStyle, box: { width: number; height: number }, options: { lines: number; shrink: number }): FitResult {
  const unknown = unknownGlyphs(copy, style.font);
  if (unknown.length) return { ok: false, code: 'text-glyph', characters: unknown };

  const positive = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  if (!positive(style.size) || style.size < 1 || style.size > MAX_SIZE) {
    const h = positive(box.height);
    return tooLong('height', 0, h > 0 ? h * 2 : 1, h);
  }
  const top = Math.max(1, Math.floor(style.size));
  if (!positive(box.width)) return tooLong('word', top, 1, 0);
  if (!positive(box.height)) return tooLong('height', top, 1, 0);

  const weight = finiteOr(style.weight, 400);
  const tracking = finiteOr(style.tracking, 0);
  const leading = positive(finiteOr(style.leading, 0)) || DEFAULT_LEADING;
  const maxLines = Number.isFinite(options.lines) && options.lines >= 1 ? Math.floor(options.lines) : 1;
  const shrink = Number.isFinite(options.shrink) && options.shrink >= 0 && options.shrink <= 1 ? options.shrink : 1;
  const bottom = Math.min(top, Math.max(1, Math.ceil(style.size * shrink)));
  const limit = box.width * SAFETY;

  const paras: Word[][] = [];
  for (const p of clean(copy).split(/\r\n|\r|\n/u)) {
    const words: Word[] = [];
    for (const text of p.split(WHITESPACE)) {
      if (text === '') continue;
      const m = measure(text, style.font, weight);
      if (!m) return { ok: false, code: 'text-glyph', characters: [describe(text)] };      // cannot happen after the check above; never flows on
      words.push({ text, ...m });
    }
    if (words.length > 0) paras.push(words);
  }
  if (!paras.length) return { ok: true, size: top, lineHeight: Math.round(top * leading), lines: [], widths: [] };
  const spaceAdv = (measure(' ', style.font, weight) as { adv: number }).adv;

  let failure: FitResult = tooLong('word', bottom, 1, Math.floor(limit));
  for (let size = top; size >= bottom; size--) {
    const lineHeight = Math.round(size * leading);
    const space = (spaceAdv * size) / 1000 + tracking * size;
    const extra = tracking < 0 ? -tracking * size : 0;            // the trailing tracking a line does not carry
    const room = limit - extra;

    let widest = 0;
    for (const words of paras) for (const w of words) { const ww = wordWidth(w, size, tracking); if (ww > widest) widest = ww; }
    if (widest > room) { failure = tooLong('word', size, Math.ceil(widest + extra), Math.floor(limit)); continue; }

    const starts = paras.map((words) => breaks(words, size, tracking, space, room));
    let count = 0;
    for (const s of starts) count += s.length;
    if (count > maxLines) { failure = tooLong('lines', size, count, maxLines); continue; }
    const stacked = count > 1 && style.plateY ? Math.max(0, count * 2 * Math.ceil(style.plateY * size) - 2 * Math.ceil(style.plateY * style.size)) : 0;   // the padding between the lines of a plated text
    if (count * lineHeight + stacked > box.height) { failure = tooLong('height', size, count * lineHeight + stacked, box.height); continue; }

    const lines: string[] = [];
    for (const words of paras) lines.push(...slice(words, balance(words, size, tracking, space, room, widest)));
    const widths = lines.map((l) => textWidth(l, style, size) as number);
    let widestLine = 0;
    for (const w of widths) if (w > widestLine) widestLine = w;
    if (widestLine > limit) { failure = tooLong('word', size, Math.ceil(widestLine), Math.floor(limit)); continue; }   // float noise at the edge: try the next size
    return { ok: true, size, lineHeight, lines, widths };
  }
  return failure;
}
