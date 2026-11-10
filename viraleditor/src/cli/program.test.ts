// The commands that teach, run as the program itself (`node main.ts`), as an agent runs them: with --json stdout is one
// JSON object and nothing else; without it the same facts as text.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { beatsTemplate } from '../template/fixture.ts';
import { COMMANDS } from './commands.ts';

vi.setConfig({ testTimeout: 120_000 });
const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
const program = (args: string[]) => spawnSync(process.execPath, [MAIN, ...args], { encoding: 'utf8', timeout: 60_000, maxBuffer: 1 << 26 });

describe('init, schema, plan and codes as a program', () => {
  const template = join(mkdtempSync(join(tmpdir(), 've-cli-program-')), 'template.json');
  writeFileSync(template, JSON.stringify(beatsTemplate()));

  it.each([
    ['codes', ['codes']], ['schema', ['schema']], ['schema', ['schema', '--markdown']], ['init', ['init', '--list']], ['plan', ['plan', template, '--variants', '2']],
  ] as const)('%s: one JSON object on stdout with --json, exit 0', (command, args) => {
    const run = program([...args, '--json']);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trim().startsWith('{') && run.stdout.trim().endsWith('}')).toBe(true);
    const answer = JSON.parse(run.stdout);
    expect(Object.keys(answer)).toEqual(['ok', 'command', 'issues', 'warnings', 'result']);
    expect(answer).toMatchObject({ ok: true, command, issues: [], warnings: [] });
    expect(run.stderr).toBe('');
  });

  it('answers a usage fault of each with exit 2 and the nearest valid word, as JSON', () => {
    for (const [args, code, meant] of [
      [['inti', 'x'], 'unknown-command', '"init"'], [['shema'], 'unknown-command', '"schema"'], [['code'], 'unknown-command', '"codes"'], [['plna', template], 'unknown-command', '"plan"'],
      [['plan', template, '--variant', '2'], 'unknown-flag', '--variants'], [['init', 'x', '--lst'], 'unknown-flag', '--list'],
    ] as const) {
      const run = program([...args, '--json']);
      expect(run.status, args.join(' ')).toBe(2);
      const answer = JSON.parse(run.stdout);
      expect(answer.issues[0].code).toBe(code);
      expect(answer.issues[0].fix).toContain(`Did you mean ${meant}?`);
    }
  });

  it('is named in the usage text, each with what it takes', () => {
    const usage = program(['--help']).stdout;
    for (const line of ['init [<dir>] [--example product-beats|talking-captions|before-after|minimal] [--list]', 'schema [--markdown]', 'codes', 'plan <template.json> [--variants <n>]']) expect(usage).toContain(`  ${line}\n`);
    expect(COMMANDS.map((command) => command.name)).toEqual(['doctor', 'init', 'check', 'frames', 'render', 'sheet', 'inspect', 'probe', 'normalize', 'schema', 'codes', 'plan', 'words', 'settings', 'settle-unknown']);
  });

  it('prints the same facts as text without --json', () => {
    expect(program(['init', '--list']).stdout).toContain('name: talking-captions');
    expect(program(['codes']).stdout).toContain('  shots-gap (error, exit 1): ');
    expect(program(['plan', template]).stdout).toMatch(/clipSeconds: 4/);
  });
});
