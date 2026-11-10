import type { DatabaseSync } from 'node:sqlite';
import type { Health, Settings } from '../contracts.ts';

const DEFAULTS: Settings = {
  scanTimes: ['09:00', '15:00', '21:00'],
  sources: { topads: true, shorts: true },
  searches: [],
  threshold: 70,
  dailyCandidates: 45,
  dailyTemplates: 10,
  secondsMin: 6, secondsMax: 35,
  shortsMinViews: 500000,
  topAdsIndustry: 'beauty-personal-care', topAdsCountry: 'US', topAdsPeriod: 7,
  topAdsCards: 30,
  perScan: 15,
  tiers: { fast: { model: 'seedance-2-mini', resolution: '720p' }, best: { model: 'seedance-2.5-pro', resolution: '1080p' } },
};

/** A stored JSON object, or null when the value is corrupt or not an object. */
function parse(value: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(value);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The fields of `stored` that have the kind of the default's same field (a finite number, a string, a boolean, a list of strings). */
function sameKind<T extends object>(defaults: T, stored: unknown): Partial<T> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  const fits = (want: unknown, v: unknown): boolean => (typeof want === 'number' ? typeof v === 'number' && Number.isFinite(v)
    : Array.isArray(want) ? Array.isArray(v) && v.every((x) => typeof x === 'string')
      : typeof want === typeof v && typeof v !== 'object');
  return Object.fromEntries(Object.entries(stored).filter(([k, v]) => Object.hasOwn(defaults, k) && fits((defaults as Record<string, unknown>)[k], v))) as Partial<T>;
}

/** The stored row with every missing field, or field of the wrong kind, filled from the defaults. */
export function readSettings(db: DatabaseSync): Settings {
  const r = db.prepare('SELECT value FROM settings WHERE id = 1').get() as { value: string } | undefined;
  const stored = (r ? parse(r.value) : null) ?? {};
  const tiers = Object(stored.tiers ?? {}) as Record<string, unknown>;          // each tier is read field by field below
  const { sources: _s, tiers: _t, ...flat } = DEFAULTS;
  return {
    ...DEFAULTS, ...sameKind(flat, stored),
    sources: { ...DEFAULTS.sources, ...sameKind(DEFAULTS.sources, stored.sources) },
    tiers: { fast: { ...DEFAULTS.tiers.fast, ...sameKind(DEFAULTS.tiers.fast, tiers.fast) }, best: { ...DEFAULTS.tiers.best, ...sameKind(DEFAULTS.tiers.best, tiers.best) } },
  };
}

export function writeSettings(db: DatabaseSync, value: Settings): void {
  db.prepare('INSERT INTO settings (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value').run(JSON.stringify(value));
}

export function readHealth(db: DatabaseSync): Health | null {
  const r = db.prepare('SELECT value FROM health WHERE id = 1').get() as { value: string } | undefined;
  return r ? (parse(r.value) as Health | null) : null;
}

export function writeHealth(db: DatabaseSync, value: Health): void {
  db.prepare('INSERT INTO health (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value').run(JSON.stringify(value));
}

/** Counts one use of `kind` on `day`; false, and nothing changed, when the cap is reached. One statement. */
export function takeUsage(db: DatabaseSync, kind: 'score' | 'prepare', day: string, cap: number): boolean {
  if (cap <= 0) return false;
  const r = db.prepare(
    `INSERT INTO usage (day, kind, count) VALUES (?, ?, 1)
     ON CONFLICT (day, kind) DO UPDATE SET count = count + 1 WHERE count < ?
     RETURNING count`,
  ).get(day, kind, cap);
  return r !== undefined;
}
