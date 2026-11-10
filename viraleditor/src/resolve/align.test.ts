import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Word } from '../ports.ts';
import { alignWords, alignmentShare } from './align.ts';
import { parseScript } from './script.ts';

/** Heard words laid end to end, 0.3 s each, from 1 s on. */
const heard = (...texts: string[]): Word[] => texts.map((text, i) => ({ text, start: 1 + i * 0.3, end: 1.3 + i * 0.3 }));
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe('alignWords', () => {
  it('identical words keep their heard times, whatever their case and punctuation', () => {
    const times = alignWords(['Look', 'at', 'them', 'now.'], heard('look', 'at', 'them', 'now'));
    expect(times).toHaveLength(4);
    times.forEach((time, i) => { close(time.start, 1 + i * 0.3); close(time.end, 1.3 + i * 0.3); });
  });
  it('a near match still pairs: "tried" takes the time of a heard "try"', () => {
    const times = alignWords(['I', 'tried', 'the', 'serum'], heard('I', 'try', 'the', 'serum'));
    close(times[1]!.start, 1.3);
    close(times[1]!.end, 1.6);
  });
  it('a heard word the script does not have is passed over', () => {
    const times = alignWords(['before', 'and', 'after.'], heard('before', 'and', 'an', 'after'));
    close(times[1]!.start, 1.3);
    close(times[2]!.start, 1.9);
  });
  it('a word that was not heard lies in the hole between its neighbours', () => {
    const words: Word[] = [{ text: 'one', start: 1, end: 1.3 }, { text: 'three', start: 2, end: 2.4 }];
    const [, two] = alignWords(['one', 'two', 'three'], words);
    close(two!.start, 1.3);
    close(two!.end, 2);
  });
  it('a word that was not heard and has no hole takes a share of the word before it', () => {
    const [one, two, three] = alignWords(['one', 'two', 'three'], heard('one', 'three'));
    expect(two!.start).toBeGreaterThan(one!.start);
    expect(one!.end).toBeLessThanOrEqual(two!.start);
    expect(two!.end).toBeLessThanOrEqual(three!.start);
    expect(two!.end).toBeGreaterThan(two!.start);
  });
  it('merge move: one script word heard as two takes the start of the first and the end of the second', () => {
    const times = alignWords(['the', 'Glowly', 'serum'], heard('the', 'Glow', 'Lee', 'serum'));
    close(times[1]!.start, 1.3);
    close(times[1]!.end, 1.9);
    close(times[2]!.start, 1.9);
  });
  it('merge move: two script words heard as one share its time by their letters', () => {
    const times = alignWords(['your', 'lash', 'line', 'now'], [{ text: 'your', start: 1, end: 1.3 }, { text: 'lashline', start: 1.3, end: 2.1 }, { text: 'now', start: 2.1, end: 2.4 }]);
    close(times[1]!.start, 1.3);
    close(times[1]!.end, 1.7);
    close(times[2]!.start, 1.7);
    close(times[2]!.end, 2.1);
  });
  it('words at the edges that were not heard still get a time, in order', () => {
    const times = alignWords(['So', 'look', 'at', 'them', 'now.'], heard('look', 'at'));
    expect(times.every((time) => Number.isFinite(time.start) && time.end >= time.start && time.start >= 0)).toBe(true);
    expect(times[0]!.end).toBeLessThanOrEqual(times[1]!.start);
    expect(times[3]!.start).toBeGreaterThanOrEqual(times[2]!.end);
    expect(times[4]!.start).toBeGreaterThanOrEqual(times[3]!.start);
  });
  it('nothing heard: every word still gets a time from 0 on', () => {
    const times = alignWords(['one', 'two'], []);
    expect(times[0]!.start).toBe(0);
    expect(times[1]!.start).toBeGreaterThan(0);
    expect(alignWords([], heard('one'))).toEqual([]);
  });
  it('does not change the heard words it is given', () => {
    const words = heard('one', 'three');
    const before = JSON.stringify(words);
    alignWords(['one', 'two', 'three'], words);
    expect(JSON.stringify(words)).toBe(before);
  });
});

describe('alignmentShare', () => {
  it('is 1 when the clip speaks its lines, also through a misheard letter and a split name', () => {
    expect(alignmentShare(['the', 'lash', 'serum', 'Lashly', 'works'], heard('the', 'last', 'serum', 'Lash', 'Lee', 'works'))).toBe(1);
  });
  it('a word less than half alike gets a time but does not count: "tried" heard as "try"', () => {
    expect(alignmentShare(['I', 'tried', 'the', 'Lashly', 'serum'], heard('I', 'try', 'the', 'Lash', 'Lee', 'serum'))).toBe(0.8);
  });
  it('a dash or an emoji standing alone is not a word that can be heard', () => {
    expect(alignmentShare(['one', '—', 'two', '✨'], heard('one', 'two'))).toBe(1);
  });
  it('is low when the clip speaks other lines, although every word still gets a time', () => {
    const script = ['Look', 'at', 'them', 'now.', 'The', 'box', 'said', 'two', 'weeks.'];
    const other = heard('Aloe', 'shea', 'jojoba', 'and', 'you', 'just', 'swipe', 'it', 'on');
    expect(alignWords(script, other)).toHaveLength(9);
    expect(alignmentShare(script, other)).toBeLessThan(0.5);
  });
  it('counts a word that was not heard as not spoken', () => {
    expect(alignmentShare(['one', 'two', 'three', 'four'], heard('one', 'two', 'three'))).toBe(0.75);
  });
  it('is 1 for lines without words', () => {
    expect(alignmentShare([], heard('one'))).toBe(1);
  });
});

describe('the transcript of the spike (whisper small.en on the 30 s sample), against the lines the sample speaks', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../../docs/reference/fixtures/transcript.json', import.meta.url), 'utf8')) as Word[];
  const fill = JSON.parse(readFileSync(new URL('./golden/lashly-01/fill.json', import.meta.url), 'utf8')) as { script: Record<string, string> };
  const script = Object.values(fill.script).flatMap((lines) => parseScript(lines).words);

  it('times 88 of 88 script words, and no word starts before the one before it', () => {
    expect(fixture).toHaveLength(91);
    expect(script).toHaveLength(88);
    const times = alignWords(script, fixture);
    expect(times).toHaveLength(88);
    expect(times.every((time) => Number.isFinite(time.start) && Number.isFinite(time.end) && time.end >= time.start)).toBe(true);
    for (let i = 1; i < times.length; i++) expect(times[i]!.start, script[i]).toBeGreaterThanOrEqual(times[i - 1]!.start);
    expect(times[0]!.start).toBeCloseTo(0.07, 9);                     // "I"
    expect(times[1]!.start).toBeCloseTo(0.09, 9);                     // "tried", heard as "try"
    expect(times.at(-1)!.end).toBeLessThanOrEqual(30.1);
  });
  it('pairs nearly every script word with a similar heard word', () => {
    expect(alignmentShare(script, fixture)).toBeGreaterThanOrEqual(0.95);
  });
});
