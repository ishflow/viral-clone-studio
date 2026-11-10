import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { openDb } from './open.ts';
import { readHealth, readSettings, takeUsage } from './settings.ts';

const mem = () => openDb(join(mkdtempSync(join(tmpdir(), 'vc-set-')), 'db.sqlite'));

describe('settings', () => {
  it('returns defaults when the row is missing and fills missing fields of a stored row', () => {
    const db = mem();
    const d = readSettings(db);
    expect(d).toMatchObject({ threshold: 70, dailyCandidates: 45, dailyTemplates: 10, secondsMin: 6, secondsMax: 35, shortsMinViews: 500000, topAdsCards: 30, perScan: 15, searches: [] });
    expect(d.scanTimes).toEqual(['09:00', '15:00', '21:00']);
    expect(d.tiers.best).toEqual({ model: 'seedance-2.5-pro', resolution: '1080p' });
    db.prepare('INSERT INTO settings (id, value) VALUES (1, ?)').run(JSON.stringify({ threshold: 80 }));
    const s = readSettings(db);
    expect(s.threshold).toBe(80);
    expect(s.perScan).toBe(15);
  });

  it('takeUsage stops at the cap and starts again the next day', () => {
    const db = mem();
    expect([1, 2, 3].map(() => takeUsage(db, 'score', '2026-10-04', 2))).toEqual([true, true, false]);
    expect(takeUsage(db, 'prepare', '2026-10-04', 2)).toBe(true);
    expect(takeUsage(db, 'score', '2026-10-05', 2)).toBe(true);
    expect(takeUsage(db, 'score', '2026-10-06', 0)).toBe(false);
    expect((db.prepare("SELECT count FROM usage WHERE day='2026-10-04' AND kind='score'").get() as { count: number }).count).toBe(2);
  });

  it('a stored "null" or corrupt value gives the defaults; a corrupt health row gives null', () => {
    const db = mem();
    const defaults = readSettings(db);
    db.prepare('INSERT INTO settings (id, value) VALUES (1, ?)').run('null');
    expect(readSettings(db)).toEqual(defaults);
    db.prepare('UPDATE settings SET value = ? WHERE id = 1').run('{broken');
    expect(readSettings(db)).toEqual(defaults);
    expect(readHealth(db)).toBeNull();
    db.prepare('INSERT INTO health (id, value) VALUES (1, ?)').run('null');
    expect(readHealth(db)).toBeNull();
    db.prepare('UPDATE health SET value = ? WHERE id = 1').run('nope');
    expect(readHealth(db)).toBeNull();
  });

  it('a stored field of the wrong type gives that field\'s default (R2fix, C7b minor 4)', () => {
    const db = mem();
    const defaults = readSettings(db);
    db.prepare('INSERT INTO settings (id, value) VALUES (1, ?)').run(JSON.stringify({
      searches: 'skin care', perScan: '15', shortsMinViews: null, threshold: 80, scanTimes: ['09:00', 7], sources: { topads: 'no', shorts: false },
      tiers: { fast: { model: 5, resolution: '480p' } }, secondsMax: Number.NaN,
    }));
    const s = readSettings(db);
    expect(s).toMatchObject({ searches: [], perScan: 15, shortsMinViews: 500000, threshold: 80, scanTimes: defaults.scanTimes, secondsMax: 35 });
    expect(s.sources).toEqual({ topads: true, shorts: false });
    expect(s.tiers.fast).toEqual({ model: defaults.tiers.fast.model, resolution: '480p' });
  });
});
