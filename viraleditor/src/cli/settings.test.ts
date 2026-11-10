import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDb } from '../db/open.ts';
import { readSettings, writeSettings } from '../db/settings.ts';
import { setSearches } from './commands/settings.ts';

it('validates the whole list before writing and preserves existing settings', () => {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'codext-settings-')), 'db.sqlite'));
  try {
    writeSettings(db, { ...readSettings(db), threshold: 77, topAdsCountry: 'GB' });
    const searches = ['skincare', 'skincareroutine', 'makeupreview', 'ugcads', 'haircare', 'beautytok', 'glowup'];
    expect(setSearches(db, searches)).toEqual(searches);
    expect(readSettings(db)).toMatchObject({ searches, threshold: 77, topAdsCountry: 'GB', dailyCandidates: 45, dailyTemplates: 10 });
    for (const invalid of [[], ['bad/tag'], ['x'.repeat(101)], Array.from({ length: 51 }, (_, i) => `tag${i}`)]) {
      expect(() => setSearches(db, invalid)).toThrow();
      expect(readSettings(db).searches).toEqual(searches);
    }
    expect(setSearches(db, ['#Skincare', 'skincare', 'makeup'])).toEqual(['Skincare', 'makeup']);
  } finally { db.close(); }
});

it('keeps the positional CLI syntax and flags separate', async () => {
  const { settingsArgs } = await import('./commands/settings.ts');
  expect(settingsArgs(['settings', 'set-searches', 'skincare', 'ugcads', '--json', '--data-dir', '/tmp/example'])).toEqual(['settings', 'set-searches', '--searches', '["skincare","ugcads"]', '--json', '--data-dir', '/tmp/example']);
});

it('runs the installation command with fake tools and a temp directory only', async () => {
  const { cli } = await import('./commands.ts');
  const { fakeContext } = await import('./testing.ts');
  const { context, calls } = fakeContext();
  const dir = mkdtempSync(join(tmpdir(), 'codext-cli-'));
  const ran = await cli(['settings', 'set-searches', 'skincare', 'ugcads', '--data-dir', dir, '--json'], context);
  expect(ran.exit).toBe(0);
  expect(JSON.parse(ran.stdout).result.searches).toEqual(['skincare', 'ugcads']);
  expect(calls).toEqual([]);
  const bad = await cli(['settings', 'set-searches', 'bad/tag', '--data-dir', dir, '--json'], context);
  expect(bad.exit).toBe(2);
  const db = openDb(join(dir, 'db.sqlite'));
  try { expect(readSettings(db).searches).toEqual(['skincare', 'ugcads']); } finally { db.close(); }
});
