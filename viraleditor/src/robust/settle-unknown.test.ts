// R3: the operator looked at the provider's task list and says "this request never reached the provider": the `unknown` row
// becomes `failed` (a new attempt may be sent), once, on the record, and its units go back like those of a refused POST.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { RunInput } from '../contracts.ts';
import { openDb } from '../db/open.ts';
import { beginOperation, endOperation, enqueue, getRun, operation } from '../db/runs.ts';
import { budgetSchema, consumeProvider, refundProvider, reserveProvider } from './provider-budget.ts';
import { settleUnknown } from './settle-unknown.ts';

const DAY = new Date('2026-10-06T10:00:00Z');
const LATER = new Date('2026-10-06T11:30:00Z');
const caps = { daily: 1000, job: 60 };
const refundOf = (db: DatabaseSync) => (key: string, units: number, at: Date): void => refundProvider(db, caps, key, units, at);
const input: RunInput = { kind: 'produce', templateId: 't', quality: 'fast', variants: 1, language: 'en', products: [], sample: false };

function world(state: 'stopped' | 'running' | 'done' = 'stopped', reason: string | null = 'submission-unknown') {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'vc-settle-')), 'db.sqlite')); budgetSchema(db);
  const id = enqueue(db, input, 'job-1', null, DAY);
  db.prepare('UPDATE runs SET state = ?, reason = ? WHERE id = ?').run(state, reason, id);
  reserveProvider(db, caps, 'job-1', 43, DAY);
  const row = (key: string, kind: 'image' | 'clip', patch: Parameters<typeof endOperation>[3], consumed = 0) => {
    beginOperation(db, id, key, kind, DAY);
    endOperation(db, id, key, patch, DAY);
    if (consumed > 0) consumeProvider(db, caps, 'job-1', consumed, DAY);
  };
  return { db, id, row };
}
const consumed = (db: DatabaseSync) => (db.prepare("SELECT COALESCE(SUM(consumed), 0) AS n FROM provider_budget WHERE run_id = 'job-1'").get() as { n: number }).n;
const states = (db: DatabaseSync, id: string) => Object.fromEntries((db.prepare('SELECT key, state FROM operations WHERE run_id = ? ORDER BY key').all(id) as { key: string; state: string }[]).map((r) => [r.key, r.state]));
const attempt = (fn: () => unknown): string => { try { fn(); } catch (e) { return (e as Error).message; } return 'no error'; };

