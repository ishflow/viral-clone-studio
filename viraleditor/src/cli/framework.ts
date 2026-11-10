// The command framework: one table of commands (name, summary, arguments, flags with types, handler). The argument
// parser, the usage text, the suggestion for a mistyped command or flag, the JSON answer and the exit code all come
// from that table. Pure: it reads no file and writes nowhere; `run` returns what main.ts prints.
import { exitOf } from './codes.ts';
import { Stop, issue } from './issue.ts';
import type { Issue } from './issue.ts';

export type FlagType = 'boolean' | 'string' | 'integer' | 'integers' | 'choice';
export interface Flag {
  name: string;                       // without the dashes: 'out' is written --out
  type: FlagType;                     // 'integers': whole numbers separated by commas
  help: string;                       // one line, lower case, no full stop
  value?: string;                     // how the value is shown in the usage: '<dir>'; default '<name>'
  choices?: readonly string[];        // of a 'choice'
  min?: number; max?: number;         // of an 'integer' and of each of 'integers'
  required?: boolean;
  default?: string | number;          // applied when the flag is absent, and shown in the usage
}
export interface Argument { name: string; help: string; optional?: boolean }
export type FlagValue = string | number | boolean | number[];
/** What a handler gets: every argument by its name, every flag by its name (an absent flag without a default is not there; a boolean is always there). */
export interface Input { args: Record<string, string>; flags: Record<string, FlagValue> }
/** What a handler returns. An entry in `issues` makes the command fail; `result` is printed either way. */
export interface Outcome { result: unknown; issues?: Issue[]; warnings?: Issue[] }
export interface Command<C> {
  name: string;
  summary: string;                    // what it does, one or two sentences
  args: Argument[];
  flags: Flag[];
  run(input: Input, context: C): Promise<Outcome>;
  text?(result: unknown): string;     // the result as text when the generic `key: value` lines will not do (without --json only)
}

export interface Answer { ok: boolean; command: string; issues: Issue[]; warnings: Issue[]; result: unknown }
export type Exit = 0 | 1 | 2 | 3;
export interface Ran { answer: Answer; exit: Exit; stdout: string }
export interface Hooks {
  log?(line: string): void;                    // stderr: the stack of an unexpected exception goes here
  explain?(error: unknown): Issue | null;      // an exception the caller knows (a tool that failed) as an issue; null: not known
  version?: Record<string, string | number>;   // what `--version` answers
}

const NAME = 'viraleditor';
/** The flags every command has. */
const GLOBAL: Flag[] = [
  { name: 'json', type: 'boolean', help: 'print one JSON object and nothing else on stdout: { ok, command, issues, warnings, result }' },
  { name: 'help', type: 'boolean', help: 'explain the command and exit' },
];
const EXITS = '0 ok · 1 the document or the media have errors · 2 wrong usage · 3 a tool is missing or failed (run doctor)';

// ── the nearest valid word ──
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}
/**
 * The candidate a mistyped `word` most likely stood for, or null when none is near: at most two edits away (one for a
 * word of up to three letters), or one of the two begins with the other. The first of several equally near.
 */
export function nearest(word: string, candidates: readonly string[]): string | null {
  const w = word.toLowerCase();
  const near = candidates
    .map((candidate) => {
      const c = candidate.toLowerCase();
      const begins = Math.min(w.length, c.length) >= 2 && (w.startsWith(c) || c.startsWith(w));
      return { candidate, d: begins ? 1 : distance(w, c) };
    })
    .filter(({ d }) => d <= (w.length <= 3 ? 1 : 2))
    .sort((x, y) => x.d - y.d)[0];
  return near?.candidate ?? null;
}
const meantText = (near: string | null, shown: (name: string) => string): string => (near === null ? '' : `Did you mean ${shown(near)}? `);

