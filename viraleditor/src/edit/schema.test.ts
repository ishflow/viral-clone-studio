import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { shortEdit } from '../compose/fixture.ts';
import { COUNTS, STRINGS } from './presets.ts';
import { MAX_ISSUES, cut, issuesOf as zodIssues, parseEdit, pathOf } from './schema.ts';
import type { EditIssue } from './types.ts';

/** The short document as plain JSON, changed by `change`. */
function changed(change: (doc: any) => void): unknown {
  const doc = JSON.parse(JSON.stringify(shortEdit()));
  change(doc);
  return doc;
}
function issuesOf(json: unknown): EditIssue[] {
  const result = parseEdit(json);
  return result.ok ? [] : result.issues;
}
function only(json: unknown): EditIssue {
  const issues = issuesOf(json);
  expect(issues).toHaveLength(1);
  return issues[0]!;
}

describe('parseEdit', () => {
  it('accepts the short document of the design and gives it back', () => {
    const result = parseEdit(JSON.parse(JSON.stringify(shortEdit())));
    expect(result).toEqual({ ok: true, edit: shortEdit() });
  });

  it('names a missing field, what was expected and how to add it', () => {
    const issue = only(changed((d) => { delete d.shots[1].media; }));
    expect(issue).toMatchObject({ code: 'schema', path: 'shots[1].media' });
    expect(issue.message).toBe('shots[1].media is missing; expected a string');
    expect(issue.fix).toContain('add "media"');
  });

  it('writes the path of a number that is not whole as in the design, with the whole number to use', () => {
    const issue = only(changed((d) => { d.shots[2].in.frames = 7.5; }));
    expect(issue).toMatchObject({ code: 'schema', path: 'shots[2].in.frames' });
    expect(issue.message).toBe('shots[2].in.frames is 7.5; expected a whole number');
    expect(issue.fix).toContain('8');
  });

  it('refuses an unknown field and lists the fields that exist there', () => {
    const issue = only(changed((d) => { d.shots[0].zoom = 1.2; }));
    expect(issue).toMatchObject({ code: 'schema', path: 'shots[0].zoom' });
    expect(issue.message).toBe('shots[0].zoom is an unknown field (unknown fields are errors, not ignored)');
    expect(issue.fix).toContain('remove "zoom"');
    expect(issue.fix).toContain('motion');
    const inner = only(changed((d) => { d.shots[2].in.direction = 'left'; }));
    expect(inner.path).toBe('shots[2].in.direction');
    expect(inner.fix).toContain('kind, to, frames');
  });

  it('says which kinds exist when the kind is unknown', () => {
    const issue = only(changed((d) => { d.shots[1].in = { kind: 'wipe' }; }));
    expect(issue).toMatchObject({ code: 'schema', path: 'shots[1].in.kind' });
    expect(issue.message).toContain('shots[1].in.kind is "wipe"; expected one of "cut", "crossfade"');
    expect(issue.fix).toContain('"crossfade"');
    expect(only(changed((d) => { delete d.shots[1].in.kind; })).message).toContain('shots[1].in.kind is missing; expected one of');
  });

  it('refuses a wrong type, a negative frame, a length of zero', () => {
    expect(only(changed((d) => { d.frames = '180'; }))).toMatchObject({ code: 'schema', path: 'frames' });
    expect(only(changed((d) => { d.texts[0].at = -1; })).fix).toContain('0 or more');
    expect(only(changed((d) => { d.cards[0].for = 0; })).fix).toContain('1 or more');
    expect(only(changed((d) => { d.shots[0].motion.to = Number.POSITIVE_INFINITY; })).path).toBe('shots[0].motion.to');
  });

  it('refuses an id that could not be an HTML id and proposes one that could', () => {
    const issue = only(changed((d) => { d.shots[0].id = 'Shot 1"><img'; }));
    expect(issue).toMatchObject({ code: 'schema', path: 'shots[0].id' });
    expect(issue.fix).toContain('"shot-1-img"');
    const key = only(changed((d) => { d.media['A b'] = { file: 'assets/x.png', kind: 'image' }; }));
    expect(key).toMatchObject({ code: 'schema', path: 'media["A b"]' });
    expect(key.fix).toContain('"a-b"');
    const style = only(changed((d) => { d.styles = { 'x{}': { font: 'Inter', weight: 700, size: 40, align: 'center', fill: '#ffffff', shadows: [] } }; }));
    expect(style.path).toBe('styles["x{}"]');
  });

  it('refuses a language that is no language tag and a caption word with a space', () => {
    expect(only(changed((d) => { d.language = 'en"><script>'; }))).toMatchObject({ code: 'schema', path: 'language' });
    expect(only(changed((d) => { d.captions.words[0].text = 'never looked'; })).fix).toContain('its own entry');
  });

  it('reports a canvas number that is not supported as canvas-unsupported, once', () => {
    const issue = only(changed((d) => { d.canvas = { width: 1000, height: 1000, fps: 25 }; }));
    expect(issue).toMatchObject({ code: 'canvas-unsupported', path: 'canvas' });
    expect(issue.message).toContain('1000×1000 at 25 fps');
    expect(issue.fix).toContain('1080');
  });

  it('explains the forms of a field that takes more than one', () => {
    const under = only(changed((d) => { d.audio.music.duck.under = 'speech'; }));
    expect(under.path).toBe('audio.music.duck.under');
    expect(under.message).toContain('"sound", "captions" or a list');
    const range = only(changed((d) => { d.audio.music.duck.under = [{ at: 1.5, for: 4 }]; }));
    expect(range.path).toBe('audio.music.duck.under[0].at');
    expect(only(changed((d) => { d.audio.master = true; })).message).toContain('or false');
  });

  it('collects every fault of a document, at most 100; the last one then counts those that are not listed', () => {
    const issues = issuesOf(changed((d) => { d.version = 2; delete d.language; d.shots[0].for = 1.5; d.extra = true; }));
    expect(issues.map((i) => i.path).sort()).toEqual(['extra', 'language', 'shots[0].for', 'version']);
    const many = issuesOf(changed((d) => { d.shots = Array.from({ length: 120 }, () => ({})); }));      // id, at, for and media are missing 120 times
    expect(MAX_ISSUES).toBe(100);
    expect(many).toHaveLength(MAX_ISSUES);
    expect(many.slice(0, 99).every((issue) => issue.code === 'schema')).toBe(true);
    expect(many[99]).toMatchObject({ code: 'more-issues', path: '(the document)' });
    expect(many[99]!.message).toContain(`${120 * 4 - 99} more`);
    // an object with thousands of unknown keys: as many issues as fit, the rest counted
    const keys = issuesOf(changed((d) => { for (let i = 0; i < 5000; i++) d[`x${i}`] = 1; }));
    expect(keys).toHaveLength(MAX_ISSUES);
    expect(keys[99]!.message).toContain('4901 more');
  });

  it('too-many: every list of a document has a most number of entries, and a longer one is refused before anything walks it', () => {
    const list = <T>(n: number, entry: T): T[] => Array.from({ length: n }, () => entry);
    const cases: [string, number, number, (d: any) => void][] = [
      ['shots', 120, 121, (d) => { d.shots = list(121, {}); }],
      ['texts', 200, 201, (d) => { d.texts = list(201, 0); }],
      ['cards', 100, 101, (d) => { d.cards = list(101, null); }],
      ['audio.sounds', 100, 101, (d) => { d.audio.sounds = list(101, {}); }],
      ['media', 300, 301, (d) => { for (let i = 0; i < 296; i++) d.media[`m${i}`] = {}; }],
      ['styles', 50, 51, (d) => { d.styles = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, {}])); }],
      ['captions.words', 600, 601, (d) => { d.captions.words = list(601, {}); }],
      ['shots[1].windows', 8, 9, (d) => { d.shots[1].windows = list(9, {}); }],
      ['shots[0].windows[1].swaps', 8, 9, (d) => { d.shots[0].windows = [{ at: 10, for: 30, corner: 'top-left', behind: 'serum' }, { at: 10, for: 30, corner: 'top-left', behind: 'serum', swaps: list(9, {}) }]; }],
      ['audio.music.duck.under', 600, 601, (d) => { d.audio.music.duck.under = list(601, {}); }],
      ['styles.mine.shadows', 8, 9, (d) => { d.styles = { mine: { shadows: list(9, '') } }; }],
    ];
    for (const [path, limit, count, change] of cases) {
      const issue = only(changed(change));                 // the only issue: the entries, which are not even of the right shape, were not looked at
      expect(issue).toMatchObject({ code: 'too-many', path });
      expect(issue.message).toContain(`${count}`);
      expect(issue.message).toContain(`at most ${limit}`);
      expect(issue.fix).toMatch(/remove|split/);
    }
    // the numbers are one table, keyed by the place of the list
    expect(COUNTS).toEqual({
      media: 300, styles: 50, 'styles.<name>.shadows': 8, shots: 120, 'shots[].windows': 8, 'shots[].windows[].swaps': 8,
      texts: 200, 'captions.words': 600, cards: 100, 'audio.sounds': 100, 'audio.music.duck.under': 600,
    });
    expect(issuesOf(changed((d) => { d.shots = list(121, {}); d.texts = list(201, 0); })).map((i) => `${i.code} @ ${i.path}`)).toEqual(['too-many @ shots', 'too-many @ texts']);
    // exactly at a limit: the list is looked at as any other
    expect(issuesOf(changed((d) => { d.shots[1].windows = list(8, {}); })).every((i) => i.code === 'schema')).toBe(true);
  });

  it('too-long: "frames" has an upper bound, 60 s at the canvas rate; a number above it never reaches a rule', () => {
    const issue = only(changed((d) => { d.frames = 300_000_000; }));
    expect(issue).toMatchObject({ code: 'too-long', path: 'frames' });
    expect(issue.message).toContain('1800');
    expect(issue.fix).toContain('"frames"');
    expect(only(changed((d) => { d.frames = 1801; })).code).toBe('too-long');
    expect(issuesOf(changed((d) => { d.frames = 1800; }))).toEqual([]);
    // a number that is no safe integer breaks two bounds at once: still one issue
    expect(only(changed((d) => { d.frames = 2 ** 53; })).code).toBe('too-long');
    expect(only(changed((d) => { d.frames = Number.MAX_SAFE_INTEGER * 4; })).code).toBe('too-long');
  });

  it('says what was expected for a fault it has no text of its own for, never only "correct this value"', () => {
    const [issue, ...more] = zodIssues({ code: 'custom', path: ['captions', 'words', 3], message: 'a word of the script', input: 7 } as never, { captions: { words: [0, 0, 0, 7] } }, []);
    expect(more).toEqual([]);
    expect(issue).toMatchObject({ code: 'schema', path: 'captions.words[3]' });
    expect(issue!.message).toBe('captions.words[3] is 7; expected: a word of the script');
    expect(issue!.fix).toContain('a word of the script');
    expect(issue!.fix).not.toContain('correct');
  });

  it('never throws, whatever JSON it is given', () => {
    fc.assert(fc.property(fc.jsonValue(), (json) => {
      const result = parseEdit(json);
      if (result.ok) return;
      expect(result.issues.length).toBeGreaterThan(0);
      for (const issue of result.issues) {
        expect(['schema', 'canvas-unsupported', 'too-long', 'too-many', 'more-issues']).toContain(issue.code);
        expect(issue.path).not.toBe('');
        expect(issue.message).not.toBe('');
        expect(issue.fix).not.toBe('');
      }
    }), { numRuns: 300 });
  });

  it('never throws on a document that is almost right', () => {
    const paths: (string | number)[][] = [['shots'], ['shots', 0], ['shots', 1, 'in'], ['texts', 0, 'box'], ['captions'], ['captions', 'words', 0], ['audio', 'music', 'duck'], ['media'], ['canvas'], ['cards', 0]];
    fc.assert(fc.property(fc.constantFrom(...paths), fc.jsonValue(), (path, json) => {
      const doc = JSON.parse(JSON.stringify(shortEdit()));
      let at = doc;
      for (const part of path.slice(0, -1)) at = at[part];
      at[path.at(-1)!] = json;
      const result = parseEdit(doc);
      if (!result.ok) for (const issue of result.issues) expect(issue.fix).not.toBe('');
    }), { numRuns: 300 });
  });
});