describe('settleUnknown', () => {
  it('turns the unknown row into failed, on the record, and leaves every other row alone', () => {
    const { db, id, row } = world();
    row('v1:image:s1', 'image', { state: 'done', externalId: '/v1/ai/x/t1', output: 'a.png' }, 1);
    row('v1:image:s2', 'image', { state: 'unknown', error: 'POST /v1/ai/x answered HTTP 503 without a task [units:1]' }, 1);
    row('v1:image:s3', 'image', { state: 'failed', error: 'refused' });
    const done = settleUnknown(db, refundOf(db), { runId: id, by: 'admin Ayşe', at: LATER });
    expect(done.keys).toEqual(['v1:image:s2']);
    expect(states(db, id)).toEqual({ 'v1:image:s1': 'done', 'v1:image:s2': 'failed', 'v1:image:s3': 'failed' });
    const settled = operation(db, id, 'v1:image:s2')!;
    expect(settled.error).toContain('admin Ayşe');
    expect(settled.error).toContain('2026-10-06T11:30:00.000Z');
    expect(settled.error).toContain('503');                              // what the row said before is kept
    expect(settled.externalId).toBeNull();
    expect(operation(db, id, 'v1:image:s1')!.updatedAt).toBe(DAY.toISOString());
    // nothing is unknown any more: the run is still stopped (the site's resume continues it) but no longer for that reason
    expect(getRun(db, id)).toMatchObject({ state: 'stopped', reason: 'engine-error', detail: null });
  });

  it('gives back the units that the row consumed (a clip: its seconds), and only those', () => {
    const { db, id, row } = world();
    row('v1:image:s1', 'image', { state: 'done', externalId: '/v1/ai/x/t1', output: 'a.png' }, 1);
    row('v1:clip:s1', 'clip', { state: 'unknown', error: 'no answer [units:5]' }, 5);
    const done = settleUnknown(db, refundOf(db), { runId: id, by: 'a', at: LATER });
    expect(done.refunded).toBe(5);
    expect(consumed(db)).toBe(1);                                         // the image that was accepted stays counted
  });

  it('a row that does not say its units (a worker died while sending) is settled but not refunded', () => {
    const { db, id, row } = world();
    row('v1:image:s2', 'image', { state: 'unknown', error: 'the worker stopped before the provider answered: the request may exist' }, 1);
    const done = settleUnknown(db, refundOf(db), { runId: id, by: 'a', at: LATER });
    expect(done).toMatchObject({ keys: ['v1:image:s2'], refunded: 0 });
    expect(consumed(db)).toBe(1);
  });

  it('settles only the keys it is given, and refuses a key that is not unknown', () => {
    const { db, id, row } = world();
    row('v1:image:s1', 'image', { state: 'unknown', error: 'x [units:1]' }, 1);
    row('v1:image:s2', 'image', { state: 'unknown', error: 'x [units:1]' }, 1);
    row('v1:image:s3', 'image', { state: 'done', externalId: '/v1/ai/x/t3', output: 'c.png' }, 1);
    expect(attempt(() => settleUnknown(db, refundOf(db), { runId: id, by: 'a', at: LATER, keys: ['v1:image:s3'] }))).toBe('not-unknown');
    expect(attempt(() => settleUnknown(db, refundOf(db), { runId: id, by: 'a', at: LATER, keys: ['v1:image:nope'] }))).toBe('not-unknown');
    expect(states(db, id)).toEqual({ 'v1:image:s1': 'unknown', 'v1:image:s2': 'unknown', 'v1:image:s3': 'done' });   // nothing changed
    expect(settleUnknown(db, refundOf(db), { runId: id, by: 'a', at: LATER, keys: ['v1:image:s1'] }).keys).toEqual(['v1:image:s1']);
    expect(states(db, id)).toEqual({ 'v1:image:s1': 'failed', 'v1:image:s2': 'unknown', 'v1:image:s3': 'done' });
    expect(getRun(db, id)).toMatchObject({ reason: 'submission-unknown' });        // another request is still unknown: the run is still stuck on it
  });

  it('only once: a second call finds nothing unknown and gives nothing back twice', () => {
    const { db, id, row } = world();
    row('v1:image:s2', 'image', { state: 'unknown', error: 'x [units:1]' }, 1);
    settleUnknown(db, refundOf(db), { runId: id, by: 'a', at: LATER });
    expect(attempt(() => settleUnknown(db, refundOf(db), { runId: id, by: 'b', at: LATER }))).toBe('not-settleable');   // the run is not stuck any more
    expect(consumed(db)).toBe(0);
  });

  it('refuses a run that is not a stopped produce run with submission-unknown, and a run without any unknown row', () => {
    for (const [state, reason] of [['running', null], ['done', null], ['stopped', 'engine-error']] as const) {
      const { db, id, row } = world(state, reason);
      row('v1:image:s2', 'image', { state: 'unknown', error: 'x [units:1]' }, 1);
      expect(attempt(() => settleUnknown(db, refundOf(db), { runId: id, by: 'a', at: LATER }))).toBe('not-settleable');
      expect(states(db, id)).toEqual({ 'v1:image:s2': 'unknown' });
    }
    const { db, id, row } = world();
    row('v1:image:s1', 'image', { state: 'failed', error: 'refused' });
    expect(attempt(() => settleUnknown(db, refundOf(db), { runId: id, by: 'a', at: LATER }))).toBe('not-unknown');
    const other = openDb(join(mkdtempSync(join(tmpdir(), 'vc-settle-')), 'db.sqlite'));
    expect(attempt(() => settleUnknown(other, null, { runId: 'no-such-run', by: 'a', at: LATER }))).toBe('not-settleable');
  });

  it('an unknown row that has a ticket is not settled: the provider took that request', () => {
    const { db, id, row } = world();
    row('v1:image:s1', 'image', { state: 'unknown', externalId: '/v1/ai/x/t9', error: '/v1/ai/x/t9' }, 1);
    expect(attempt(() => settleUnknown(db, refundOf(db), { runId: id, by: 'a', at: LATER }))).toBe('has-ticket');
    expect(states(db, id)).toEqual({ 'v1:image:s1': 'unknown' });
  });

  it('who is required: nobody settles anonymously', () => {
    const { db, id, row } = world();
    row('v1:image:s2', 'image', { state: 'unknown', error: 'x [units:1]' }, 1);
    expect(attempt(() => settleUnknown(db, refundOf(db), { runId: id, by: '  ', at: LATER }))).toBe('by-required');
    expect(states(db, id)).toEqual({ 'v1:image:s2': 'unknown' });
  });

  it('without a budget (no caps) it still settles', () => {
    const { db, id, row } = world();
    row('v1:image:s2', 'image', { state: 'unknown', error: 'x [units:1]' }, 1);
    expect(settleUnknown(db, null, { runId: id, by: 'a', at: LATER })).toMatchObject({ keys: ['v1:image:s2'], refunded: 0 });
    expect(consumed(db)).toBe(1);
  });
});