// ── the usage text ──
const placeholder = (flag: Flag): string => (flag.type === 'choice' ? (flag.choices ?? []).join('|') : flag.value ?? `<${flag.name}>`);
const written = (flag: Flag): string => (flag.type === 'boolean' ? `--${flag.name}` : `--${flag.name} ${placeholder(flag)}`);
function range(flag: Flag): string {
  if (flag.min !== undefined && flag.max !== undefined) return `${flag.min} to ${flag.max}`;
  if (flag.min !== undefined) return `${flag.min} or more`;
  if (flag.max !== undefined) return `at most ${flag.max}`;
  return '';
}
/** The kind of value a flag takes, in words. */
function kind(flag: Flag): string {
  const within = range(flag) === '' ? '' : `, ${range(flag)}`;
  switch (flag.type) {
    case 'boolean': return 'no value';
    case 'integer': return `a whole number${within}`;
    case 'integers': return `whole numbers separated by commas, like 12,48${range(flag) === '' ? '' : `, each ${range(flag)}`}`;
    case 'choice': return `one of: ${(flag.choices ?? []).join(', ')}`;
    case 'string': return `a value (${placeholder(flag)})`;
  }
}
/** `frames <edit.json> --at <frames> [--out <dir>]` */
export function synopsis<C>(command: Command<C>): string {
  const args = command.args.map((a) => (a.optional ? `[<${a.name}>]` : `<${a.name}>`));
  const flags = command.flags.map((f) => (f.required ? written(f) : `[${written(f)}]`));
  return [command.name, ...args, ...flags].join(' ');
}
/** The text of `viraleditor --help`. */
export function usage<C>(commands: Command<C>[]): string {
  return [
    `${NAME} <command> [arguments] [--json]`,
    '',
    'Commands:',
    ...commands.flatMap((command) => [`  ${synopsis(command)}`, `      ${command.summary}`]),
    '',
    `With --json a command prints one JSON object and nothing else on stdout: { ok, command, issues, warnings, result }.`,
    'Every issue has a code, a place (path or target), a message and a fix. Progress goes to stderr.',
    `\`${NAME} <command> --help\` (or \`${NAME} help <command>\`) explains one command; \`${NAME} --version\` names what the editor reads.`,
    `Exit codes: ${EXITS}`,
  ].join('\n');
}
/** The text of `viraleditor <command> --help`. */
export function usageOf<C>(command: Command<C>): string {
  const notes = (flag: Flag): string => {
    const parts = [flag.required ? 'required' : '', flag.type === 'integer' || flag.type === 'integers' ? kind(flag) : '', flag.default === undefined ? '' : `default ${flag.default}`].filter((p) => p !== '');
    return parts.length === 0 ? flag.help : `${flag.help} (${parts.join('; ')})`;
  };
  const rows = [...command.flags, ...GLOBAL].map((flag) => [written(flag), notes(flag)] as const);
  const width = Math.max(...rows.map(([w]) => w.length), ...command.args.map((a) => a.name.length + 2));
  return [
    `${NAME} ${synopsis(command)} [--json]`,
    '',
    command.summary,
    ...(command.args.length === 0 ? [] : ['', 'Arguments:', ...command.args.map((a) => `  ${`<${a.name}>`.padEnd(width)}  ${a.help}${a.optional ? ' (optional)' : ''}`)]),
    '',
    'Flags:',
    ...rows.map(([w, note]) => `  ${w.padEnd(width)}  ${note}`),
    '',
    `Exit codes: ${EXITS}`,
  ].join('\n');
}
/** The table as data: the `result` of `--help --json`. */
function described<C>(commands: Command<C>[]): unknown {
  const flagOf = (f: Flag) => ({ name: `--${f.name}`, type: f.type, help: f.help, ...(f.required ? { required: true } : {}), ...(f.choices ? { choices: f.choices } : {}),
    ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}), ...(f.default !== undefined ? { default: f.default } : {}) });
  return {
    commands: commands.map((c) => ({ name: c.name, summary: c.summary, usage: `${NAME} ${synopsis(c)} [--json]`, args: c.args.map((a) => ({ name: a.name, help: a.help, optional: a.optional === true })), flags: c.flags.map(flagOf) })),
    everyCommand: GLOBAL.map(flagOf),
    exitCodes: { 0: 'ok', 1: 'the document or the media have errors', 2: 'wrong usage', 3: 'a tool is missing or failed (run doctor)' },
  };
}

