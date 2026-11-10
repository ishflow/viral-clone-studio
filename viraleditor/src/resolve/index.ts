// resolve: a template, one customer's fill and the facts of the finished media → the edit document compose renders.
// Pure: no clock, no file, no random; the same input gives the same document, and nothing of the input is changed or shared.
import type { Edit } from '../edit/types.ts';
import type { Word } from '../ports.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';
import { resolveBeats } from './beats.ts';
import { ResolveError } from './error.ts';
import { checkFill } from './fill.ts';
import { resolveSpeech } from './speech.ts';

export { alignmentShare, alignWords } from './align.ts';
export { ResolveError } from './error.ts';
export { checkFill } from './fill.ts';
export type { FillCheck, FillIssue, FillNote } from './fill.ts';
export { photographsFor, pictureGiven } from './pictures.ts';
export { placeholderFacts } from './placeholder.ts';
export { parseScript } from './script.ts';

/** The finished media of one variant. Files are relative to the composition folder (`assets/…`). */
export interface ResolveMedia {
  clips: Record<string, { file: string; frames: number }>;      // by shot id; frames: of the normalised clip, at the canvas rate
  music: { file: string; frames: number } | null;               // null: a video without music
  images: Record<string, string>;                               // by picture reference: 'product:1', 'product:1.2', 'still:<id>'
  words: Record<string, Word[]>;                                // speech: what the recogniser heard, by segment id; empty in beats
}

/**
 * The edit document of one variant. Expects a template and a fill that passed their schemas (Template, Fill).
 * The only free text that reaches the document is the fill's copy and the fill's script words: never a prompt, the template's
 * copy pattern or `source_copy`. Throws ResolveError (its `code` list is in error.ts): first of all, what checkFill finds.
 */
export function resolve(template: TemplateJson, fill: FillJson, media: ResolveMedia): Edit {
  const [wrong] = checkFill(template, fill).errors;
  if (wrong !== undefined) throw new ResolveError(wrong.code, wrong.message);
  return structuredClone(template.mode === 'beats' ? resolveBeats(template, fill, media) : resolveSpeech(template, fill, media));
}
