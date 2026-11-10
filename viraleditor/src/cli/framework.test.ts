import { describe, expect, it } from 'vitest';
import { CLI_CODES } from './codes.ts';
import { nearest, parse, pretty, run, usage, usageOf } from './framework.ts';
import type { Command } from './framework.ts';
import { Stop, issue, sh } from './issue.ts';

/** A table of the kind CLI-b adds to: every flag type once, a command that throws, one that stops with an issue. */
const calls: unknown[] = [];
const TABLE: Command<{ tag: string }>[] = [
  {
    name: 'frames', summary: 'Stills of frames.',
    args: [{ name: 'edit.json', help: 'the edit document' }],
    flags: [
      { name: 'at', type: 'integers', value: '<frames>', min: 0, required: true, help: 'frame numbers' },
      { name: 'out', type: 'string', value: '<dir>', help: 'where the PNG files go' },
      { name: 'columns', type: 'integer', value: '<n>', min: 1, max: 8, default: 4, help: 'tiles per row' },
      { name: 'quality', type: 'choice', choices: ['draft', 'looks'], default: 'looks', help: 'how carefully' },
      { name: 'deep', type: 'boolean', help: 'also the slow part' },
    ],
    async run(input, context) {
      calls.push({ input, context });
      return { result: { seen: input.flags.at }, warnings: [{ code: 'media-size', path: 'media.a', message: 'small', fix: 'normalize it' }] };
    },
  },
  { name: 'check', summary: 'Checks a document.', args: [{ name: 'edit.json', help: 'the edit document' }, { name: 'more', help: 'optional', optional: true }], flags: [],
    async run() { return { result: null, issues: [{ code: 'shots-gap', path: 'shots[1].at', message: 'gap', fix: 'set at to 60' }] }; } },
  { name: 'boom', summary: 'Throws.', args: [], flags: [], async run() { throw new TypeError('cannot read x of undefined'); } },
  { name: 'stop', summary: 'Stops with a tool issue.', args: [], flags: [], async run() { throw new Stop([issue('tool-failed', { target: 'ffmpeg' }, 'ffmpeg exited 1')]); } },
  { name: 'plain', summary: 'Own text.', args: [], flags: [], async run() { return { result: { markdown: '# Title' } }; }, text: (result) => (result as { markdown: string }).markdown },
];
const go = (argv: string[]) => run(argv, TABLE, { tag: 'ctx' }, {});

describe('parse', () => {
  const frames = TABLE[0]!;
  it('reads positionals and every flag type, as --flag value and as --flag=value', () => {
    const parsed = parse(frames, ['doc.json', '--at', '12,48', '--out=shots', '--columns', '3', '--quality=draft', '--deep']);
    expect(parsed.issues).toEqual([]);
    expect(parsed.input).toEqual({ args: { 'edit.json': 'doc.json' }, flags: { at: [12, 48], out: 'shots', columns: 3, quality: 'draft', deep: true } });
  });
  it('"--" ends the flags: it is not an argument, and every word after it is one (R2fix, C7b minor 8)', () => {
    const parsed = parse(frames, ['--at', '0', '--', '--odd.json']);
    expect(parsed.issues).toEqual([]);
    expect(parsed.input.args).toEqual({ 'edit.json': '--odd.json' });
  });
  it('applies defaults and leaves an absent flag out', () => {
    const parsed = parse(frames, ['doc.json', '--at', '0']);
    expect(parsed.input.flags).toEqual({ at: [0], columns: 4, quality: 'looks', deep: false });
  });
  it('names every usage fault at once, each with what to write instead', () => {
    const parsed = parse(frames, ['--columns', 'four', '--quality', 'lokks', '--at', '3,x', '--deep=yes', 'a.json', 'b.json']);
    const byCode = (code: string) => parsed.issues.filter((i) => i.code === code);
    expect(byCode('flag-value').map((i) => i.target)).toEqual(['--columns', '--quality', '--at', '--deep']);
    expect(byCode('flag-value')[1]!.fix).toContain('"looks"');             // the nearest choice
    expect(byCode('argument-extra')[0]!.message).toContain('b.json');
    for (const i of parsed.issues) expect(i.fix.length).toBeGreaterThan(10);
  });
  it('refuses a number outside its range, a missing value, a missing required flag and a missing argument', () => {
    expect(parse(frames, ['d.json', '--at', '1', '--columns', '9']).issues[0]).toMatchObject({ code: 'flag-value', target: '--columns' });
    expect(parse(frames, ['d.json', '--at', '-1']).issues[0]).toMatchObject({ code: 'flag-value', target: '--at' });
    expect(parse(frames, ['d.json', '--at']).issues[0]).toMatchObject({ code: 'flag-value', target: '--at' });
    expect(parse(frames, ['d.json', '--at', '--deep']).issues[0]).toMatchObject({ code: 'flag-value', target: '--at' });
    expect(parse(frames, ['d.json']).issues[0]).toMatchObject({ code: 'flag-missing', target: '--at' });
    expect(parse(frames, ['--at', '1']).issues[0]).toMatchObject({ code: 'argument-missing', target: '<edit.json>' });
    expect(parse(TABLE[1]!, ['d.json']).issues).toEqual([]);                // an optional argument may be absent
  });
  it('names the nearest flag for an unknown one', () => {
    const [found] = parse(frames, ['d.json', '--at', '1', '--colums', '3']).issues;
    expect(found).toMatchObject({ code: 'unknown-flag', target: '--colums' });
    expect(found!.fix).toContain('--columns');
    expect(parse(frames, ['d.json', '--at', '1', '--jsno']).issues[0]!.fix).toContain('--json');   // the flags every command has are candidates too
  });
});

