// The words of one talking clip: the recogniser is the check that the clip speaks its lines, the aligner (when there is one) may lend better times.
import { describe, expect, it } from 'vitest';
import { FakeTranscriber } from '../adapters/fakes.ts';
import type { AlignedWord, Aligner, Word } from '../ports.ts';
import { alignWords } from '../resolve/index.ts';
import { earsOf, hear, PAUSE_SECONDS, TAIL_SECONDS } from './speech.ts';

const CLIP = '/clips/s1.mp4';
const LENGTH = 3;                                              // the clip's seconds
const SCRIPT = ['Aloe,', 'shea,', 'jojoba.'];
const HEARD: Word[] = [
  { text: 'aloe', start: 0.3, end: 0.8 },
  { text: 'shea', start: 0.9, end: 1.3 },
  { text: 'jojoba', start: 1.4, end: 2 },
];
const aligned = (scores: number[]): AlignedWord[] => SCRIPT.map((text, i) => ({ text, start: 0.26 + i * 0.6, end: 0.7 + i * 0.6, score: scores[i]! }));

interface FakeAligner extends Aligner { asked: number; calls: { media: string; words: string[]; language: string }[] }
function fakeAligner(ready: { ready: boolean; note: string | null } | Error, answer: AlignedWord[] | Error = aligned([0.95, 0.9, 0.97])): FakeAligner {
  const fake: FakeAligner = {
    asked: 0, calls: [],
    async ready() { fake.asked++; if (ready instanceof Error) throw ready; return ready; },
    async align(media, words, language) { fake.calls.push({ media, words, language }); if (answer instanceof Error) throw answer; return answer; },
  };
  return fake;
}
const READY = { ready: true, note: null };
const transcriber = (heard: Word[] = HEARD) => new FakeTranscriber({ by: { [CLIP]: heard } });

