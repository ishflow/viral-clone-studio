import { describe, expect, it } from 'vitest';
import { ResolveError } from './error.ts';
import { parseScript } from './script.ts';

const codeOf = (lines: string): string => {
  try { parseScript(lines); } catch (error) { if (error instanceof ResolveError) return error.code; throw error; }
  return 'no error';
};

describe('parseScript', () => {
  it('gives the words in order and the word range of every mark', () => {
    expect(parseScript('It is [name]the new serum.[/name] Try it.')).toEqual({
      words: ['It', 'is', 'the', 'new', 'serum.', 'Try', 'it.'],
      marks: { name: { from: 2, to: 4 } },
    });
  });
  it('keeps punctuation on the word and takes any white space as a separator', () => {
    expect(parseScript('  Wait,\n what?   Really!\t').words).toEqual(['Wait,', 'what?', 'Really!']);
  });
  it('reads a mark that touches its words without a space', () => {
    expect(parseScript('[a]one two[/a]three').marks).toEqual({ a: { from: 0, to: 1 } });
  });
  it('lets marks nest and cross', () => {
    expect(parseScript('[outer]one [inner]two[/inner] three[/outer]').marks).toEqual({ outer: { from: 0, to: 2 }, inner: { from: 1, to: 1 } });
    expect(parseScript('[a]one [b]two[/a] three[/b]').marks).toEqual({ a: { from: 0, to: 1 }, b: { from: 1, to: 2 } });
  });
  it('has no marks and no words for an empty text', () => {
    expect(parseScript('')).toEqual({ words: [], marks: {} });
  });
  it('holds a mark called like a property of every object', () => {
    expect(parseScript('[constructor]one[/constructor]').marks).toEqual({ constructor: { from: 0, to: 0 } });
  });

  it('mark-unbalanced: a mark that never closes, closes without opening, or opens twice', () => {
    expect(codeOf('[a]one two')).toBe('mark-unbalanced');
    expect(codeOf('one two[/a]')).toBe('mark-unbalanced');
    expect(codeOf('[a]one [a]two[/a][/a]')).toBe('mark-unbalanced');
  });
  it('mark-unbalanced: a bracket that is not a mark is refused, not dropped', () => {
    expect(codeOf('one [laughs out loud] two')).toBe('mark-unbalanced');
    expect(codeOf('one ] two')).toBe('mark-unbalanced');
    expect(codeOf('[Shout]one[/Shout]')).toBe('mark-unbalanced');
  });
  it('mark-duplicate: a name used for a second range', () => {
    expect(codeOf('[a]one[/a] [a]two[/a]')).toBe('mark-duplicate');
  });
  it('mark-empty: a mark around no word', () => {
    expect(codeOf('one [a][/a] two')).toBe('mark-empty');
  });
  it('word-too-long: a word a caption cannot show', () => {
    expect(codeOf(`one ${'x'.repeat(61)}`)).toBe('word-too-long');
    expect(codeOf(`one ${'x'.repeat(60)}`)).toBe('no error');
  });
  it('names the mark in the message', () => {
    expect(() => parseScript('[tube]one')).toThrow(/\[tube\]/);
  });
});
