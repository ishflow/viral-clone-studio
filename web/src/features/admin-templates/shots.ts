import type { Shot } from '@/data/ports';

export type ShotDraft = { action: string; text: string; product: number | null; image?: string | null };

/** Boundaries that split `seconds` into `count` whole-second parts that add up to the length. */
export function tileShots(seconds: number, drafts: ShotDraft[]): Shot[] {
  const n = drafts.length;
  return drafts.map((draft, i) => ({
    n: i + 1, from: Math.round((i * seconds) / n), to: Math.round(((i + 1) * seconds) / n), action: draft.action, text: draft.text, product: draft.product, image: draft.image,
  }));
}

/** `0:05`. */
export const clock = (value: number): string => {
  const seconds = Math.round(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export function moveShot<T>(list: T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (target < 0 || target >= list.length) return list;
  const copy = [...list];
  [copy[index], copy[target]] = [copy[target]!, copy[index]!];
  return copy;
}