// ── the argument parser ──
/** The value of a flag, or the reason it is not one. */
function valueOf(flag: Flag, text: string): { value: FlagValue } | { wrong: string } {
  const whole = (part: string): number | null => {
    if (!/^-?\d+$/.test(part)) return null;
    const n = Number(part);
    return (flag.min !== undefined && n < flag.min) || (flag.max !== undefined && n > flag.max) ? null : n;
  };
  switch (flag.type) {
    case 'string': return text === '' ? { wrong: 'is empty' } : { value: text };
    case 'integer': { const n = whole(text); return n === null ? { wrong: `is "${text}"` } : { value: n }; }
    case 'integers': {
      const numbers = text.split(',').map((part) => whole(part.trim()));
      return text === '' || numbers.includes(null) ? { wrong: `is "${text}"` } : { value: numbers as number[] };
    }
    case 'choice': return (flag.choices ?? []).includes(text) ? { value: text } : { wrong: `is "${text}"` };
    case 'boolean': return { wrong: `was given the value "${text}"` };
  }
}

/** Reads the words after the command name against the command's row of the table. Every fault is named, not only the first. */
export function parse<C>(command: Command<C>, words: string[]): { input: Input; issues: Issue[] } {
  const issues: Issue[] = [];
  const flags: Record<string, FlagValue> = {};
  const positionals: string[] = [];
  const known = [...command.flags, ...GLOBAL];
  const all = known.map((f) => `--${f.name}`).join(', ');
  const meant = new Set<string>();             // the flags a mistyped one stood for: they are not reported as missing as well

  let rest = false;                            // after "--" every word is an argument
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === '--' && !rest) { rest = true; continue; }
    if (rest || !word.startsWith('--')) { positionals.push(word); continue; }
    const eq = word.indexOf('=');
    const name = word.slice(2, eq < 0 ? undefined : eq);
    const shown = `--${name}`;
    const flag = known.find((f) => f.name === name);
    const next = words[i + 1];
    const follows = eq < 0 && next !== undefined && !next.startsWith('--');     // the next word can be this flag's value
    if (flag === undefined) {
      const near = known.find((f) => f.name === nearest(name, known.map((f) => f.name)));
      issues.push(issue('unknown-flag', { target: shown }, `\`${NAME} ${command.name}\` has no flag ${shown}.`, `${meantText(near?.name ?? null, (n) => `--${n}`)}The flags of ${command.name}: ${all}.`));
      if (near) meant.add(near.name);
      // the word after it is its value, not an argument: when the flag it stood for takes one, or when the command has all its arguments already
      if (follows && (near ? near.type !== 'boolean' : positionals.length >= command.args.length)) i++;
      continue;
    }
    const example = `${NAME} ${command.name} … ${flag.type === 'boolean' ? shown : `${shown} ${flag.type === 'choice' ? flag.choices![0] : flag.type === 'integers' ? '12,48' : flag.type === 'integer' ? String(flag.default ?? flag.min ?? 1) : placeholder(flag)}`}`;
    if (flag.type === 'boolean') {
      if (eq >= 0) issues.push(issue('flag-value', { target: shown }, `${shown} takes no value, but was given "${word.slice(eq + 1)}".`, `Write ${shown} alone to switch it on, or leave it out: ${example}`));
      else flags[name] = true;
      continue;
    }
    if (eq < 0 && !follows) {
      issues.push(issue('flag-value', { target: shown }, `${shown} needs a value: ${kind(flag)}.`, `Write the value after the flag: ${example}`));
      continue;
    }
    const text = eq >= 0 ? word.slice(eq + 1) : next!;
    if (eq < 0) i++;
    const read = valueOf(flag, text);
    if ('wrong' in read) {
      const hint = flag.type === 'choice' ? meantText(nearest(text, flag.choices ?? []), (n) => `"${n}"`) : '';
      issues.push(issue('flag-value', { target: shown }, `${shown} ${read.wrong}; it takes ${kind(flag)}.`, `${hint}Write it like this: ${example}`));
    } else flags[name] = read.value;
  }

  for (const flag of command.flags) {
    if (Object.hasOwn(flags, flag.name) || issues.some((found) => found.target === `--${flag.name}`)) continue;
    if (flag.required && meant.has(flag.name)) continue;
    if (flag.required) issues.push(issue('flag-missing', { target: `--${flag.name}` }, `\`${NAME} ${command.name}\` needs --${flag.name} (${flag.help}).`, `Add ${written(flag)}: ${kind(flag)}. The whole command: ${NAME} ${synopsis(command)}`));
    else if (flag.default !== undefined) flags[flag.name] = flag.default;
    else if (flag.type === 'boolean') flags[flag.name] = false;
  }
  for (const global of GLOBAL) delete flags[global.name];

  const args: Record<string, string> = {};
  command.args.forEach((argument, i) => {
    const given = positionals[i];
    if (given !== undefined) args[argument.name] = given;
    else if (!argument.optional) issues.push(issue('argument-missing', { target: `<${argument.name}>` }, `\`${NAME} ${command.name}\` needs <${argument.name}>: ${argument.help}.`, `Write it after the command: ${NAME} ${synopsis(command)}`));
  });
  for (const extra of positionals.slice(command.args.length)) {
    issues.push(issue('argument-extra', { target: extra }, `\`${NAME} ${command.name}\` takes ${command.args.length} argument${command.args.length === 1 ? '' : 's'}; "${extra}" is one too many.`,
      `Remove "${extra}" (a path with spaces needs quotes; a flag starts with two dashes). The whole command: ${NAME} ${synopsis(command)}`));
  }
  return { input: { args, flags }, issues };
}