describe('hear', () => {
  it('without an aligner the recogniser\'s words are the times', async () => {
    const ears = await earsOf(transcriber(), undefined);
    const { words, spoken } = await hear(ears, CLIP, 'formula', SCRIPT, 'en', LENGTH);
    expect(words).toEqual(HEARD);
    expect(spoken).toEqual({ segment: 'formula', share: 1, times: 'recogniser', why: 'no aligner was given' });
  });

  it('asks the recogniser in the clip\'s language', async () => {
    const recogniser = transcriber();
    await hear(await earsOf(recogniser, undefined), CLIP, 'formula', SCRIPT, 'tr', LENGTH);
    expect(recogniser.calls).toEqual([{ media: CLIP, language: 'tr' }]);
  });

  it('a clip that speaks other lines has no words: under half of its script was heard, and the aligner is not asked', async () => {
    const aligner = fakeAligner(READY);
    const other: Word[] = [{ text: 'hello', start: 0.2, end: 0.5 }, { text: 'everybody', start: 0.6, end: 1.2 }, { text: 'jojoba', start: 1.4, end: 2 }];
    const { words, spoken } = await hear(await earsOf(transcriber(other), aligner), CLIP, 'formula', SCRIPT, 'en', LENGTH);
    expect(words).toBeNull();
    expect(spoken.share).toBeCloseTo(1 / 3);
    expect(aligner.calls).toEqual([]);
  });

  it('exactly half of the script heard is enough', async () => {
    const half: Word[] = [{ text: 'aloe', start: 0.3, end: 0.8 }, { text: 'shea', start: 0.9, end: 1.3 }];
    const { words, spoken } = await hear(await earsOf(transcriber(half), undefined), CLIP, 'formula', ['Aloe,', 'shea,', 'zzzzzzzz,', 'qqqqqqqq.'], 'en', LENGTH);
    expect(spoken.share).toBe(0.5);
    expect(words).toEqual(half);
  });

  it('good scores: the script\'s words with the aligner\'s times', async () => {
    const aligner = fakeAligner(READY);
    const { words, spoken } = await hear(await earsOf(transcriber(), aligner), CLIP, 'formula', SCRIPT, 'en', LENGTH);
    expect(aligner.calls).toEqual([{ media: CLIP, words: SCRIPT, language: 'en' }]);
    const starts = aligned([1, 1, 1]).map((word) => word.start);
    expect(words!.map((word) => word.text)).toEqual(SCRIPT);
    expect(words!.map((word) => word.start)).toEqual(starts);
    // words that follow each other closely are back to back: a word ends where the next begins; the last ends a little after the aligner's end
    expect(words!.map((word) => word.end)).toEqual([starts[1], starts[2], aligned([1, 1, 1])[2]!.end + 0.15]);
    expect(spoken).toMatchObject({ times: 'aligner', share: 1 });
    expect(spoken.why).toMatch(/0\.94/);                        // the mean score
    // resolve gives every script word exactly these starts
    expect(alignWords(SCRIPT, words!).map((time) => time.start)).toEqual(words!.map((word) => word.start));
    expect(words!.map((word) => word.start)).not.toEqual(HEARD.map((word) => word.start));
  });

  it('a word with score 0 was not placed by the model: it is left out, and resolve puts it between its neighbours', async () => {
    const script = [...SCRIPT, 'Done.'];
    const answer = [...aligned([0.95, 0, 0.97]), { text: 'Done.', start: 2.1, end: 2.4, score: 0.98 }];
    const heard = [...HEARD, { text: 'done', start: 2.1, end: 2.4 }];
    const { words, spoken } = await hear(await earsOf(transcriber(heard), fakeAligner(READY, answer)), CLIP, 'formula', script, 'en', LENGTH);
    expect(spoken.times).toBe('aligner');                       // (0.95 + 0 + 0.97 + 0.98) / 4 = 0.725
    expect(words!.map((word) => word.text)).toEqual(['Aloe,', 'jojoba.', 'Done.']);
    const times = alignWords(script, words!);
    expect(times[1]!.start).toBeGreaterThanOrEqual(times[0]!.start);
    expect(times[1]!.end).toBeLessThanOrEqual(times[2]!.start);
  });

  it('low scores: the words were forced onto other speech, the recogniser\'s times stay', async () => {
    const aligner = fakeAligner(READY, aligned([0.4, 0.9, 0.7]));                  // mean 0.667
    const { words, spoken } = await hear(await earsOf(transcriber(), aligner), CLIP, 'formula', SCRIPT, 'en', LENGTH);
    expect(words).toEqual(HEARD);
    expect(spoken.times).toBe('recogniser');
    expect(spoken.why).toMatch(/0\.67.*0\.7/);
  });

  it('a mean score just over 0.7 takes the aligner\'s times', async () => {
    const aligner = fakeAligner(READY, aligned([0.71, 0.71, 0.71]));
    expect((await hear(await earsOf(transcriber(), aligner), CLIP, 'formula', SCRIPT, 'en', LENGTH)).spoken.times).toBe('aligner');
  });

  it('a mean score of exactly 0.7 takes the aligner\'s times: three words of 0.7', async () => {
    const aligner = fakeAligner(READY, aligned([0.7, 0.7, 0.7]));         // 0.7 + 0.7 + 0.7 is 2.0999999999999996
    const { spoken } = await hear(await earsOf(transcriber(), aligner), CLIP, 'formula', SCRIPT, 'en', LENGTH);
    expect(spoken).toMatchObject({ times: 'aligner', why: 'the aligner\'s mean score is 0.70' });
    const under = fakeAligner(READY, aligned([0.7, 0.7, 0.69]));
    expect((await hear(await earsOf(transcriber(), under), CLIP, 'formula', SCRIPT, 'en', LENGTH)).spoken.times).toBe('recogniser');
  });

  const broken: [string, unknown][] = [
    ['is not a list', null],
    ['has an entry that is nothing', [aligned([0.9, 0.9, 0.9])[0], null, aligned([0.9, 0.9, 0.9])[2]]],
    ['has a start that is not a number', aligned([0.9, 0.9, 0.9]).map((word, i) => (i === 1 ? { ...word, start: Number.NaN } : word))],
    ['has a start before the clip', aligned([0.9, 0.9, 0.9]).map((word, i) => (i === 0 ? { ...word, start: -0.5 } : word))],
    ['goes backwards', aligned([0.9, 0.9, 0.9]).map((word, i) => (i === 2 ? { ...word, start: 0.1 } : word))],
    ['has a score over 1', aligned([0.9, 1.2, 0.9])],
    ['has a score that is not a number', aligned([0.9, Number.NaN, 0.9])],
  ];
  it.each(broken)('an answer that %s is not used, and the clip is not failed', async (_what, answer) => {
    const aligner = fakeAligner(READY, answer as AlignedWord[]);
    const { words, spoken } = await hear(await earsOf(transcriber(), aligner), CLIP, 'formula', SCRIPT, 'en', LENGTH);
    expect(words).toEqual(HEARD);
    expect(spoken.times).toBe('recogniser');
    expect(spoken.why).toMatch(/^the aligner's answer was not used: /);
  });

  describe('pauses', () => {
    const FOUR = ['So', 'this', 'is', 'it.'];
    const said: Word[] = FOUR.map((text, i) => ({ text: text.replace('.', ''), start: 0.2 + i * 0.4, end: 0.5 + i * 0.4 }));
    const answer = (times: [number, number][]): AlignedWord[] => times.map(([start, end], i) => ({ text: FOUR[i]!, start, end, score: 0.95 }));
    const endsOf = async (times: [number, number][], seconds = 4) => {
      const { words, spoken } = await hear(await earsOf(new FakeTranscriber({ by: { [CLIP]: said } }), fakeAligner(READY, answer(times))), CLIP, 'trial', FOUR, 'en', seconds);
      expect(spoken.times).toBe('aligner');
      expect(words!.map((word) => word.start)).toEqual(times.map(([start]) => start));
      return words!.map((word) => word.end);
    };

    it('2 s of silence: the word before it ends shortly after its own sound, not at the next word', async () => {
      expect(await endsOf([[0.2, 0.5], [0.52, 0.9], [2.9, 3.2], [3.25, 3.6]])).toEqual([0.52, 0.9 + 0.15, 3.25, 3.6 + 0.15]);
    });

    it('a gap under 0.35 s is no pause: the word ends where the next begins; from 0.35 s on it is one', async () => {
      expect((await endsOf([[0.2, 0.5], [0.52, 0.9], [1.24, 1.5], [1.6, 2]]))[1]).toBe(1.24);                // a gap of 0.34 s
      expect((await endsOf([[0.2, 0.5], [0.52, 0.9], [1.3, 1.5], [1.6, 2]]))[1]).toBe(0.9 + 0.15);          // a gap of 0.4 s
      expect(PAUSE_SECONDS).toBe(0.35);
      expect(TAIL_SECONDS).toBe(0.15);
    });

    it('the last word ends at the clip\'s end at the latest', async () => {
      expect((await endsOf([[0.2, 0.5], [0.52, 0.9], [2.9, 3.2], [3.25, 3.95]], 4))[3]).toBe(4);
    });

    it('a start after the clip\'s end, or an end that is not after its start, makes the answer unusable', async () => {
      for (const times of [[[0.2, 0.5], [0.52, 0.9], [2.9, 3.2], [500, 500.3]], [[0.2, 0.5], [0.52, Number.NaN], [2.9, 3.2], [3.25, 3.6]], [[0.2, 0.5], [0.52, 0.4], [2.9, 3.2], [3.25, 3.6]]] as [number, number][][]) {
        const { words, spoken } = await hear(await earsOf(new FakeTranscriber({ by: { [CLIP]: said } }), fakeAligner(READY, answer(times))), CLIP, 'trial', FOUR, 'en', 4);
        expect(words).toEqual(said);
        expect(spoken).toMatchObject({ times: 'recogniser', why: expect.stringMatching(/^the aligner's answer was not used: /) });
      }
    });
  });

  it('a rejection never fails the clip: the recogniser\'s times stay, and the reason is kept', async () => {
    const aligner = fakeAligner(READY, Object.assign(new Error('no alignment model for "tr": English only'), { code: 'language-unsupported' }));
    const { words, spoken } = await hear(await earsOf(transcriber(), aligner), CLIP, 'formula', SCRIPT, 'tr', LENGTH);
    expect(words).toEqual(HEARD);
    expect(spoken.times).toBe('recogniser');
    expect(spoken.why).toMatch(/rejected.*English only/);
  });

  it('an answer that is not one entry per word is not used', async () => {
    const aligner = fakeAligner(READY, aligned([0.95, 0.9, 0.97]).slice(0, 2));
    const { words, spoken } = await hear(await earsOf(transcriber(), aligner), CLIP, 'formula', SCRIPT, 'en', LENGTH);
    expect(words).toEqual(HEARD);
    expect(spoken.times).toBe('recogniser');
  });

  it('not ready: align is never called', async () => {
    const aligner = fakeAligner({ ready: false, note: 'no Python environment' });
    const { words, spoken } = await hear(await earsOf(transcriber(), aligner), CLIP, 'formula', SCRIPT, 'en', LENGTH);
    expect(aligner.calls).toEqual([]);
    expect(words).toEqual(HEARD);
    expect(spoken).toMatchObject({ times: 'recogniser', why: 'the aligner is not ready: no Python environment' });
  });

  it('a ready() that rejects counts as not ready', async () => {
    const aligner = fakeAligner(new Error('spawn failed'));
    const ears = await earsOf(transcriber(), aligner);
    expect((await hear(ears, CLIP, 'formula', SCRIPT, 'en', LENGTH)).spoken).toMatchObject({ times: 'recogniser', why: 'the aligner is not ready: spawn failed' });
  });

  it('ready() is asked once for all clips', async () => {
    const aligner = fakeAligner(READY);
    const ears = await earsOf(new FakeTranscriber({ by: { [CLIP]: HEARD, '/clips/s2.mp4': HEARD } }), aligner);
    await hear(ears, CLIP, 'formula', SCRIPT, 'en', LENGTH);
    await hear(ears, '/clips/s2.mp4', 'verdict', SCRIPT, 'en', LENGTH);
    expect(aligner.asked).toBe(1);
    expect(aligner.calls.map((call) => call.media)).toEqual([CLIP, '/clips/s2.mp4']);
  });
});