describe('parse, one fault one issue', () => {
  it('does not also call a required flag missing when a mistyped flag was meant for it', () => {
    const found = parse(TABLE[0]!, ['d.json', '--att', '3']).issues;
    expect(found.map((i) => i.code)).toEqual(['unknown-flag']);
    expect(found[0]!.fix).toContain('--at');
  });
});

describe('nearest', () => {
  it('finds the closest word', () => {
    expect(nearest('chek', ['doctor', 'check', 'frames'])).toBe('check');
    expect(nearest('rendr', ['doctor', 'check', 'render'])).toBe('render');
  });
});

describe('run', () => {
  it('answers with one JSON object: ok, command, issues, warnings, result', async () => {
    const ran = await go(['frames', 'doc.json', '--at', '12,48', '--json']);
    expect(ran.exit).toBe(0);
    expect(ran.stdout.endsWith('\n')).toBe(true);
    expect(JSON.parse(ran.stdout)).toEqual({
      ok: true, command: 'frames', issues: [],
      warnings: [{ code: 'media-size', path: 'media.a', message: 'small', fix: 'normalize it' }],
      result: { seen: [12, 48] },
    });
    expect(calls.at(-1)).toMatchObject({ context: { tag: 'ctx' }, input: { args: { 'edit.json': 'doc.json' } } });
    expect(ran.stdout).toContain('"seen": [12, 48]');                       // a plain list stays on one line
  });
  it('exits 1 for an issue of the document', async () => {
    const ran = await go(['check', 'doc.json', '--json']);
    expect(ran.exit).toBe(1);
    expect(JSON.parse(ran.stdout)).toMatchObject({ ok: false, command: 'check', issues: [{ code: 'shots-gap', fix: 'set at to 60' }], result: null });
  });
  it('exits 2 for an unknown command and names the nearest one', async () => {
    const ran = await go(['chek', 'doc.json', '--json']);
    const answer = JSON.parse(ran.stdout);
    expect(ran.exit).toBe(2);
    expect(answer).toMatchObject({ ok: false, command: 'chek', issues: [{ code: 'unknown-command', target: 'chek' }] });
    expect(answer.issues[0].fix).toContain('"check"');
    expect(answer.issues[0].fix).toContain('frames');                       // and the whole list
  });
  it('exits 2 for an unknown flag and names the nearest one; the handler does not run', async () => {
    const before = calls.length;
    const ran = await go(['frames', 'doc.json', '--at', '1', '--outt', 'x', '--json']);
    expect(ran.exit).toBe(2);
    expect(JSON.parse(ran.stdout).issues[0]).toMatchObject({ code: 'unknown-flag', target: '--outt' });
    expect(JSON.parse(ran.stdout).issues[0].fix).toContain('--out');
    expect(calls.length).toBe(before);
  });
  it('exits 2 without a command and prints the usage', async () => {
    const ran = await go([]);
    expect(ran.exit).toBe(2);
    expect(ran.stdout).toContain('viraleditor <command>');
    expect((await go(['--json'])).answer.issues[0]).toMatchObject({ code: 'command-missing' });
  });
  it('turns an unexpected exception into the issue `internal` with exit 3, the stack only in the log', async () => {
    const logged: string[] = [];
    const ran = await run(['boom', '--json'], TABLE, { tag: 'ctx' }, { log: (line) => logged.push(line) });
    expect(ran.exit).toBe(3);
    const answer = JSON.parse(ran.stdout);
    expect(answer).toMatchObject({ ok: false, command: 'boom', result: null, issues: [{ code: 'internal', target: 'boom' }] });
    expect(answer.issues[0].message).toContain('cannot read x of undefined');
    expect(answer.issues[0].fix.length).toBeGreaterThan(10);
    expect(ran.stdout).not.toContain('at ');                                // no stack trace on stdout
    expect(logged.join('\n')).toContain('TypeError');
  });
  it('lets a handler stop with issues; a tool issue exits 3', async () => {
    const ran = await go(['stop', '--json']);
    expect(ran.exit).toBe(3);
    expect(JSON.parse(ran.stdout).issues).toEqual([{ code: 'tool-failed', target: 'ffmpeg', message: 'ffmpeg exited 1', fix: CLI_CODES['tool-failed'].fix }]);
  });
  it('lets the caller explain an exception it knows', async () => {
    const ran = await run(['boom', '--json'], TABLE, { tag: 'ctx' }, { explain: (e) => (e instanceof TypeError ? issue('tool-missing', { target: 'x' }, 'x is not there') : null) });
    expect(ran.exit).toBe(3);
    expect(ran.answer.issues[0]!.code).toBe('tool-missing');
  });
  it('prints the same facts as readable text without --json', async () => {
    const ok = await go(['frames', 'doc.json', '--at', '12,48']);
    expect(ok.stdout).toMatch(/^ok frames/);
    expect(ok.stdout).toContain('warning media-size at media.a: small');
    expect(ok.stdout).toContain('fix: normalize it');
    expect(ok.stdout).toContain('seen: 12, 48');
    const failed = await go(['check', 'doc.json']);
    expect(failed.stdout).toMatch(/^FAILED check \(exit 1\)/);
    expect(failed.stdout).toContain('error shots-gap at shots[1].at: gap');
    expect(() => JSON.parse(failed.stdout)).toThrow();
  });
  it('prints a command’s own text when it has one, and JSON all the same with --json', async () => {
    expect((await go(['plain'])).stdout).toBe('# Title\n');
    expect(JSON.parse((await go(['plain', '--json'])).stdout).result).toEqual({ markdown: '# Title' });
  });
});

