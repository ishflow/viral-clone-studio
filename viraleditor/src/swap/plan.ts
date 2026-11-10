// A person-swap template on the disk, and the paid requests of a run of it: one per part, a `clip` row each. Pure but for `loadSwap`.
import { existsSync, readFileSync } from 'node:fs';
import type { CardSwap, SwapPhotos } from '../contracts.ts';
import { abs, rel } from '../paths.ts';
import type { Outfit, SwapPaid, Tier } from '../ports.ts';
import type { Need } from '../produce/plan.ts';
import { SwapTemplate } from '../template/swap-schema.ts';

/** A part of a person-swap run with what is sent for it. */
export interface SwapItem extends Need { paid: SwapPaid; needs: string[] }

/** Seconds read from a file may be over a whole second by this and be that second. */
const SAME_SECOND = 1e-6;
const idOf = (n: number): string => `p${String(n).padStart(2, '0')}`;

/** The template's own video: its sound is the sound of every video made from it. Under data/. */
export const sourceOf = (templateId: string): string => rel('templates', templateId, 'source.mp4');
/** The file of part `n` of the template's video, cut when the template was prepared. Under data/. */
export const partOf = (templateId: string, n: number): string => rel('templates', templateId, 'parts', `${idOf(n)}.mp4`);

/** templates/<id>/swap.json, or null when it is not there or is not one. */
export function loadSwap(templateId: string): CardSwap | null {
  try {
    const file = abs(rel('templates', templateId, 'swap.json'));
    if (!existsSync(file)) return null;
    const parsed = SwapTemplate.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** The paid requests of a run: one per part, in order. A part bills every second it has begun. */
export function needsOf(swap: CardSwap, runId: string): Need[] {
  return swap.parts.map((part): Need => ({
    n: 1, key: `v1:clip:${idOf(part.n)}`, kind: 'clip', id: idOf(part.n), seconds: Math.ceil(part.to - part.from - SAME_SECOND),
    file: rel('jobs', runId, 'paid', 'v1', `clip-${idOf(part.n)}.mp4`),
  }));
}

/** What is sent for each part: the part's own file and, for every person of the template, the customer's photographs of that slot, and the clothes (a run that did not say keeps the video's). Files are absolute. */
export function planOf(swap: CardSwap, templateId: string, people: SwapPhotos[], runId: string, tier: Tier, outfit: Outfit = 'keep'): SwapItem[] {
  const persons = swap.persons.map((person) => {
    const given = people.find((each) => each.slot === person.slot);
    if (given === undefined) throw new Error(`no photograph was given for person ${person.slot}`);
    return { slot: person.slot, body: abs(given.body), face: given.face === null ? null : abs(given.face), ...(given.side === undefined ? {} : { side: abs(given.side) }), hint: person.hint };
  });
  return needsOf(swap, runId).map((need, index): SwapItem => {
    const part = swap.parts[index]!;
    return { ...need, needs: [], paid: { kind: 'swap', request: { video: abs(partOf(templateId, part.n)), people: persons, seconds: part.to - part.from, tier, keepSound: false, outfit } } };
  });
}
