// The lines a presenter says, with marks: `[name]…[/name]` around a run of words. Marks may nest and cross; a name is used once.
// A text, a card or a window of a template names a mark and gets the frames of its words.
import { MARK_NAME } from '../template/values.ts';
import { ResolveError } from './error.ts';

export interface WordRange { from: number; to: number }        // indexes into `words`, both included
export interface Script { words: string[]; marks: Record<string, WordRange> }

/** The longest word a caption shows (the edit document's limit). */
export const WORD_MAX = 60;

const TOKEN = new RegExp(`\\[(/?)(${MARK_NAME})\\]|[^\\s\\[\\]]+|[\\[\\]]`, 'g');

/**
 * Words (punctuation stays on its word) and the word range of every mark.
 * Throws ResolveError: `mark-unbalanced` (a mark that does not close, closes without opening or opens twice, or a bracket that
 * is not a mark), `mark-duplicate` (a name on a second range), `mark-empty` (no word inside), `word-too-long`.
 */
export function parseScript(lines: string): Script {
  const words: string[] = [];
  const open = new Map<string, number>();
  const marks = new Map<string, WordRange>();
  for (const token of lines.matchAll(TOKEN)) {
    const name = token[2];
    if (name === undefined) {
      const word = token[0];
      if (word === '[' || word === ']') throw new ResolveError('mark-unbalanced', `"${word}" is not part of a mark: write [name] and [/name] with a name of lower-case letters, digits and hyphens, or remove the bracket`);
      if (word.length > WORD_MAX) throw new ResolveError('word-too-long', `the word "${word.slice(0, 20)}…" has ${word.length} characters: a caption shows at most ${WORD_MAX}`);
      words.push(word);
    } else if (token[1] === '') {
      if (open.has(name)) throw new ResolveError('mark-unbalanced', `[${name}] opens again before [/${name}]`);
      if (marks.has(name)) throw new ResolveError('mark-duplicate', `[${name}] marks a second run of words: a mark name is used once`);
      open.set(name, words.length);
    } else {
      const from = open.get(name);
      if (from === undefined) throw new ResolveError('mark-unbalanced', `[/${name}] closes a mark that was not opened: add [${name}] before its first word`);
      if (from === words.length) throw new ResolveError('mark-empty', `[${name}] has no word inside: put it around at least one word`);
      open.delete(name);
      marks.set(name, { from, to: words.length - 1 });
    }
  }
  const [unclosed] = open.keys();
  if (unclosed !== undefined) throw new ResolveError('mark-unbalanced', `[${unclosed}] is never closed: add [/${unclosed}] after its last word`);
  return { words, marks: Object.fromEntries(marks) };
}

export interface MarkPlace extends WordRange { segment: number }   // the segment's position in the script; from / to count inside that segment
export interface Segments { words: string[][]; marks: Map<string, MarkPlace> }

/**
 * A whole script, one text per segment. A mark opens and closes inside one segment (each segment is one clip), a segment says
 * at least one word, and a mark name is used once in the whole script. Throws what parseScript throws, and `segment-empty`.
 */
export function parseSegments(segments: { id: string; lines: string }[]): Segments {
  const words: string[][] = [];
  const marks = new Map<string, MarkPlace>();
  segments.forEach(({ id, lines }, segment) => {
    const script = inSegment(id, () => parseScript(lines));
    if (script.words.length === 0) throw new ResolveError('segment-empty', `segment "${id}" says no word`);
    for (const [name, range] of Object.entries(script.marks)) {
      if (marks.has(name)) throw new ResolveError('mark-duplicate', `segment "${id}": [${name}] is already used in an earlier segment: a mark name is used once`);
      marks.set(name, { segment, ...range });
    }
    words.push(script.words);
  });
  return { words, marks };
}

function inSegment<T>(id: string, run: () => T): T {
  try { return run(); } catch (error) {
    if (error instanceof ResolveError) throw new ResolveError(error.code, `segment "${id}": ${error.message}`);
    throw error;
  }
}

/** The first two of these marks that share a word, or null. Two windows cannot be open at once. */
export function sharingWords(marks: Map<string, MarkPlace>, names: string[]): [string, string] | null {
  for (let i = 0; i < names.length; i++) {
    for (let k = i + 1; k < names.length; k++) {
      const a = marks.get(names[i]!), b = marks.get(names[k]!);
      if (a && b && a.segment === b.segment && a.from <= b.to && b.from <= a.to) return [names[i]!, names[k]!];
    }
  }
  return null;
}
