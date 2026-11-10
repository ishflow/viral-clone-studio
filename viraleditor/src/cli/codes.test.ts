// `codes` lists every code the editor can give. The codes are collected from the source of the pieces that give them,
// never retyped here: a code that edit/, compose/, fit/, quality/ or the command line starts to give fails this file
// until it has its row (meanings.ts, codes.ts), and so does a row whose code nothing gives any more.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { CLI_CODES } from './codes.ts';
import { everyCode } from './commands/codes.ts';
import { cli } from './commands.ts';
import { DOCUMENT_CODES, MEDIA_CODES, RENDER_CODES } from './meanings.ts';
import { ask, fakeContext } from './testing.ts';

vi.setConfig({ testTimeout: 60_000 });
const SRC = fileURLToPath(new URL('..', import.meta.url));
type Severity = 'error' | 'warning';

/** The source files of a folder (not its tests), or of the folders under it too. */
function sources(dir: string, deep = false): string[] {
  return readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return deep && entry.name !== 'fixtures' ? sources(join(dir, entry.name), true) : [];
    return entry.name.endsWith('.ts') && !entry.name.includes('.test.') ? [join(SRC, dir, entry.name)] : [];
  });
}

/**
 * The codes a source file gives, each with the severities it is given with. It reads the places where an issue is made:
 * - a call of one of the `makers`, `add('code', …)` or `tell('code', 'error' | 'warning', …)`: the first argument, also both sides of `a ? 'x' : 'y'`;
 * - `within(ctx, 'code', …)` (edit/validate.ts);
 * - `code: 'code'` in an issue written as an object or a type, with `severity: '…'` when it follows;
 * - `code: NAME` where the file has `const NAME = 'code'`;
 * - a code built with a template, `unfilled:${name}`, as `unfilled:<placeholder>`.
 */