describe('pathOf', () => {
  it('writes a path the way the design does', () => {
    expect(pathOf(['shots', 2, 'in', 'frames'])).toBe('shots[2].in.frames');
    expect(pathOf(['media', 'a-b', 'file'])).toBe('media.a-b.file');
    expect(pathOf([])).toBe('(the document)');
  });
});

describe('strings: every string of the document has a limit', () => {
  const BIG = 5_000_000;
  const fields: [string, (doc: any, value: string) => void][] = [
    ['language', (d, v) => { d.language = v; }],
    ['background', (d, v) => { d.background = v; }],
    ['media.a.file', (d, v) => { d.media.a.file = v; }],
    ['shots[0].id', (d, v) => { d.shots[0].id = v; }],
    ['shots[0].media', (d, v) => { d.shots[0].media = v; }],
    ['texts[0].id', (d, v) => { d.texts[0].id = v; }],
    ['texts[0].style', (d, v) => { d.texts[0].style = v; }],
    ['texts[0].copy', (d, v) => { d.texts[0].copy = v; }],
    ['captions.style', (d, v) => { d.captions.style = v; }],
    ['captions.words[0].text', (d, v) => { d.captions.words[0].text = v; }],
    ['captions.active.colour', (d, v) => { d.captions.active = { kind: 'colour', colour: v }; }],
    ['shots[0].in.colour', (d, v) => { d.shots[0].in = { kind: 'flash', colour: v }; }],
    ['cards[0].media', (d, v) => { d.cards[0].media = v; }],
    ['audio.music.media', (d, v) => { d.audio.music.media = v; }],
    ['styles.x.fill', (d, v) => { d.styles = { x: { font: 'Inter', weight: 700, size: 40, align: 'center', fill: v, shadows: [] } }; }],
    ['styles.x.shadows[0]', (d, v) => { d.styles = { x: { font: 'Inter', weight: 700, size: 40, align: 'center', fill: '#ffffff', shadows: [v] } }; }],
    ['media key', (d, v) => { d.media[v] = { file: 'assets/z.png', kind: 'image' }; }],
    ['styles key', (d, v) => { d.styles = { [v]: { font: 'Inter', weight: 700, size: 40, align: 'center', fill: '#ffffff', shadows: [] } }; }],
    ['unknown key', (d, v) => { d[v] = 1; }],
  ];

  it.each(fields)('%s: 5 MB is refused at once, and the issues never hold the value', (_name, set) => {
    const doc = changed((d) => set(d, 'a'.repeat(BIG)));
    const started = performance.now();
    const issues = issuesOf(doc);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) expect(issue.message.length + issue.fix.length + issue.path.length).toBeLessThan(1500);
  });

  it('says the length and the limit of a string that is too long, not the string', () => {
    const issue = only(changed((d) => { d.media.a.file = `assets/${'a'.repeat(300)}`; }));
    expect(issue.path).toBe('media.a.file');
    expect(issue.message).toContain('307 characters');
    expect(issue.message).toContain('at most 200');
    expect(issue.message).not.toContain('aaaaaaaaaa');
  });

  it('a document with every string exactly at its limit passes', () => {
    const doc = changed((d) => {
      d.language = 'en-aaaaaaaa-aaaa';
      d.background = `#${'f'.repeat(31)}`;
      d.media.a.file = `assets/${'a'.repeat(STRINGS.file - 7)}`;
      d.media[`k${'a'.repeat(STRINGS.id - 1)}`] = { file: 'assets/z.png', kind: 'image' };
      d.shots[0].id = 'i'.repeat(STRINGS.id);
      d.texts[0].id = 't'.repeat(STRINGS.id);
      d.texts[0].style = 's'.repeat(STRINGS.id);
      d.texts[0].copy = 'c'.repeat(STRINGS.copy);
      d.captions.style = 'z'.repeat(STRINGS.id);
      d.captions.words[0].text = 'w'.repeat(STRINGS.word);
      d.shots[1].in = { kind: 'flash', colour: `#${'0'.repeat(STRINGS.colour - 1)}` };
      d.styles = { [`k${'a'.repeat(STRINGS.id - 1)}`]: { font: 'Inter', weight: 700, size: 40, align: 'center', fill: '#fff', shadows: ['x'.repeat(STRINGS.shadow)] } };
    });
    expect(issuesOf(doc)).toEqual([]);
  });

  it('cut: a quoted value has at most 60 characters', () => {
    expect(cut('short')).toBe('short');
    expect(cut('a'.repeat(60))).toBe('a'.repeat(60));
    expect(cut('a'.repeat(61))).toBe(`${'a'.repeat(59)}…`);
    expect(cut('a'.repeat(1000), 10)).toBe(`${'a'.repeat(9)}…`);
  });
});