// ── the answer as text ──
function lines(value: unknown, indent: string): string[] {
  const scalar = (v: unknown): boolean => v === null || typeof v !== 'object';
  const show = (v: unknown): string => (v === null || v === undefined ? 'none' : String(v));
  if (scalar(value)) return [`${indent}${show(value)}`];
  if (Array.isArray(value)) {
    if (value.every(scalar)) return [`${indent}${value.length === 0 ? 'none' : value.map(show).join(', ')}`];
    return value.flatMap((item) => { const [first, ...rest] = lines(item, `${indent}  `); return [`${indent}- ${(first ?? '').trimStart()}`, ...rest]; });
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, v]) => {
    if (scalar(v) || (Array.isArray(v) && v.every(scalar))) return [`${indent}${key}: ${lines(v, '')[0]}`];
    return [`${indent}${key}:`, ...lines(v, `${indent}  `)];
  });
}
function textOf<C>(answer: Answer, exit: Exit, command: Command<C> | undefined): string {
  const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  const one = (label: string, found: Issue): string[] => [
    `${label} ${found.code} at ${found.path ?? found.target ?? answer.command}${found.at === undefined ? '' : ` (frame ${found.at})`}: ${found.message}`,
    `  fix: ${found.fix}`,
  ];
  const own = answer.ok && command?.text !== undefined && answer.result !== null && answer.result !== undefined ? command.text(answer.result) : null;
  const out: string[] = [];
  if (own === null || answer.warnings.length > 0) {
    out.push(answer.ok ? `ok ${answer.command}${answer.warnings.length > 0 ? ` (${count(answer.warnings.length, 'warning')})` : ''}`
      : `FAILED ${answer.command} (exit ${exit}): ${count(answer.issues.length, 'error')}, ${count(answer.warnings.length, 'warning')}`);
    for (const found of answer.issues) out.push(...one('error', found));
    for (const found of answer.warnings) out.push(...one('warning', found));
  }
  if (own !== null) out.push(own);
  else if (answer.result !== null && answer.result !== undefined) out.push(...lines(answer.result, ''));
  return `${out.join('\n')}\n`;
}

