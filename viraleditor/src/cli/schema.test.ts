// `schema`: the field reference comes from the schema the editor checks with, and docs/reference/edit-format.md is what
// `schema --markdown` prints.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { parseEdit } from '../edit/schema.ts';
import { cli } from './commands.ts';
import { DEFAULTS, NOTES } from './notes.ts';
import { reference } from './reference.ts';
import { ask, fakeContext, fixture } from './testing.ts';

vi.setConfig({ testTimeout: 60_000 });
const FILE = fileURLToPath(new URL('../../../docs/reference/edit-format.md', import.meta.url));
const fields = reference().sections.flatMap((section) => section.fields);
const byPath = new Map(fields.map((field) => [field.path, field]));

describe('schema', () => {
  it('--markdown prints what docs/reference/edit-format.md holds', async () => {
    const printed = (await cli(['schema', '--markdown'], fakeContext().context)).stdout;
    expect(printed === readFileSync(FILE, 'utf8'), 'docs/reference/edit-format.md is stale: in viraleditor/ run `node src/cli/main.ts schema --markdown > ../docs/reference/edit-format.md`').toBe(true);
  });

  it('has one line for every field of the schema, and none for a field that is gone', () => {
    expect(Object.keys(NOTES).filter((path) => !byPath.has(path))).toEqual([]);
    expect(fields.filter((field) => field.note.length < 10).map((field) => field.path)).toEqual([]);
    expect(new Set(fields.map((field) => field.path)).size).toBe(fields.length);
    expect(fields.length).toBeGreaterThan(180);
  });
  it('gives a stand-in only to a field that may be left out', () => {
    expect(Object.keys(DEFAULTS).filter((path) => !byPath.has(path))).toEqual([]);
    expect(Object.keys(DEFAULTS).filter((path) => byPath.get(path)!.default === 'required')).toEqual([]);
  });
  it('takes types and ranges from the schema, limits and defaults from the presets', () => {
    expect(byPath.get('frames')).toMatchObject({ type: 'whole number 1 … 1800', default: 'required' });
    expect(byPath.get('shots')).toMatchObject({ type: 'list of objects (at least 1, at most 120)', default: 'required' });
    expect(byPath.get('shots[].from')).toMatchObject({ type: 'whole number ≥ 0', default: '0' });
    expect(byPath.get('shots[].motion')).toMatchObject({ type: 'Motion', default: 'none' });
    expect(byPath.get('shots[].windows[].width')).toMatchObject({ type: 'number 20 … 60', default: '38' });
    expect(byPath.get('texts[].box')).toMatchObject({ type: 'Box', default: 'required' });
    expect(byPath.get('captions.words[].text')!.type).toBe('word (≤ 60 characters)');
    expect(byPath.get('captions.active')!.default).toBe('{ "kind": "colour", "colour": "#ffe000", "scale": 1.06 }');
    expect(byPath.get('audio.music.duck.under')!.type).toBe('"sound", or "captions", or list of objects (at most 600)');
    expect(byPath.get('audio.master')).toMatchObject({ type: 'object, or false', default: '{ "lufs": -14, "peak": -1 }' });
    expect(byPath.get('Transition{crossfade}.frames')).toMatchObject({ type: 'whole number ≥ 1', default: '8' });
    expect(byPath.get('Motion{punch-in}')!.type).toBe('{ "kind": "punch-in", at, to?, frames? }');
    expect(byPath.get('Enter{slide}.from')!.default).toBe('required');
  });
  it('names every field a real document uses', () => {
    // the fixture passes the schema; every key in it must be a path of the reference
    const edit = fixture('small');
    expect(parseEdit(edit).ok).toBe(true);
    const paths = (value: unknown, at: string): string[] => {
      if (Array.isArray(value)) return value.flatMap((item) => paths(item, `${at}[]`));
      if (value === null || typeof value !== 'object') return [];
      return Object.entries(value).flatMap(([key, child]) => {
        const here = at === 'media' || at === 'styles' ? `${at}.<${at === 'media' ? 'key' : 'name'}>` : at === '' ? key : `${at}.${key}`;
        return [here, ...paths(child, here)];
      });
    };
    const shaped = (path: string) => path.replace(/^(texts|cards)\[\]\.box\./, 'Box.').replace(/^captions\.box\./, 'Box.').replace(/\.(motion|in)\.kind$/, '.$1').replace(/^shots\[\]\.motion.*$/, 'shots[].motion').replace(/^shots\[\]\.in.*$/, 'shots[].in');
    const unknown = [...new Set(paths(edit, '').map(shaped))].filter((path) => !byPath.has(path) && !/^(media|styles)\.<(key|name)>$/.test(path));
    expect(unknown).toEqual([]);
  });

  it('answers with the reference as data, and with --markdown as one text', async () => {
    const { context, calls } = fakeContext();
    const ran = await ask(context, ['schema']);
    expect(ran.exit).toBe(0);
    expect(Object.keys(ran.json)).toEqual(['ok', 'command', 'issues', 'warnings', 'result']);
    expect(ran.json.result.sections.map((section: { title: string }) => section.title)).toEqual(
      ['The document', 'canvas', 'media', 'styles', 'shots', 'texts', 'captions', 'cards', 'audio', 'Box', 'Motion', 'Transition', 'Enter', 'Exit']);
    expect(ran.json.result.styles.map((style: { name: string }) => style.name)).toEqual(['hook', 'label', 'tag', 'caption']);
    expect(ran.json.result.styles[0]).toMatchObject({ font: 'Inter', weight: 800, size1080: 72, size720: 48, enter: 'pop 8', exit: 'fade 6' });
    expect(ran.json.result.safeAreas[0]).toEqual({ safe: 'both', area: 'left 6, top 14, right 94, bottom 65', buttons: 'left 86, top 45, right 100, bottom 65' });
    expect(ran.json.result.limits.length).toBeGreaterThan(10);
    expect(calls).toEqual([]);                                                            // it starts no tool
    const markdown = await ask(context, ['schema', '--markdown']);
    expect(markdown.json.result.markdown).toBe(readFileSync(FILE, 'utf8'));
    const text = (await cli(['schema'], context)).stdout;
    expect(text).toContain('  shots[].from: whole number ≥ 0, default 0. ');
    expect(text).toContain('  hook: Inter 800, 72 / 48 px');
  });
  it('names the flag that was meant', async () => {
    const ran = await ask(fakeContext().context, ['schema', '--markdwn']);
    expect(ran.exit).toBe(2);
    expect(ran.json.issues[0]).toMatchObject({ code: 'unknown-flag', target: '--markdwn' });
    expect(ran.json.issues[0].fix).toContain('Did you mean --markdown?');
  });
});