function codesOf(files: string[], makers = 'add|tell'): Map<string, Set<Severity>> {
  const found = new Map<string, Set<Severity>>();
  const put = (code: string, severity: string | undefined) => found.set(code, (found.get(code) ?? new Set()).add((severity ?? 'error') as Severity));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const constants = new Map([...text.matchAll(/\bconst ([A-Z][A-Z_]*) = '([a-z][a-z0-9-]*)'/g)].map((m) => [m[1]!, m[2]!]));
    for (const m of text.matchAll(new RegExp(`\\b(?:${makers})\\(\\s*([^,()\\n]+),\\s*(?:'(error|warning)')?`, 'g'))) {
      for (const literal of m[1]!.matchAll(/'([a-z][a-z0-9-]*)'/g)) put(literal[1]!, m[2]);
      const built = /^`([a-z][a-z0-9-]*):\$\{/.exec(m[1]!);
      if (built) put(`${built[1]}:<placeholder>`, m[2]);
    }
    for (const m of text.matchAll(/\bwithin\(\s*ctx,\s*'([a-z][a-z0-9-]*)'/g)) put(m[1]!, undefined);
    for (const m of text.matchAll(/\bcode:\s*(?:'([a-z][a-z0-9-]*)'|([A-Z][A-Z_]*)\b)(?:,\s*severity:\s*'(error|warning)')?/g)) {
      const code = m[1] ?? constants.get(m[2]!);
      if (code !== undefined) put(code, m[3]);
    }
  }
  return found;
}

const document = codesOf([...sources('edit'), ...sources('compose'), ...sources('fit')]);
const media = codesOf(sources('quality').filter((file) => file.endsWith('inputs.ts')));
const render = codesOf(sources('quality').filter((file) => !file.endsWith('inputs.ts')));
// what the renderer and the other tools report never reaches an answer under a code of its own: translate.ts turns it
// into an issue of the command line, so the codes of that side are the `issue('…')` calls of this folder
const commandLine = codesOf(sources('cli', true), 'issue');
const names = (found: Map<string, unknown>): string[] => [...found.keys()].sort();

describe('the collector', () => {
  it('finds the codes of every piece where they are made', () => {
    expect(names(document)).toEqual(expect.arrayContaining(['schema', 'too-many', 'more-issues', 'shots-gap', 'gain-range', 'sound-duplicate', 'card-duplicate', 'blur-too-many', 'unfilled:<placeholder>', 'text-too-long', 'text-glyph', 'caption-word-too-long']));
    expect(names(media)).toEqual(expect.arrayContaining(['media-missing', 'media-colour', 'tool-failed']));
    expect(names(render)).toEqual(expect.arrayContaining(['output-mismatch', 'wrong-footage', 'text-unverified', 'tool-failed', 'low-contrast']));
    expect(names(commandLine)).toEqual(expect.arrayContaining(['internal', 'unknown-command', 'layout-overflow', 'composition-fault', 'tool-failed', 'not-an-edit']));
    expect(document.size).toBeGreaterThanOrEqual(35);
    expect(media.size + render.size).toBeGreaterThanOrEqual(24);
  });
});

describe('codes', () => {
  const listed = new Map(everyCode().map((row) => [row.code, row]));

  it('lists every code that edit/, compose/, fit/, quality/ and the command line can give', () => {
    for (const [from, found] of Object.entries({ document, media, render, commandLine })) {
      for (const code of found.keys()) expect(listed.has(code), `${code} (given by ${from}) has no row: add it to src/cli/meanings.ts`).toBe(true);
    }
  });
  it('has no row for a code that nothing gives', () => {
    expect(Object.keys(DOCUMENT_CODES).filter((code) => !document.has(code))).toEqual([]);
    expect(Object.keys(MEDIA_CODES).filter((code) => !media.has(code))).toEqual([]);
    expect(Object.keys(RENDER_CODES).filter((code) => !render.has(code))).toEqual([]);
    expect(Object.keys(CLI_CODES).filter((code) => !commandLine.has(code) && !media.has(code))).toEqual([]);
  });
  it('says error or warning as the checks do', () => {
    for (const [table, found] of [[MEDIA_CODES, media], [RENDER_CODES, render], [DOCUMENT_CODES, document]] as const) {
      for (const [code, row] of Object.entries(table)) expect([...found.get(code)!], code).toEqual([row.severity]);
    }
  });
  it('gives each code once, with a meaning, a fix and the exit code it stands for', () => {
    const rows = everyCode();
    expect(new Set(rows.map((row) => row.code)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.meaning.length, row.code).toBeGreaterThan(15);
      expect(row.fix.length, row.code).toBeGreaterThan(8);
      expect(row.exit, row.code).toBe(row.severity === 'warning' ? 0 : row.about === 'command' ? CLI_CODES[row.code as keyof typeof CLI_CODES].exit : 1);
    }
    expect(listed.get('tool-failed')).toMatchObject({ about: 'command', exit: 3 });      // one row, whoever finds it
    expect(listed.get('low-contrast')).toMatchObject({ about: 'render', severity: 'warning', exit: 0 });
    expect(listed.get('shots-gap')).toMatchObject({ about: 'document', severity: 'error', exit: 1 });
  });

  it('answers with the list as JSON, and as text one code a line', async () => {
    const { context, calls } = fakeContext();
    const ran = await ask(context, ['codes']);
    expect(ran.exit).toBe(0);
    expect(Object.keys(ran.json)).toEqual(['ok', 'command', 'issues', 'warnings', 'result']);
    expect(ran.json.result.count).toBe(listed.size);
    expect(ran.json.result.codes.map((row: { code: string }) => row.code)).toEqual([...listed.keys()]);
    expect(Object.keys(ran.json.result.about)).toEqual(['command', 'document', 'media', 'render']);
    expect(calls).toEqual([]);                                                            // it starts no tool
    const text = (await cli(['codes'], context)).stdout;
    for (const code of listed.keys()) expect(text).toContain(`  ${code} (`);
    expect(text).toContain('wrong-footage (error, exit 1): ');
    expect(text).toContain('media-colour (warning): ');
  });
  it('takes no argument and no flag of its own', async () => {
    const { context } = fakeContext();
    const extra = await ask(context, ['codes', 'shots-gap']);
    expect(extra.exit).toBe(2);
    expect(extra.json.issues[0].code).toBe('argument-extra');
    const flag = await ask(context, ['codes', '--markdown']);
    expect(flag.exit).toBe(2);
    expect(flag.json.issues[0]).toMatchObject({ code: 'unknown-flag', target: '--markdown' });
  });
});
