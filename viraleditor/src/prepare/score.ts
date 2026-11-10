// The pre-check of a reference: how well can the engine rebuild it? One request to the model, with the frame sheet.
import { z } from 'zod';
import type { PrepareNote } from '../contracts.ts';
import type { Llm } from '../ports.ts';
import { plain } from '../template/values.ts';
import { scorePrompt } from './prompts.ts';
import type { Look } from './read.ts';

/** The structures the engine cannot build, as the notes of a failed preparation name them. */
const UNSUPPORTED = ['split-screen', 'too-long', 'unsupported'] as const satisfies readonly PrepareNote[];

const NOTE_MAX = 200;

export const ScoreAnswer = z.strictObject({
  score: z.number().int().min(0).max(100),
  notes: z.array(plain(NOTE_MAX).min(1)).max(8),                   // one line per judgement, for the admin
  unsupported: z.enum(UNSUPPORTED).nullable(),
  mode: z.enum(['beats', 'speech']),                          // what kind of template the reference asks for
  brands: z.array(plain(80).min(1)).max(20),                  // the names seen or heard in the reference: none of them may stand in the template
});
export type Scored = z.infer<typeof ScoreAnswer>;

/** What the model may answer: a note up to twice the length the list keeps. Live, a note a little over the limit refused a whole answer (4 of 34 runs ended llm-invalid). */
const ScoreReply = ScoreAnswer.extend({ notes: z.array(plain(2 * NOTE_MAX).min(1)).max(8) });

/** A note of the answer, cut at a word to the length the list keeps. */
function clipped(note: string): string {
  if (note.length <= NOTE_MAX) return note;
  const cut = note.slice(0, NOTE_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > NOTE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Throws LlmInvalid when the model's answer is not a score. The sheet is the only file of the reference the model is given. */
export async function score(llm: Llm, look: Look): Promise<Scored> {
  const reply = await llm.run({ prompt: scorePrompt(look), files: [look.sheet], schema: ScoreReply });
  const answer = { ...reply, notes: reply.notes.map(clipped) };
  // Enforce the explicit relevance reason even when the model forgets its score cap.
  return answer.notes.some(note => /^off-product\s*:/i.test(note.trim()))
    ? { ...answer, score: Math.min(answer.score, 20) }
    : answer;
}
