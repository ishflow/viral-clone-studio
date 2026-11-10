import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { z } from 'zod';
import { openDb } from '../../db/open.ts';
import { readSettings, writeSettings } from '../../db/settings.ts';
import { dataDir } from '../../paths.ts';
import type { Context } from '../context.ts';
import type { Command } from '../framework.ts';
import { Stop, issue } from '../issue.ts';
import { pathOf } from '../project.ts';

const Searches = z.array(z.string().min(1).max(100).regex(/^[\p{L}\p{N}_]+$/u)).min(1).max(50);
/** Validate before the write; use the engine writer and keep extensions of the JSON row. */
export function setSearches(db: DatabaseSync, input: unknown): string[] {
  const raw = z.array(z.string()).max(50).parse(input);
  const searches = Searches.parse([...new Map(raw.map(tag => {
    const clean = tag.trim().replace(/^#+/, '');
    return [clean.toLocaleLowerCase('en'), clean] as const;
  }).reverse()).values()].reverse());
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT value FROM settings WHERE id = 1').get() as { value: string } | undefined;
    const stored = row ? z.record(z.string(), z.unknown()).parse(JSON.parse(row.value)) : {};
    writeSettings(db, { ...stored, ...readSettings(db), searches });
    db.exec('COMMIT');
    return searches;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export const settings: Command<Context> = {
  name: 'settings',
  summary: 'Set the installation Shorts hashtags: settings set-searches skincare makeupreview ugcads. Validates the full list before using the engine settings writer; never starts a scan.',
  args: [{ name: 'operation', help: 'set-searches' }],
  flags: [
    { name: 'searches', type: 'string', value: '<JSON>', help: 'a JSON array of hashtags (positional hashtags are converted to this automatically)' },
    { name: 'data-dir', type: 'string', value: '<dir>', help: 'the installation data directory; otherwise VC_DATA_DIR or the engine default' },
  ],
  async run(input, context) {
    let tags: string[];
    try {
      if (input.args.operation !== 'set-searches') throw new Error('operation');
      tags = Searches.parse(JSON.parse(String(input.flags.searches ?? '[]')).map((tag: unknown) => typeof tag === 'string' ? tag.trim().replace(/^#+/, '') : tag));
    } catch {
      throw new Stop([issue('argument-value', { target: 'settings set-searches' }, 'Use 1–50 hashtags, each up to 100 letters, numbers or underscores.', 'Example: viraleditor settings set-searches skincare skincareroutine makeupreview ugcads haircare beautytok glowup')]);
    }
    const root = input.flags['data-dir'] === undefined ? dataDir() : pathOf(context, String(input.flags['data-dir']));
    const db = openDb(join(root, 'db.sqlite'));
    try { return { result: { searches: setSearches(db, tags), dataDir: root } }; }
    finally { db.close(); }
  },
};

/** Variadic hashtag syntax, without changing parsing for other commands or swallowing flags. */
export function settingsArgs(argv: string[]): string[] {
  if (argv[0] !== 'settings' || argv[1] !== 'set-searches' || argv.includes('--searches')) return argv;
  let end = 2;
  while (end < argv.length && !argv[end]!.startsWith('--')) end++;
  return ['settings', 'set-searches', '--searches', JSON.stringify(argv.slice(2, end)), ...argv.slice(end)];
}
