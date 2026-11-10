// swap.json (what a person-swap template keeps beside its video; its card carries the same) and the photographs a run of it is given.
// Both are strict: an unknown key is an error.
import { z } from 'zod';
import type { CardSwap, SwapPhotos } from '../contracts.ts';
import type { Outfit } from '../ports.ts';
import { Box, Sentence } from './values.ts';

/** A person-swap video is at most this long, and is asked for in parts of this length: the provider takes no longer video at once. */
export const SWAP_SECONDS_MAX = 30;
export const SWAP_PART_SECONDS_MIN = 3;
export const SWAP_PART_SECONDS_MAX = 10;
/** The people one video may have replaced. */
export const SWAP_PEOPLE_MAX = 2;
/** Two seconds read from a file may differ by less than this and be the same second. */
const SAME_SECOND = 1e-6;

type Issue = (path: (string | number)[], message: string) => void;

/** Slots are 1, 2 … in that order: a slot is the number on a box, and a list that skips or repeats one names no person. */
function slotRules(list: { slot: number }[], at: string, issue: Issue): void {
  list.forEach(({ slot }, index) => {
    if (slot !== index + 1) issue([at, index, 'slot'], `the slots are numbered from 1 in order: this one is ${index + 1}, not ${slot}`);
  });
}

/** The parts cover the video from its start, one after the other, each of a length the provider takes. */
function partRules(parts: CardSwap['parts'], issue: Issue): void {
  parts.forEach((part, index) => {
    if (part.n !== index + 1) issue(['parts', index, 'n'], `the parts are numbered from 1 in order: this one is ${index + 1}, not ${part.n}`);
    const start = index === 0 ? 0 : parts[index - 1]!.to;
    if (Math.abs(part.from - start) > SAME_SECOND) {
      issue(['parts', index, 'from'], index === 0 ? `the first part starts at 0, not at ${part.from}` : `a part starts where the one before it ends (${start}), not at ${part.from}`);
    }
    const seconds = part.to - part.from;
    if (seconds < SWAP_PART_SECONDS_MIN - SAME_SECOND || seconds > SWAP_PART_SECONDS_MAX + SAME_SECOND) {
      issue(['parts', index], `a part is ${SWAP_PART_SECONDS_MIN} to ${SWAP_PART_SECONDS_MAX} seconds long, not ${Number(seconds.toFixed(3))}`);
    }
  });
  const end = parts.at(-1)?.to ?? 0;
  if (end > SWAP_SECONDS_MAX + SAME_SECOND) issue(['parts'], `the video is at most ${SWAP_SECONDS_MAX} seconds long, not ${end}`);
}

const Slot = z.number().int().min(1).max(SWAP_PEOPLE_MAX);
export const SwapTemplate = z.strictObject({
  people: z.union([z.literal(1), z.literal(2)]),
  persons: z.array(z.strictObject({ slot: Slot, box: Box, hint: Sentence })).min(1).max(SWAP_PEOPLE_MAX),   // hint: part of a paid request
  parts: z.array(z.strictObject({ n: z.number().int().min(1), from: z.number().min(0), to: z.number().positive() })).min(1),
  sound: z.boolean(),
}).superRefine((swap, ctx) => {
  const issue: Issue = (path, message) => ctx.addIssue({ code: 'custom', path, message });
  if (swap.persons.length !== swap.people) issue(['persons'], `${swap.people} people need ${swap.people} persons, not ${swap.persons.length}`);
  slotRules(swap.persons, 'persons', issue);
  partRules(swap.parts, issue);
}) satisfies z.ZodType<CardSwap>;

/** A photograph of a person: the same shape as a product photograph of a fill (schema.ts). */
const Photograph = z.string().max(300).regex(/^uploads\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/, 'a path under uploads/, without ".." and without a leading dot');
/** `RunInput.swap`: the photographs of a person-swap run. Whether the slots are the ones of the template is the run's own check. */
export const SwapPeople = z.strictObject({
  people: z.array(z.strictObject({ slot: Slot, body: Photograph, face: Photograph.nullable(), side: Photograph.optional() })).min(1).max(SWAP_PEOPLE_MAX),
  outfit: z.enum(['keep', 'photo']).optional(),
}).superRefine((input, ctx) => {
  slotRules(input.people, 'people', (path, message) => ctx.addIssue({ code: 'custom', path, message }));
}) satisfies z.ZodType<{ people: SwapPhotos[]; outfit?: Outfit }>;
