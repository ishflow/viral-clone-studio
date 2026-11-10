// The words of a talking clip, with their times, for resolve's `media.words`.
// The recogniser is the check that a paid clip speaks its lines. A forced aligner, when the machine has one, may lend
// better times for the same words; it never decides whether a clip is good, and its failure never stops anything.
import type { Aligner, Transcriber, Word } from '../ports.ts';
import { alignmentShare } from '../resolve/index.ts';

/** The least share of its script a talking clip must be heard to speak. Under it the clip does not speak its lines. */
export const SPOKEN_SHARE = 0.5;
/** The mean score from which the aligner's times are taken. Measured (Task C4-a): the right script 0.92–0.97, another script 0.20–0.39: under this the words were forced onto other speech and their times mean nothing. */
export const ALIGNED_SCORE = 0.7;
/** What a sum of scores may lose to floating point and still reach the mean (0.7 + 0.7 + 0.7 is 2.0999999999999996). */
const ROUNDING = 1e-9;
/** From this gap on between the aligner's end of a word and the start of the next, the speaker paused (Task C4-a: a real pause in 10 of 10 cases); a shorter gap means nothing. */
export const PAUSE_SECONDS = 0.35;
/** What a word before a pause, and the last word, are given after the aligner's end: the aligner's ends come 100–300 ms early. */
export const TAIL_SECONDS = 0.15;

/** How one talking clip got its word times: what quality.json keeps. */
export interface Spoken { segment: string; share: number; times: 'aligner' | 'recogniser'; why: string }

/** The recogniser, and the aligner when it is there. `why`: when it is not, the reason. */
export interface Ears { transcriber: Transcriber; aligner: Aligner | null; why: string }

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Asks the aligner once whether it is there. Never throws: an aligner that is not given, not ready or broken is no aligner. */
export async function earsOf(transcriber: Transcriber, aligner: Aligner | undefined): Promise<Ears> {
  if (aligner === undefined) return { transcriber, aligner: null, why: 'no aligner was given' };
  try {
    const { ready, note } = await aligner.ready();
    if (ready) return { transcriber, aligner, why: '' };
    return { transcriber, aligner: null, why: `the aligner is not ready: ${note ?? 'no reason given'}` };
  } catch (error) {
    return { transcriber, aligner: null, why: `the aligner is not ready: ${messageOf(error)}` };
  }
}

interface Placed { start: number; end: number; score: number }

/**
 * One entry per script word: where the aligner put it and how sure it was. Throws when the answer is anything else:
 * a word that starts before the word before it or after the clip's end, an end that is not a time at or after its start,
 * a score that is not from 0 to 1.
 */
function placedBy(answer: unknown, count: number, seconds: number): Placed[] {
  if (!Array.isArray(answer) || answer.length !== count) throw new Error(`it is not one entry for each of the ${count} words`);
  let before = 0;
  return answer.map((entry: unknown, i) => {
    const { start, end, score } = (typeof entry === 'object' && entry !== null ? entry : {}) as { start?: unknown; end?: unknown; score?: unknown };
    if (typeof start !== 'number' || !Number.isFinite(start) || start < before || start > seconds) throw new Error(`word ${i + 1} has no start between the word before it and the clip's end (${String(start)})`);
    if (typeof end !== 'number' || !Number.isFinite(end) || end < start) throw new Error(`word ${i + 1} has no end at or after its start (${String(end)})`);
    if (typeof score !== 'number' || !(score >= 0 && score <= 1)) throw new Error(`word ${i + 1} has no score from 0 to 1 (${String(score)})`);
    before = start;
    return { start, end, score };
  });
}

/**
 * The words of one talking clip of `seconds` length. `words` is null when the clip does not speak its lines (under
 * SPOKEN_SHARE of `script` was heard). Otherwise it is what resolve aligns the script with: what the recogniser heard,
 * or, when the aligner placed the script on the sound well enough, the script's own words on the aligner's starts.
 * Words that follow each other closely are back to back: a word ends where the next begins. Before a pause (a gap of
 * PAUSE_SECONDS or more after the aligner's end) a word ends TAIL_SECONDS after the aligner's end, so the pause stays a
 * pause; the last word likewise, at the clip's end at the latest. A word the aligner could not place (score 0) is left
 * out, so resolve treats it as a word that was not heard. Whatever the aligner does, the clip is never failed for it.
 */
export async function hear(ears: Ears, clip: string, segment: string, script: string[], language: string, seconds: number): Promise<{ spoken: Spoken; words: Word[] | null }> {
  const heard = await ears.transcriber.words(clip, language);
  const share = alignmentShare(script, heard);
  const by = (times: Spoken['times'], why: string): Spoken => ({ segment, share, times, why });
  if (share < SPOKEN_SHARE) return { spoken: by('recogniser', `${Math.round(share * 100)} % of the script was heard; at least ${SPOKEN_SHARE * 100} % is needed`), words: null };
  if (ears.aligner === null) return { spoken: by('recogniser', ears.why), words: heard };

  let answer: unknown;
  try { answer = await ears.aligner.align(clip, script, language); } catch (error) {
    return { spoken: by('recogniser', `the aligner rejected the clip: ${messageOf(error)}`), words: heard };
  }
  try {
    const placed = placedBy(answer, script.length, seconds);
    const sum = placed.reduce((total, word) => total + word.score, 0);
    const score = (sum / Math.max(1, placed.length)).toFixed(2);
    if (placed.length === 0 || sum < ALIGNED_SCORE * placed.length - ROUNDING) return { spoken: by('recogniser', `the aligner's mean score is ${score}, under ${ALIGNED_SCORE}`), words: heard };
    const kept = placed.flatMap((word, i) => (word.score > 0 ? [{ text: script[i]!, ...word }] : []));
    const words = kept.map(({ text, start, end }, k): Word => {
      const next = kept[k + 1]?.start;
      const pause = next === undefined || next - end >= PAUSE_SECONDS;
      return { text, start, end: pause ? Math.min(end + TAIL_SECONDS, next ?? seconds) : next };
    });
    return { spoken: by('aligner', `the aligner's mean score is ${score}`), words };
  } catch (error) {
    return { spoken: by('recogniser', `the aligner's answer was not used: ${messageOf(error)}`), words: heard };
  }
}
