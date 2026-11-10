import type { SwapSlot, Template } from '@/data/ports';

/** One person of the form: what the fields hold, as the person typed it (a box side is a number only once it is sent). */
export type PersonDraft = { left: string; top: string; right: string; bottom: string; hint: string };
type Box = SwapSlot['box'];

/** Where a second person starts: the right half of the picture, for the admin to move. */
export const SECOND_PERSON: PersonDraft = { left: '50', top: '0', right: '100', bottom: '100', hint: '' };

/**
 * The people the form starts from. A video the preparation suggested nobody for (`swapPeople: 'unset'`) has one person in a box of the
 * whole picture and a placeholder for words: the box stays, the words are left empty for the admin to write.
 */
export function draftsOf(template: Pick<Template, 'swap' | 'swapPeople'>): PersonDraft[] {
  return (template.swap?.persons ?? []).map(({ box, hint }) => ({
    left: String(box.left), top: String(box.top), right: String(box.right), bottom: String(box.bottom), hint: template.swapPeople === 'unset' ? '' : hint,
  }));
}

/** A side that is empty or not a number goes on as NaN (sent as no number): the data layer's rule refuses it, never read as 0. */
const sideOf = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text));

/** What the action is sent: one entry for each person, numbered in order. The rule of what they may be is `swapPeopleProblem`'s alone. */
export const payloadOf = (drafts: PersonDraft[]): SwapSlot[] =>
  drafts.map((draft, index) => ({ slot: index + 1, box: { left: sideOf(draft.left), top: sideOf(draft.top), right: sideOf(draft.right), bottom: sideOf(draft.bottom) }, hint: draft.hint }));

/** The box of a draft for the picture, or null while a side is not a number (nothing is drawn then). */
export function boxOf(draft: PersonDraft): Box | null {
  const box = { left: sideOf(draft.left), top: sideOf(draft.top), right: sideOf(draft.right), bottom: sideOf(draft.bottom) };
  return Object.values(box).every(Number.isFinite) ? box : null;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const within100 = (value: number): number => Math.min(100, Math.max(0, value));

/** A point of the picture in percent of it (rounded to a tenth, never outside it); null for a picture with no size. */
export function pointIn(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): { x: number; y: number } | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return { x: within100(round1(((clientX - rect.left) / rect.width) * 100)), y: within100(round1(((clientY - rect.top) / rect.height) * 100)) };
}

/** The box two corners make, whichever way they were dragged; null while it has no area. */
export function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }): Pick<PersonDraft, 'left' | 'top' | 'right' | 'bottom'> | null {
  const [left, right] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [top, bottom] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return right > left && bottom > top ? { left: String(left), top: String(top), right: String(right), bottom: String(bottom) } : null;
}