// ── the answer as JSON ──
const LINE = 140;
/** JSON with two-space indents; a list or an object of plain values that fits a line stays on one line (an agent pays for every line it reads). */
export function pretty(value: unknown, indent = ''): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const list = Array.isArray(value);
  const entries: [string | null, unknown][] = list ? value.map((v) => [null, v]) : Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return list ? '[]' : '{}';
  const label = (key: string | null): string => (key === null ? '' : `${JSON.stringify(key)}: `);
  if (entries.every(([, v]) => v === null || typeof v !== 'object')) {
    const parts = entries.map(([key, v]) => `${label(key)}${JSON.stringify(v) ?? 'null'}`).join(', ');
    if (indent.length + parts.length + 4 <= LINE) return list ? `[${parts}]` : `{ ${parts} }`;
  }
  const inner = `${indent}  `;
  return `${list ? '[' : '{'}\n${entries.map(([key, v]) => `${inner}${label(key)}${pretty(v, inner)}`).join(',\n')}\n${indent}${list ? ']' : '}'}`;
}

// ── running a command ──
/** `argv`: the words after the program name. Never throws: whatever happens inside a handler becomes an answer. */
export async function run<C>(argv: string[], commands: Command<C>[], context: C, hooks: Hooks = {}): Promise<Ran> {
  const json = argv.includes('--json');
  const words = argv.filter((word) => !['--json', '--help', '-h', '--version'].includes(word));
  // `help` and `version` are words too: `viraleditor help check`
  const asked = words[0] === 'help' || words[0] === 'version' ? words.shift()! : null;
  const help = asked === 'help' || argv.includes('--help') || argv.includes('-h');
  const version = asked === 'version' || argv.includes('--version');
  const at = words.findIndex((word) => !word.startsWith('-'));                  // a flag may stand before the command
  const name = at < 0 ? undefined : words[at];
  if (at >= 0) words.splice(at, 1);
  const command = commands.find((c) => c.name === name);

  const finish = (label: string, outcome: Outcome, text?: string): Ran => {
    const issues = outcome.issues ?? [];
    const answer: Answer = { ok: issues.length === 0, command: label, issues, warnings: outcome.warnings ?? [], result: outcome.result ?? null };
    const exit = issues.reduce<Exit>((worst, found) => Math.max(worst, exitOf(found.code)) as Exit, 0);
    return { answer, exit, stdout: json ? `${pretty(answer)}\n` : text ?? textOf(answer, exit, command) };
  };

  if (version && hooks.version) {
    return finish('version', { result: hooks.version }, `${NAME}: ${Object.entries(hooks.version).map(([key, value]) => `${key} ${value}`).join(', ')}\n`);
  }
  if (help && (command !== undefined || name === undefined)) {
    return finish('help', { result: described(command ? [command] : commands) }, `${command ? usageOf(command) : usage(commands)}\n`);
  }
  if (name === undefined) {
    const missing = finish('', { result: null, issues: [issue('command-missing', { target: NAME }, 'No command was given.', `Name one of: ${commands.map((c) => c.name).join(', ')}. \`${NAME} --help\` explains them.`)] });
    return json ? missing : { ...missing, stdout: `${missing.stdout}\n${usage(commands)}\n` };
  }
  if (command === undefined) {
    return finish(name, { result: null, issues: [issue('unknown-command', { target: name }, `\`${NAME}\` has no command "${name}".`,
      `${meantText(nearest(name, commands.map((c) => c.name)), (n) => `"${n}"`)}The commands: ${commands.map((c) => c.name).join(', ')}. \`${NAME} --help\` says what each does.`)] });
  }

  const parsed = parse(command, words);
  if (parsed.issues.length > 0) return finish(command.name, { result: null, issues: parsed.issues });
  try {
    return finish(command.name, await command.run(parsed.input, context));
  } catch (error) {
    if (error instanceof Stop) return finish(command.name, { result: error.result, issues: error.issues });
    const known = hooks.explain?.(error) ?? null;
    if (known !== null) return finish(command.name, { result: null, issues: [known] });
    hooks.log?.(error instanceof Error ? error.stack ?? String(error) : String(error));
    const said = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return finish(command.name, { result: null, issues: [issue('internal', { target: command.name }, `\`${NAME} ${command.name}\` failed unexpectedly (${said}).`)] });
  }
}
