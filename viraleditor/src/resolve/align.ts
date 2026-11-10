// Word times for a script from the words a recogniser heard (ported from our prototype spike/viraleditor-speech/align.mjs).
// Global sequence alignment (Needleman–Wunsch) on normalised words, scored by how alike two words are, with two extra moves:
// one script word heard as two ("Lashly" ← "Lash" + "Lee") and two script words heard as one ("lash line" ← "lashline").
// Captions show the script's words; the recogniser only lends its times. Pure.
import type { Word } from '../ports.ts';

export interface WordTime { start: number; end: number }       // seconds from the start of the clip

const GAP = -0.5;                              // a script word not heard, or a heard word the script does not have
const MERGE = -0.1;                            // the small price of the two extra moves
const SIMILAR = 0.5;                           // from this likeness on, a heard word counts as the script word being spoken
const HOLE = 0.12;                             // seconds per missing word that a gap between two heard words must have to be a real hole
const SECONDS_PER_LETTER = 0.07;               // used only when nothing at all was heard
const pair = (likeness: number) => 2 * likeness - 0.6;          // equal words +1.4 · unrelated words −0.6 (still better than two gaps)

const PAIR = 1, SKIP_SCRIPT = 2, SKIP_HEARD = 3, SPLIT = 4, JOINED = 5;

interface Aligned extends WordTime { likeness: number | null }   // likeness: to the heard word it was paired with; null = not heard

/** One time per script word, in script order. Identical and nearly identical words take the heard times; a word that was not heard lies between its neighbours. */
export function alignWords(script: string[], heard: Word[]): WordTime[] {
  return align(script, heard).map(({ start, end }) => ({ start, end }));
}

/** The share of script words paired with a similar heard word (0 … 1). A clip that speaks other lines still gets times for most words, but a low share. */
export function alignmentShare(script: string[], heard: Word[]): number {
  const sayable = script.filter((word) => normalise(word) !== '').length;      // a dash or an emoji standing alone is never heard
  if (sayable === 0) return 1;
  const similar = align(script, heard).filter((word, i) => normalise(script[i]!) !== '' && word.likeness !== null && word.likeness >= SIMILAR).length;
  return similar / sayable;
}

const normalise = (word: string) => word.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

function distance(a: string, b: string): number {               // Levenshtein
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

function likeness(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : 1 - distance(a, b) / longest;
}

function align(script: string[], heard: Word[]): Aligned[] {
  const s = script.map(normalise), h = heard.map((word) => normalise(word.text));
  return fillBetween(s, paired(s, h, heard));
}

/** The alignment itself: the heard time of every script word that was paired, undefined for the others. */
function paired(s: string[], h: string[], heard: Word[]): (Aligned | undefined)[] {
  const n = s.length, m = h.length;
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) { score[i]![0] = i * GAP; move[i]![0] = SKIP_SCRIPT; }
  for (let j = 1; j <= m; j++) { score[0]![j] = j * GAP; move[0]![j] = SKIP_HEARD; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = score[i - 1]![j - 1]! + pair(likeness(s[i - 1]!, h[j - 1]!)), how = PAIR;
      const skipScript = score[i - 1]![j]! + GAP;
      if (skipScript > best) { best = skipScript; how = SKIP_SCRIPT; }
      const skipHeard = score[i]![j - 1]! + GAP;
      if (skipHeard > best) { best = skipHeard; how = SKIP_HEARD; }
      if (j >= 2) {
        const split = score[i - 1]![j - 2]! + pair(likeness(s[i - 1]!, h[j - 2]! + h[j - 1]!)) + MERGE;
        if (split > best) { best = split; how = SPLIT; }
      }
      if (i >= 2) {
        const joined = score[i - 2]![j - 1]! + pair(likeness(s[i - 2]! + s[i - 1]!, h[j - 1]!)) + MERGE;
        if (joined > best) { best = joined; how = JOINED; }
      }
      score[i]![j] = best; move[i]![j] = how;
    }
  }

  const out: (Aligned | undefined)[] = new Array(n).fill(undefined);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const how = move[i]![j]!;
    if (how === PAIR) {
      out[i - 1] = { start: heard[j - 1]!.start, end: heard[j - 1]!.end, likeness: likeness(s[i - 1]!, h[j - 1]!) };
      i--; j--;
    } else if (how === SKIP_SCRIPT) { i--; }
    else if (how === SKIP_HEARD) { j--; }
    else if (how === SPLIT) {
      out[i - 1] = { start: heard[j - 2]!.start, end: heard[j - 1]!.end, likeness: likeness(s[i - 1]!, h[j - 2]! + h[j - 1]!) };
      i--; j -= 2;
    } else {                                                     // two script words share one heard word: cut it by letter count
      const word = heard[j - 1]!, a = s[i - 2]!.length, b = s[i - 1]!.length;
      const cut = word.start + (word.end - word.start) * a / Math.max(1, a + b);
      const alike = likeness(s[i - 2]! + s[i - 1]!, h[j - 1]!);
      out[i - 2] = { start: word.start, end: cut, likeness: alike };
      out[i - 1] = { start: cut, end: word.end, likeness: alike };
      i -= 2; j--;
    }
  }
  return out;
}

/** Words that were not heard get a time between their neighbours: the hole between them when there is one, otherwise a share of the neighbour's time by letter count. */
function fillBetween(s: string[], found: (Aligned | undefined)[]): Aligned[] {
  const n = s.length;
  const out = found.slice();
  const perLetter = secondsPerLetter(s, out);
  const letters = (k: number) => Math.max(1, s[k]!.length);
  for (let i = 0; i < n; i++) {
    if (out[i]) continue;
    let last = i;
    while (last + 1 < n && !out[last + 1]) last++;
    const before = i > 0 ? out[i - 1] : undefined, after = last + 1 < n ? out[last + 1] : undefined;
    let total = 0;
    for (let k = i; k <= last; k++) total += letters(k);
    let from: number, to: number;
    if (before && after && after.start - before.end >= HOLE * (last - i + 1)) { from = before.end; to = after.start; }
    else if (before && after) {                                  // no hole: the word before swallowed them
      to = after.start;
      from = cutOff(before, before.start, to, letters(i - 1), total);
    } else if (after) { to = after.start; from = Math.max(0, to - total * perLetter); }
    else if (before && before.end - before.start >= 0.75 * perLetter * (letters(i - 1) + total)) {   // the last words of the clip, and the word before is long enough to have swallowed them
      to = before.end;
      from = cutOff(before, before.start, to, letters(i - 1), total);
    } else if (before) { from = before.end; to = from + total * perLetter; }
    else { from = 0; to = total * perLetter; }
    let at = from;
    for (let k = i; k <= last; k++) {
      const end = at + (to - from) * letters(k) / total;
      out[k] = { start: at, end, likeness: null };
      at = end;
    }
    i = last;
  }
  return out as Aligned[];
}

/** The word before gives up the later part of the span from … to, by letter count; returns where the missing words begin. */
function cutOff(before: Aligned, from: number, to: number, ownLetters: number, missingLetters: number): number {
  const cut = from + (to - from) * ownLetters / (ownLetters + missingLetters);
  before.end = Math.min(before.end, cut);
  return cut;
}

function secondsPerLetter(s: string[], found: (Aligned | undefined)[]): number {
  let seconds = 0, letters = 0;
  found.forEach((word, i) => { if (word) { seconds += word.end - word.start; letters += Math.max(1, s[i]!.length); } });
  return letters > 0 ? seconds / letters : SECONDS_PER_LETTER;
}