describe('pretty', () => {
  it('is JSON that reads back the same; what does not fit a line gets a line for each part', () => {
    const value = { ok: false, list: [1, 2, 3], none: null, empty: [], issue: { code: 'shots-gap', path: 'shots[1].at', message: 'x'.repeat(90), fix: 'y'.repeat(60) }, nested: [{ a: 1 }, { a: [2, { b: Number.NaN }] }] };
    const text = pretty(value);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(value)));
    expect(text).toContain('"list": [1, 2, 3]');
    expect(text).toContain('\n    "code": "shots-gap",\n    "path": "shots[1].at",\n');
    expect(text).toContain('{ "a": 1 }');
  });
});

describe('usage', () => {
  it('comes from the table: every command with its synopsis and summary', () => {
    const text = usage(TABLE);
    for (const command of TABLE) { expect(text).toContain(command.name); expect(text).toContain(command.summary); }
    expect(text).toContain('frames <edit.json> --at <frames> [--out <dir>] [--columns <n>] [--quality draft|looks] [--deep]');
    expect(text).toContain('check <edit.json> [<more>]');
    expect(text).toMatch(/Exit codes: 0 .* 1 .* 2 .* 3 /);
  });
  it('explains one command: its arguments, its flags with type, range and default', () => {
    const text = usageOf(TABLE[0]!);
    expect(text).toContain('--at <frames>');
    expect(text).toContain('required');
    expect(text).toContain('default 4');
    expect(text).toContain('1 to 8');
    expect(text).toContain('draft|looks');
    expect(text).toContain('--json');
  });
  it('is what --help prints, with exit 0, and as data with --json', async () => {
    expect((await go(['--help'])).exit).toBe(0);
    expect((await go(['--help'])).stdout).toContain('viraleditor <command>');
    expect((await go(['frames', '--help'])).stdout).toContain('--at <frames>');
    const data = JSON.parse((await go(['--help', '--json'])).stdout);
    expect(data).toMatchObject({ ok: true, command: 'help' });
    expect(data.result.commands.map((c: { name: string }) => c.name)).toEqual(TABLE.map((c) => c.name));
    expect(data.result.commands[0].flags[0]).toMatchObject({ name: '--at', type: 'integers', required: true });
    expect(JSON.parse((await go(['frames', '--help', '--json'])).stdout).result.commands).toHaveLength(1);
  });
});

describe('sh', () => {
  it('writes a path so that it can be pasted into a shell: quotes only where they are needed', () => {
    expect(sh('/tmp/ve-1/edit.json')).toBe('/tmp/ve-1/edit.json');
    expect(sh('/Users/me/My Videos/edit.json')).toBe("'/Users/me/My Videos/edit.json'");
    expect(sh("it's.mp4")).toBe("'it'\\''s.mp4'");
  });
});

describe('the codes of the command line', () => {
  it('each has a meaning, a fix and an exit code', () => {
    for (const [code, info] of Object.entries(CLI_CODES)) {
      expect(code).toMatch(/^[a-z][a-z-]+$/);
      expect(info.meaning.length).toBeGreaterThan(10);
      expect(info.fix.length).toBeGreaterThan(10);
      expect([1, 2, 3]).toContain(info.exit);
    }
  });
});
