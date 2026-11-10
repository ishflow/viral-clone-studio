// The rule that ends a caption group, as far as it needs no fitting (design §5.5). The captions emitter also ends a group
// when one more word would not fit its lines; validate counts the groups there are at least.
import type { Frame } from './types.ts';

export const SENTENCE_END = /[.!?]$/;

/** Does a group of `open` words, whose last word is `last`, end before the word `next`? */
export function endsGroup(open: number, last: { text: string; end: Frame }, next: { at: Frame }, rule: { words: number; pause: number }): boolean {
  return open >= rule.words || next.at - last.end >= rule.pause || SENTENCE_END.test(last.text);
}
