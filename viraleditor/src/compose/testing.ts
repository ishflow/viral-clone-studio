// For the tests only: reads a composition back without a browser (its tags, their attributes, their animations).
import { EASINGS } from '../edit/presets.ts';
import type { Timeline } from '../edit/timeline.ts';
import type { Ease } from '../edit/types.ts';

export interface Tag { name: string; attrs: Record<string, string>; ancestors: Tag[]; text: string }

const VOID = new Set(['meta', 'img']);

/** Every element of the body and head, in document order, with its ancestors. The stylesheet's text is skipped. */
export function tagsOf(html: string): Tag[] {
  const source = html.replace(/<style>[\s\S]*?<\/style>/, '<style></style>');
  const tags: Tag[] = [];
  const stack: Tag[] = [];
  const pattern = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>/]+(?:=(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>([^<]*)/g;
  for (const match of source.matchAll(pattern)) {
    const [, closing, name, attributes, selfClosing, text] = match as unknown as [string, string, string, string, string, string];
    if (closing) { stack.pop(); continue; }
    const attrs: Record<string, string> = {};
    for (const attr of attributes.matchAll(/([^\s=]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g)) attrs[attr[1]!] = attr[2] ?? attr[3] ?? '';
    const tag: Tag = { name, attrs, ancestors: [...stack], text };
    tags.push(tag);
    if (!selfClosing && !VOID.has(name)) stack.push(tag);
  }
  return tags;
}

/** The text of the <style> element. */
export function cssOf(html: string): string {
  return /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
}

export interface CssAnimation { name: string; duration: number; ease: string; delay: number; fill: string }

/** The animations of a `style` attribute: `name duration ease delay … fill`, joined by commas outside parentheses. */
export function animationsOf(style: string | undefined): CssAnimation[] {
  const value = /animation:([^;]+)/.exec(style ?? '')?.[1];
  if (!value) return [];
  return value.split(/,(?![^()]*\))/).map((part) => {
    const tokens = part.trim().split(/\s+/);
    return { name: tokens[0]!, duration: Number.parseFloat(tokens[1]!), ease: tokens[2]!, delay: Number.parseFloat(tokens[3]!), fill: tokens.at(-1)! };
  });
}

/** The frames on which each element that timeline.animations names is on screen: `at` … `end − 1`. */
export function windowsOf(timeline: Timeline): Map<string, { at: number; end: number }> {
  const windows = new Map<string, { at: number; end: number }>();
  const set = (element: string, at: number, length: number) => windows.set(element, { at, end: at + length });
  for (const shot of timeline.shots) { set(shot.id, shot.at, shot.for + shot.tail); set(shot.element, shot.at, shot.for + shot.tail); }
  for (const t of timeline.transitions) if (t.colour !== null) set(`${t.to}-fx`, t.at, t.for);
  const perShot = new Map<string, number>();
  for (const w of timeline.windows) {
    const k = (perShot.get(w.shot) ?? 0) + 1;
    perShot.set(w.shot, k);
    set(`${w.shot}-b${k}`, w.at, w.for);                                  // the wrapper behind the window: on screen as long as the window
    for (const picture of w.pictures) set(picture.element, picture.at, picture.for);
  }
  for (const text of timeline.texts) set(text.element, text.at, text.for);
  for (const group of timeline.captions) {
    set(group.element, group.at, group.for);
    group.words.forEach((_, k) => set(`${group.element}-w${k + 1}`, group.at, group.for));
  }
  for (const card of timeline.cards) { set(card.element, card.at, card.for); set(`${card.id}-box`, card.at, card.for); }
  return windows;
}

// ── the value of an animated property on a frame, as design §7 defines it ──

/** A cubic Bézier easing as a function of progress (CSS cubic-bezier(x1, y1, x2, y2)). */
export function bezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const at = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  return (p) => {
    let low = 0;
    let high = 1;
    for (let i = 0; i < 60; i++) { const t = (low + high) / 2; if (at(t, x1, x2) < p) low = t; else high = t; }
    return at((low + high) / 2, y1, y2);
  };
}
/** Progress → eased progress, for an easing of the document or `step` (which is at its end value from the first frame on). */
function eased(ease: Ease | 'step', p: number): number {
  if (ease === 'step') return 1;
  const points = EASINGS[ease];
  return points ? bezier(...points)(p) : p;
}

/**
 * What timeline.animations says a property of an element is on frame `f`; `resting` where no animation holds it.
 * Rows are applied in order, as CSS applies the animations of one list: a later one that is running or holding wins.
 */
export function valueAt(timeline: Timeline, element: string, property: Timeline['animations'][number]['property'], f: number, resting: number): number {
  let value = resting;
  for (const row of timeline.animations) {
    if (row.element !== element || row.property !== property) continue;
    if (f < row.at) { if (row.hold === 'before' || row.hold === 'both') value = row.from; }
    else if (f >= row.at + row.for) { if (row.hold === 'after' || row.hold === 'both') value = row.to; }
    else value = row.from + (row.to - row.from) * eased(row.ease, (f - row.at + 0.5) / row.for);
  }
  return value;
}
