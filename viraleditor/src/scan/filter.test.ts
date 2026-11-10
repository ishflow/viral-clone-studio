import { describe, expect, it } from 'vitest';
import { readSettings } from '../db/settings.ts';
import { openDb } from '../db/open.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { filter } from './filter.ts';
import type { ScanCard } from './filter.ts';

const settings = readSettings(openDb(join(mkdtempSync(join(tmpdir(), 'vc-f-')), 'db.sqlite')));
const top = (n: number, o: Partial<ScanCard> = {}): ScanCard => ({ source: 'topads', url: `https://t/${n}`, title: `t${n}`, seconds: 15, views: null, likes: n, image: null, video: null, ...o });
const sh = (n: number, o: Partial<ScanCard> = {}): ScanCard => ({ source: 'shorts', url: `https://s/${n}`, title: `s${n}`, seconds: 20, views: 600000, likes: null, image: null, video: null, ...o });

describe('filter', () => {
  it('drops seconds outside 6-35 (edges stay)', () => {
    const out = filter([top(1, { seconds: 5.9 }), top(2, { seconds: 6 }), top(3, { seconds: 35 }), top(4, { seconds: 35.1 })], settings, new Set());
    expect(out.map((c) => c.url)).toEqual(['https://t/3', 'https://t/2']);
  });
  it('drops Shorts under 500,000 views (500,000 stays)', () => {
    const out = filter([sh(1, { views: 499999 }), sh(2, { views: 500000 }), sh(3, { views: 900000 })], settings, new Set());
    expect(out.map((c) => c.url)).toEqual(['https://s/3', 'https://s/2']);
  });
  it('sorts Top Ads by likes and keeps the first 30 before anything else is dropped', () => {
    const cards = Array.from({ length: 40 }, (_, i) => top(i + 1));
    const s = { ...settings, perScan: 100 };
    const out = filter(cards, s, new Set());
    expect(out).toHaveLength(30);
    expect(out[0]!.likes).toBe(40);
    expect(out[29]!.likes).toBe(11);
  });
  it('drops a URL already in candidates, and a duplicate inside the batch', () => {
    const out = filter([top(1), top(1), top(2), top(3)], settings, new Set(['https://t/2']));
    expect(out.map((c) => c.url)).toEqual(['https://t/3', 'https://t/1']);
  });
  it('lets at most perScan (15) pass', () => {
    const out = filter(Array.from({ length: 25 }, (_, i) => top(i + 1)), settings, new Set());
    expect(out).toHaveLength(15);
    expect(out[0]!.likes).toBe(25);
  });
  it('does not change its inputs', () => {
    const cards = [top(1), top(2)]; const seen = new Set<string>();
    filter(cards, settings, seen);
    expect(cards.map((c) => c.url)).toEqual(['https://t/1', 'https://t/2']);
    expect(seen.size).toBe(0);
  });
  it('drops cards with non-finite or negative numbers or an empty URL', () => {
    const out = filter([
      top(1, { seconds: Number.NaN }), top(2, { seconds: Number.POSITIVE_INFINITY }), top(3, { seconds: -10 }),
      top(4, { likes: Number.NaN }), top(5, { likes: -1 }), top(6, { url: '' }), top(7, { url: '  ' }),
      sh(8, { views: Number.NaN }), sh(9, { views: Number.POSITIVE_INFINITY }), top(10),
    ], settings, new Set());
    expect(out.map((c) => c.url)).toEqual(['https://t/10']);
  });
});
