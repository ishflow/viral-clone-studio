import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { openDb } from './open.ts';
import * as templates from './templates.ts';
import * as candidates from './candidates.ts';
import type { Card } from '../contracts.ts';

const mem = () => openDb(join(mkdtempSync(join(tmpdir(), 'vc-tpl-')), 'db.sqlite'));
const T0 = new Date('2026-10-04T10:00:00.000Z');
const card: Card = { title: 'x', category: 'c', format: 'no-talking', seconds: 10, referenceViews: '1M', image: null, video: null, products: 1, shots: [], description: '', tags: [] };

describe('templates', () => {
  it('upserts, gets, lists, sets state and keeps times_generated', () => {
    const db = mem();
    templates.upsert(db, { id: 't1', state: 'preparing', owner: 'u1', sourceKind: 'link', sourceUrl: 'https://x.test', note: null, card, estimate: null, minutes: null }, T0);
    db.prepare('UPDATE templates SET times_generated = 4 WHERE id = ?').run('t1');
    templates.upsert(db, { id: 't1', state: 'ready', owner: 'u1', sourceKind: 'link', sourceUrl: 'https://x.test', note: null, card, estimate: { images: 1, clips: 1, clipSeconds: 4, music: 0, voice: 0 }, minutes: 5 }, new Date(T0.getTime() + 1000));
    const row = templates.get(db, 't1')!;
    expect(row).toMatchObject({ state: 'ready', timesGenerated: 4, minutes: 5, createdAt: T0.toISOString() });
    expect(row.estimate?.clips).toBe(1);
    expect(row.card.title).toBe('x');
    templates.setState(db, 't1', 'failed', 'check-failed', T0);
    expect(templates.get(db, 't1')).toMatchObject({ state: 'failed', note: 'check-failed' });
    expect(templates.list(db, { state: 'ready' })).toHaveLength(0);
    expect(templates.list(db)).toHaveLength(1);
    expect(templates.get(db, 'nope')).toBeNull();
  });

  it('setCard writes the card, the estimate, the minutes and the note, and nothing else; false when the row is gone', () => {
    const db = mem();
    templates.upsert(db, { id: 't1', state: 'published', owner: 'u1', sourceKind: 'link', sourceUrl: 'https://x.test', note: null, card, estimate: null, minutes: null, timesGenerated: 4 }, T0);
    const later = new Date(T0.getTime() + 1000);
    const estimate = { images: 2, clips: 2, clipSeconds: 8, music: 1, voice: 0 };
    expect(templates.setCard(db, 't1', { card: { ...card, title: 'y' }, estimate, minutes: 6, note: 'check-failed' }, later)).toBe(true);
    expect(templates.get(db, 't1')).toEqual({
      id: 't1', state: 'published', owner: 'u1', sourceKind: 'link', sourceUrl: 'https://x.test', note: 'check-failed', card: { ...card, title: 'y' },
      estimate, minutes: 6, timesGenerated: 4, createdAt: T0.toISOString(), updatedAt: later.toISOString(),
    });
    expect(templates.setCard(db, 't1', { card, estimate: null, minutes: null, note: null }, later)).toBe(true);
    expect(templates.get(db, 't1')).toMatchObject({ state: 'published', note: null, estimate: null, minutes: null, card });
    expect(templates.setCard(db, 'gone', { card, estimate: null, minutes: null, note: null }, later)).toBe(false);
    expect(templates.list(db)).toHaveLength(1);
  });
});

describe('candidates', () => {
  it('upserts, lists and sets state', () => {
    const db = mem();
    candidates.upsert(db, { id: 'c1', scanId: 's1', source: 'topads', url: 'https://x.test/1', title: 'a', views: null, likes: 5, seconds: 12, state: 'found', score: null, scoreNotes: null, image: null }, T0);
    candidates.upsert(db, { id: 'c1', scanId: 's1', source: 'topads', url: 'https://x.test/1', title: 'a', views: null, likes: 5, seconds: 12, state: 'scored', score: 80, scoreNotes: 'ok', image: null }, T0);
    candidates.setState(db, 'c1', 'prepared', T0);
    expect(candidates.get(db, 'c1')).toMatchObject({ state: 'prepared', score: 80, foundAt: T0.toISOString() });
    expect(candidates.list(db, { state: 'found' })).toHaveLength(0);
    expect(candidates.list(db)).toHaveLength(1);
  });
});
