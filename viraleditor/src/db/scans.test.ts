import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { openDb } from './open.ts';
import { addAboveThreshold, addPrepared, addQueued, begin, end, get, list, setChecked } from './scans.ts';

const mem = () => openDb(join(mkdtempSync(join(tmpdir(), 'vc-scans-')), 'db.sqlite'));
const T0 = new Date('2026-10-04T09:00:00.000Z');
const T1 = new Date('2026-10-04T09:01:00.000Z');

describe('scans repository', () => {
  it('begin makes a running row; a second begin with the same id resets it (a taken-over run)', () => {
    const db = mem();
    begin(db, 's1', 'topads', T0);
    expect(get(db, 's1')).toEqual({ id: 's1', source: 'topads', startedAt: T0.toISOString(), finishedAt: null, checked: 0, queued: 0, aboveThreshold: 0, prepared: 0, status: 'running', reason: null });
    setChecked(db, 's1', 7);
    addQueued(db, 's1');
    begin(db, 's1', 'topads', T1);
    expect(get(db, 's1')).toMatchObject({ checked: 0, queued: 0, startedAt: T1.toISOString(), status: 'running' });
  });

  it('end writes status, reason and finish time', () => {
    const db = mem();
    begin(db, 's1', 'shorts', T0);
    end(db, 's1', 'stopped', 'source-unavailable', T1);
    expect(get(db, 's1')).toMatchObject({ status: 'stopped', reason: 'source-unavailable', finishedAt: T1.toISOString() });
    begin(db, 's2', 'topads', T0);
    end(db, 's2', 'done', null, T1);
    expect(get(db, 's2')).toMatchObject({ status: 'done', reason: null });
  });

  it('counters add one atomically; unknown id changes nothing; get returns null; list is newest first', () => {
    const db = mem();
    begin(db, 's1', 'topads', T0);
    begin(db, 's2', 'shorts', T1);
    addAboveThreshold(db, 's1'); addAboveThreshold(db, 's1'); addPrepared(db, 's1');
    addPrepared(db, 'nope');
    expect(get(db, 's1')).toMatchObject({ aboveThreshold: 2, prepared: 1 });
    expect(get(db, 'nope')).toBeNull();
    expect(list(db).map((s) => s.id)).toEqual(['s2', 's1']);
  });
});
