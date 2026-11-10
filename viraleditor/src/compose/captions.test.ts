import { describe, expect, it } from 'vitest';
import { stylesOf } from '../edit/presets.ts';
import type { Captions, EditIssue } from '../edit/types.ts';
import { planCaptions } from './captions.ts';
import { shortEdit, shortFacts } from './fixture.ts';
import { compose } from './index.ts';

/** The groups of the short document with other caption words, as `text@at+for` per line. */
function groupsOf(words: [string, number, number][], group?: Captions['group'], change: (captions: Captions) => void = () => {}) {
  const edit = shortEdit();
  edit.captions = { ...edit.captions!, words: words.map(([text, at, length]) => ({ text, at, for: length })), group };
  change(edit.captions);
  const issues: EditIssue[] = [];
  const plan = planCaptions(edit, stylesOf(edit), issues);
  return { issues, groups: plan?.groups.map((g) => ({ at: g.at, end: g.end, lines: g.lines.map((line) => line.map((w) => w.text).join(' ')) })) ?? [] };
}

describe('caption groups (design §5.5)', () => {
  it('closes a group when it has `words` words (3 when the document gives none, never more than it says)', () => {
    const words: [string, number, number][] = [['a', 0, 5], ['b', 5, 5], ['c', 10, 5], ['d', 15, 5], ['e', 20, 5]];
    expect(groupsOf(words).groups.map((g) => g.lines)).toEqual([['A B C'], ['D E']]);
    expect(groupsOf(words, { words: 2 }).groups.map((g) => g.lines)).toEqual([['A B'], ['C D'], ['E']]);
    expect(groupsOf(words, { words: 4 }).groups.map((g) => g.lines)).toEqual([['A B C D'], ['E']]);
  });

  it('closes a group when the next word starts `pause` frames or more after the last one ended', () => {
    const words: [string, number, number][] = [['a', 0, 5], ['b', 19, 5], ['c', 39, 5]];
    expect(groupsOf(words).groups.map((g) => g.lines)).toEqual([['A B'], ['C']]);              // gaps of 14 and 15: the default pause is 15
    expect(groupsOf(words, { pause: 14 }).groups).toHaveLength(3);
  });

  it('closes a group after a word that ends a sentence', () => {
    const words: [string, number, number][] = [['so', 0, 5], ['good.', 5, 5], ['Try', 10, 5], ['it!', 15, 5], ['now', 20, 5]];
    expect(groupsOf(words).groups.map((g) => g.lines)).toEqual([['SO GOOD.'], ['TRY IT!'], ['NOW']]);
  });

  it('closes a group when one more word would not fit on its lines, and balances two lines by width', () => {
    const words: [string, number, number][] = [['lashes', 0, 5], ['growing', 5, 5], ['visibly', 10, 5], ['x', 15, 5]];
    expect(groupsOf(words).groups.map((g) => g.lines)).toEqual([['LASHES', 'GROWING'], ['VISIBLY X']]);      // a third word fits neither line
    expect(groupsOf(words, { lines: 1 }).groups.map((g) => g.lines)).toEqual([['LASHES'], ['GROWING'], ['VISIBLY X']]);
    expect(groupsOf([['my', 0, 5], ['lashes', 5, 5], ['are', 10, 5], ['growing', 15, 5]], { words: 4 }).groups[0]!.lines).toEqual(['MY LASHES', 'ARE GROWING']);
    expect(groupsOf([['never', 0, 5], ['looked', 5, 5], ['so', 10, 5]]).groups[0]!.lines).toEqual(['NEVER', 'LOOKED SO']);
  });

  it('keeps a group on screen until the next one begins, at most `hold` frames after its last word, never past the video', () => {
    const words: [string, number, number][] = [['one.', 0, 10], ['two.', 12, 10], ['three.', 60, 10], ['four', 172, 6]];
    expect(groupsOf(words).groups.map((g) => [g.at, g.end])).toEqual([[0, 12], [12, 34], [60, 82], [172, 180]]);
    expect(groupsOf(words, { hold: 0 }).groups.map((g) => [g.at, g.end])).toEqual([[0, 10], [12, 22], [60, 70], [172, 178]]);
  });

  it('reports every word that cannot be shown, and groups nothing then', () => {
    const { issues, groups } = groupsOf([['fine', 0, 5], ['incomprehensibilities', 5, 5], ['你好', 10, 5]]);
    expect(issues.map((i) => `${i.code} @ ${i.path}`)).toEqual(['caption-word-too-long @ captions.words[1].text', 'text-glyph @ captions.words[2].text']);
    expect(groups).toEqual([]);
  });

  it('makes no group and no issue for no words', () => {
    expect(groupsOf([])).toEqual({ issues: [], groups: [] });
    const edit = shortEdit();
    edit.captions!.words = [];
    expect(compose(edit, shortFacts()).timeline.captions).toEqual([]);
  });
});

describe('caption groups in the composition', () => {
  it('shortens the enter of a group that is shorter than it, so that one frame is at rest', () => {
    const edit = shortEdit();
    edit.captions!.words = [{ text: 'go.', at: 62, for: 3 }, { text: 'now', at: 65, for: 20 }];
    const { timeline, html } = compose(edit, shortFacts());
    expect(timeline.captions.map((c) => [c.at, c.for, c.rest])).toEqual([[62, 3, { at: 64, for: 1 }], [65, 32, { at: 70, for: 27 }]]);
    expect(timeline.animations.filter((a) => a.element === 'cap-1' && a.property === 'scale')).toMatchObject([{ at: 62, for: 2 }]);
    expect(html).toContain(`<div id="cap-1" class="clip ve-cap ve-m st-caption-84"`);
  });

  it('shows a group of one frame without an enter', () => {
    const edit = shortEdit();
    edit.captions!.words = [{ text: 'go.', at: 62, for: 1 }, { text: 'now', at: 63, for: 20 }];
    const { timeline, html } = compose(edit, shortFacts());
    expect(timeline.captions[0]).toMatchObject({ at: 62, for: 1, rest: { at: 62, for: 1 } });
    expect(timeline.animations.filter((a) => a.element === 'cap-1')).toEqual([]);
    expect(html).toContain('<div id="cap-1" class="clip ve-cap st-caption-84"');
  });

  it('leaves the words alone when no word is to be marked', () => {
    const edit = shortEdit();
    edit.captions!.active = { kind: 'none' };
    const { timeline, html } = compose(edit, shortFacts());
    expect(timeline.animations.filter((a) => a.property === 'active')).toEqual([]);
    expect(html).toContain('<span id="cap-1-w1" class="ve-w">NEVER</span>');
  });
});
