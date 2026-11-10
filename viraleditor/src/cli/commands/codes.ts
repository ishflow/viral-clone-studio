import { CLI_CODES, exitOf } from '../codes.ts';
import type { Context } from '../context.ts';
import type { Command } from '../framework.ts';
import { DOCUMENT_CODES, MEDIA_CODES, RENDER_CODES } from '../meanings.ts';

interface Row { code: string; about: string; severity: 'error' | 'warning'; exit: 0 | 1 | 2 | 3; meaning: string; fix: string }

/** Who finds each group of codes, in the order they are listed. */
const ABOUT = {
  command: 'the command line itself: how a command was written, the files handed to it, the tools it runs',
  document: 'the edit document: its shape, its rules, the text that must fit (`check`)',
  media: 'the media files of the document (`check`)',
  render: 'a finished render, read against the document (`render`, `inspect`)',
};

/** Every code once: a code of the command line's own table keeps its row there (`tool-failed` is one whoever finds it). */
export function everyCode(): Row[] {
  const rows: Row[] = Object.entries(CLI_CODES).map(([code, info]) => ({ code, about: 'command', severity: 'severity' in info ? info.severity : 'error', exit: 'severity' in info ? 0 : info.exit, meaning: info.meaning, fix: info.fix }));
  for (const [about, table] of [['document', DOCUMENT_CODES], ['media', MEDIA_CODES], ['render', RENDER_CODES]] as const) {
    for (const [code, info] of Object.entries(table)) {
      if (rows.some((row) => row.code === code)) continue;
      rows.push({ code, about, severity: info.severity, exit: info.severity === 'warning' ? 0 : exitOf(code), meaning: info.meaning, fix: info.fix });
    }
  }
  return rows;
}

export const codes: Command<Context> = {
  name: 'codes',
  summary: 'Every error and warning code the editor can give, with what it means and the general fix. An issue itself says more: its message carries the numbers of the case and its fix the exact change.',
  args: [],
  flags: [],
  async run() {
    const rows = everyCode();
    return {
      result: {
        count: rows.length,
        about: ABOUT,
        codes: rows,
        next: 'An error fails its command with the exit code listed; a warning is reported and the command goes on (exit 0). Fix an issue by its own "fix": it names the place and the numbers.',
      },
    };
  },
  text(result) {
    const { codes: rows, next } = result as { codes: Row[]; next: string };
    const out: string[] = [];
    for (const [about, who] of Object.entries(ABOUT)) {
      out.push(`${about}: ${who}`);
      for (const row of rows.filter((r) => r.about === about)) out.push(`  ${row.code} (${row.severity}${row.exit === 0 ? '' : `, exit ${row.exit}`}): ${row.meaning}`, `      fix: ${row.fix}`);
      out.push('');
    }
    return [...out, next].join('\n');
  },
};
