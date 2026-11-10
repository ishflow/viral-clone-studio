import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { openDb } from './open.ts';
import * as runs from './runs.ts';
import type { RunInput } from '../contracts.ts';

const T0 = new Date('2026-10-04T10:00:00.000Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const produce: RunInput = { kind: 'produce', templateId: 't1', quality: 'fast', variants: 1, language: 'en', products: [], sample: false };
const scan: RunInput = { kind: 'scan', source: 'topads', trigger: 'manual' };
const prepare: RunInput = { kind: 'prepare', templateId: 't2', ownerId: null, from: { kind: 'link', url: 'https://x.test/v' } };
const paid = { images: 2, clips: 3, clipSeconds: 12, music: 1, voice: 0 };

function file() { return join(mkdtempSync(join(tmpdir(), 'vc-runs-')), 'db.sqlite'); }

describe('runs', () => {
  it('two claim calls on one queued run: one gets it', () => {
    const f = file();
    const a = openDb(f); const b = openDb(f);
    const id = runs.enqueue(a, scan, 's1', null, T0);
    const r1 = runs.claim(a, 'w1', at(1));
    const r2 = runs.claim(b, 'w2', at(1));
    expect([r1, r2].filter((r) => r !== null)).toHaveLength(1);
    expect(r1?.id).toBe(id);
    expect(r1?.state).toBe('running');
    expect(r1?.claimedBy).toBe('w1');
    expect(r1?.input).toEqual(scan);
  });

  it('takes over a running run with a 61 s old heartbeat, not a 30 s old one', () => {
    const db = openDb(file());
    runs.enqueue(db, scan, 's1', null, T0);
    expect(runs.claim(db, 'w1', at(0))).not.toBeNull();
    expect(runs.claim(db, 'w2', at(30))).toBeNull();
    const took = runs.claim(db, 'w2', at(61));
    expect(took?.claimedBy).toBe('w2');
    runs.beat(db, took!.id, at(100));
    expect(runs.claim(db, 'w3', at(130))).toBeNull();
    expect(runs.claim(db, 'w3', at(161))?.claimedBy).toBe('w3');
  });

  it('does not claim prepare / scan / edit while a produce run is queued', () => {
    const db = openDb(file());
    runs.enqueue(db, prepare, 't2', null, T0);
    runs.enqueue(db, scan, 's1', null, at(1));
    const p = runs.enqueue(db, produce, 'job1', paid, at(2));
    expect(runs.claim(db, 'w1', at(3))?.id).toBe(p);
    // produce is now running (fresh heartbeat): the others may follow
    expect(runs.claim(db, 'w2', at(4))?.kind).toBe('prepare');
  });

  it('keeps prepare waiting while a stale running produce run is claimable', () => {
    const db = openDb(file());
    const p = runs.enqueue(db, produce, 'job1', paid, T0);
    runs.claim(db, 'w1', at(0));
    runs.enqueue(db, prepare, 't2', null, at(1));
    expect(runs.claim(db, 'w2', at(70))?.id).toBe(p);
  });

  it('beginOperation twice with the same key returns the existing row', () => {
    const db = openDb(file());
    const id = runs.enqueue(db, produce, 'job1', paid, T0);
    const first = runs.beginOperation(db, id, 'v1:image:s1', 'image', T0);
    expect(first!.created).toBe(true);
    expect(first!.row.state).toBe('pending');
    runs.endOperation(db, id, 'v1:image:s1', { externalId: 'b-1' }, at(1));
    const second = runs.beginOperation(db, id, 'v1:image:s1', 'image', at(2));
    expect(second!.created).toBe(false);
    expect(second!.row.externalId).toBe('b-1');
    expect((db.prepare('SELECT count(*) AS n FROM operations').get() as { n: number }).n).toBe(1);
    runs.endOperation(db, id, 'v1:image:s1', { state: 'done', output: 'x' }, at(3));
    expect(runs.operation(db, id, 'v1:image:s1')).toMatchObject({ state: 'done', externalId: 'b-1', output: 'x' });
    expect(runs.operation(db, id, 'nope')).toBeNull();
  });

  it('writes steps, sent, finish and stop with parsed JSON columns', () => {
    const db = openDb(file());
    const id = runs.enqueue(db, produce, 'job1', paid, T0);
    runs.claim(db, 'w1', at(0));
    runs.setSteps(db, id, [{ key: 'images', status: 'running', done: 1, total: 2 }], at(1));
    runs.addSent(db, id, { images: 1 }, at(2));
    runs.addSent(db, id, { images: 1, clips: 2, clipSeconds: 8 }, at(3));
    let r = runs.getRun(db, id)!;
    expect(r.steps[0]?.done).toBe(1);
    expect(r.sent).toEqual({ images: 2, clips: 2, clipSeconds: 8, music: 0, voice: 0 });
    expect(r.approved).toEqual(paid);
    runs.stop(db, id, 'estimate-exceeded', { images: 0, clips: 1, clipSeconds: 4, music: 0, voice: 0 }, at(4));
    r = runs.getRun(db, id)!;
    expect(r).toMatchObject({ state: 'stopped', reason: 'estimate-exceeded' });
    expect(r.missing?.clips).toBe(1);
    const id2 = runs.enqueue(db, { ...produce, templateId: 't9' }, 'job2', paid, at(5));
    runs.claim(db, 'w1', at(6));
    runs.finish(db, id2, { kind: 'produce', variants: [] }, at(7));
    expect(runs.getRun(db, id2)).toMatchObject({ state: 'done', result: { kind: 'produce', variants: [] } });
  });

  it('finish stores a closed diagnostic code in detail, and nothing else', () => {
    const db = openDb(file());
    const done = (code: string | null) => {
      const id = runs.enqueue(db, produce, `job-${code}`, paid, T0);
      runs.claim(db, 'w1', at(0));
      runs.finish(db, id, { kind: 'prepare', state: 'failed', note: 'llm-invalid' }, at(1), code);
      return runs.getRun(db, id)!.detail;
    };
    expect(done('notes:too_big,unrecognized_keys')).toBe('notes:too_big,unrecognized_keys');
    expect(done('the model said: my key is sk-123')).toBeNull();
    expect(done(null)).toBeNull();
  });

  it('a queued run with broken input JSON is stopped with engine-error and the run behind it is claimed', () => {
    const db = openDb(file());
    const bad = runs.enqueue(db, scan, 's1', null, T0);
    const good = runs.enqueue(db, { ...scan, source: 'shorts' }, 's2', null, at(1));
    db.prepare('UPDATE runs SET input = ? WHERE id = ?').run('{not json', bad);
    expect(runs.claim(db, 'w1', at(2))?.id).toBe(good);
    const row = db.prepare('SELECT state, reason FROM runs WHERE id = ?').get(bad);
    expect(row).toMatchObject({ state: 'stopped', reason: 'engine-error' });
  });

  it('finish, stop, setSteps, addSent and beat change only a running run', () => {
    const db = openDb(file());
    const id = runs.enqueue(db, produce, 'job1', paid, T0);
    expect(runs.beat(db, id, at(1))).toBe(false);          // still queued
    runs.claim(db, 'w1', at(2));
    expect(runs.beat(db, id, at(3))).toBe(true);
    expect(runs.finish(db, id, { kind: 'produce', variants: [] }, at(4))).toBe(true);
    expect(runs.stop(db, id, 'engine-error', null, at(5))).toBe(false);
    expect(runs.setSteps(db, id, [], at(6))).toBe(false);
    expect(runs.addSent(db, id, { images: 1 }, at(7))).toBe(false);
    expect(runs.getRun(db, id)).toMatchObject({ state: 'done', reason: null, sent: null });
  });
  const hold = (db: ReturnType<typeof openDb>, id: string, heartbeat: string | null) =>
    db.prepare(`UPDATE runs SET state = 'held', heartbeat = ? WHERE id = ?`).run(heartbeat, id);

  it('claim never returns a held run, also when it is the oldest row', () => {
    const db = openDb(file());
    const heldId = runs.enqueue(db, produce, 'job1', paid, T0);
    hold(db, heldId, null);
    expect(runs.claim(db, 'w1', at(1))).toBeNull();
    const queuedId = runs.enqueue(db, produce, 'job2', paid, at(2));
    expect(runs.claim(db, 'w1', at(3))?.id).toBe(queuedId);
    expect(runs.getRun(db, heldId)?.state).toBe('held');
  });

  it('a held run with an old or NULL heartbeat is not taken over', () => {
    const db = openDb(file());
    const a = runs.enqueue(db, produce, 'job1', paid, T0);
    const b = runs.enqueue(db, scan, 'scan1', null, T0);
    hold(db, a, null);
    hold(db, b, T0.toISOString());
    expect(runs.claim(db, 'w1', at(600))).toBeNull();
    expect(runs.getRun(db, a)).toMatchObject({ state: 'held', claimedBy: null });
    expect(runs.getRun(db, b)?.state).toBe('held');
  });

  it('operations rows of kind image and clip can be written; kind build is refused by the database', () => {
    const db = openDb(file());
    const id = runs.enqueue(db, produce, 'job1', paid, T0);
    expect(runs.beginOperation(db, id, 'v1:image:s1', 'image', T0)!.created).toBe(true);
    expect(runs.beginOperation(db, id, 'v1:clip:s1', 'clip', T0)!.created).toBe(true);
    const count = () => (db.prepare('SELECT count(*) AS n FROM operations WHERE run_id = ?').get(id) as { n: number }).n;
    const before = count();
    expect(() => runs.beginOperation(db, id, 'v1:build', 'build' as never, T0)).toThrow(/CHECK constraint failed/);
    expect(count()).toBe(before);
  });

  it('a new run has no variants; setVariants writes them on a running run only', () => {
    const db = openDb(file());
    const id = runs.enqueue(db, produce, 'job1', paid, T0);
    expect(runs.getRun(db, id)?.variants).toEqual([]);
    const variants = [
      { n: 1, status: 'done' as const, video: 'jobs/r/v1/final.mp4', image: 'jobs/r/v1/poster.jpg', reason: null },
      { n: 2, status: 'stopped' as const, video: null, image: null, reason: 'clips-failed' as const },
    ];
    expect(runs.setVariants(db, id, variants, at(1))).toBe(false);          // still queued
    expect(runs.getRun(db, id)?.variants).toEqual([]);
    runs.claim(db, 'w1', at(2));
    expect(runs.setVariants(db, id, variants, at(3))).toBe(true);
    expect(runs.getRun(db, id)).toMatchObject({ variants, updatedAt: at(3).toISOString() });
    runs.stop(db, id, 'clips-failed', null, at(4));
    expect(runs.setVariants(db, id, [], at(5))).toBe(false);
    expect(runs.getRun(db, id)?.variants).toEqual(variants);
  });

  it('a queued run with broken variants JSON is stopped with engine-error and the run behind it is claimed', () => {
    const db = openDb(file());
    const bad = runs.enqueue(db, produce, 'job1', paid, T0);
    const good = runs.enqueue(db, { ...produce, templateId: 't9' }, 'job2', paid, at(1));
    db.prepare('UPDATE runs SET variants = ? WHERE id = ?').run('[not json', bad);
    expect(runs.claim(db, 'w1', at(2))?.id).toBe(good);
    expect(db.prepare('SELECT state, reason FROM runs WHERE id = ?').get(bad)).toMatchObject({ state: 'stopped', reason: 'engine-error' });
  });

  it('beginOwnOperation writes the row only for a run that is running and claimed by that worker, in one transaction', () => {
    const db = openDb(file());
    const id = runs.enqueue(db, produce, 'job1', paid, T0);
    const count = () => (db.prepare('SELECT count(*) AS n FROM operations WHERE run_id = ?').get(id) as { n: number }).n;
    expect(runs.beginOwnOperation(db, id, 'v1:image:s1', 'image', 'w1', at(1))).toBeNull();          // still queued
    runs.claim(db, 'w1', at(2));
    expect(runs.beginOwnOperation(db, id, 'v1:image:s1', 'image', 'w2', at(3))).toBeNull();          // another worker's run
    expect(count()).toBe(0);
    expect(runs.beginOwnOperation(db, id, 'v1:image:s1', 'image', 'w1', at(4))).toMatchObject({ created: true, row: { state: 'pending', kind: 'image' } });
    expect(runs.beginOwnOperation(db, id, 'v1:image:s1', 'image', 'w1', at(5))).toMatchObject({ created: false, row: { key: 'v1:image:s1' } });
    db.prepare(`UPDATE runs SET claimed_by = 'w2' WHERE id = ?`).run(id);                              // a takeover
    expect(runs.beginOwnOperation(db, id, 'v1:image:s2', 'image', 'w1', at(6))).toBeNull();
    db.prepare(`UPDATE runs SET claimed_by = 'w1' WHERE id = ?`).run(id);
    runs.stop(db, id, 'engine-error', null, at(7));
    expect(runs.beginOwnOperation(db, id, 'v1:image:s2', 'image', 'w1', at(8))).toBeNull();          // stopped
    expect(count()).toBe(1);
  });
});

describe('runs: writes made as the owner (C6b, F8 / F9)', () => {
  /** A scan run claimed by w1 at 1 s. */
  function claimed() {
    const db = openDb(file());
    const id = runs.enqueue(db, scan, 's1', null, T0);
    runs.claim(db, 'w1', at(1));
    return { db, id };
  }
  const result = { kind: 'scan', checked: 1, aboveThreshold: 0, prepared: 0 } as const;

  it('inside asOwner, a write of the run by a worker that lost it changes nothing and is coded not-owner', () => {
    const { db, id } = claimed();
    runs.claim(db, 'w2', at(62));                                                                     // w1's heartbeat is stale: w2 takes over
    const own: runs.Owner = { runId: id, workerId: 'w1', refused: null };
    runs.asOwner(own, () => {
      expect(runs.setSteps(db, id, [{ key: 'render', status: 'done', done: 1, total: 1 }], at(63))).toBe(false);
      expect(runs.setVariants(db, id, [{ n: 1, status: 'done', video: 'v.mp4', image: null, reason: null }], at(63))).toBe(false);
      expect(runs.beat(db, id, at(63))).toBe(false);
      expect(runs.finish(db, id, result, at(63))).toBe(false);
      expect(runs.stop(db, id, 'engine-error', null, at(63))).toBe(false);
    });
    expect(own.refused).toBe('not-owner');
    expect(runs.getRun(db, id)).toMatchObject({ state: 'running', claimedBy: 'w2', steps: [], variants: [], heartbeat: at(62).toISOString() });
  });

  it('inside asOwner, addSent (the money record) by a worker that lost the run adds nothing and is coded not-owner', () => {
    const { db, id } = claimed();
    const own: runs.Owner = { runId: id, workerId: 'w1', refused: null };
    expect(runs.asOwner(own, () => runs.addSent(db, id, { images: 2 }, at(2)))).toBe(true);           // the holder's own: counted
    runs.claim(db, 'w2', at(62));                                                                     // w1's heartbeat is stale: w2 takes over
    expect(runs.asOwner(own, () => runs.addSent(db, id, { images: 1 }, at(63)))).toBe(false);
    expect(own.refused).toBe('not-owner');
    expect(runs.getRun(db, id)?.sent).toMatchObject({ images: 2 });
    runs.finish(db, id, result, at(64));                                                              // ended: coded not-running
    const late: runs.Owner = { runId: id, workerId: 'w2', refused: null };
    expect(runs.asOwner(late, () => runs.addSent(db, id, { images: 1 }, at(65)))).toBe(false);
    expect(late.refused).toBe('not-running');
  });

  it('inside asOwner, beginOperation / beginOwnOperation by a worker that lost the run write no row and are coded not-owner', () => {
    const { db, id } = claimed();
    const own: runs.Owner = { runId: id, workerId: 'w1', refused: null };
    expect(runs.asOwner(own, () => runs.beginOperation(db, id, 'v1:image:a', 'image', at(2)))).toMatchObject({ created: true });   // the holder's own
    runs.claim(db, 'w2', at(62));
    expect(runs.asOwner(own, () => runs.beginOperation(db, id, 'v1:image:b', 'image', at(63)))).toBeNull();
    expect(own.refused).toBe('not-owner');
    own.refused = null;
    expect(runs.asOwner(own, () => runs.beginOwnOperation(db, id, 'v1:image:c', 'image', 'w1', at(63)))).toBeNull();
    expect(own.refused).toBe('not-owner');
    expect(runs.operation(db, id, 'v1:image:b')).toBeNull();
    expect(runs.operation(db, id, 'v1:image:c')).toBeNull();
    runs.finish(db, id, result, at(64));
    const late: runs.Owner = { runId: id, workerId: 'w2', refused: null };
    expect(runs.asOwner(late, () => runs.beginOperation(db, id, 'v1:image:d', 'image', at(65)))).toBeNull();
    expect(late.refused).toBe('not-running');
  });

  it('inside asOwner, endOperation by a worker that lost the run leaves the new owner\'s rows as they are (I1)', () => {
    const { db, id } = claimed();
    runs.beginOperation(db, id, 'v1:image:a', 'image', at(2));                                       // w1's own rows: one in flight, one done
    runs.beginOperation(db, id, 'v1:image:b', 'image', at(2));
    runs.endOperation(db, id, 'v1:image:b', { state: 'done', output: 'b.png' }, at(2));
    runs.claim(db, 'w2', at(62));                                                                     // w2 took the run over
    const own: runs.Owner = { runId: id, workerId: 'w1', refused: null };                             // w1 wakes up
    runs.asOwner(own, () => {
      runs.endOperation(db, id, 'v1:image:a', { state: 'unknown', error: 'the worker stopped' }, at(63));
      runs.endOperation(db, id, 'v1:image:b', { state: 'failed', error: 'refused-by-assemble' }, at(63));
    });
    expect(own.refused).toBe('not-owner');
    expect(runs.operation(db, id, 'v1:image:a')).toMatchObject({ state: 'pending', error: null });
    expect(runs.operation(db, id, 'v1:image:b')).toMatchObject({ state: 'done', output: 'b.png', error: null });
    // the holder's own write goes through, in or out of a scope
    const mine: runs.Owner = { runId: id, workerId: 'w2', refused: null };
    runs.asOwner(mine, () => runs.endOperation(db, id, 'v1:image:a', { externalId: 't-1' }, at(64)));
    expect(runs.operation(db, id, 'v1:image:a')).toMatchObject({ state: 'pending', externalId: 't-1' });
    expect(mine.refused).toBeNull();
    // a ticket the lost worker's request was given is still recorded (it says what was accepted); nothing else of it is
    runs.beginOperation(db, id, 'v1:image:c', 'image', at(65));
    runs.asOwner(own, () => runs.endOperation(db, id, 'v1:image:c', { externalId: 't-late' }, at(66)));
    expect(runs.operation(db, id, 'v1:image:c')).toMatchObject({ state: 'pending', externalId: 't-late' });
    runs.endOperation(db, id, 'v1:image:c', { state: 'done' }, at(67));                                // outside a scope: as before
    expect(runs.operation(db, id, 'v1:image:c')?.state).toBe('done');
  });

  it('inside asOwner, the owner\'s own writes go through; a refusal on a run that ended is coded not-running', async () => {
    const { db, id } = claimed();
    const own: runs.Owner = { runId: id, workerId: 'w1', refused: null };
    await runs.asOwner(own, async () => {
      await Promise.resolve();                                                                         // the scope survives an await
      expect(runs.setSteps(db, id, [], at(2))).toBe(true);
      expect(runs.beat(db, id, at(2))).toBe(true);
      expect(runs.finish(db, id, result, at(3))).toBe(true);
      expect(own.refused).toBeNull();
      expect(runs.finish(db, id, result, at(4))).toBe(false);
    });
    expect(own.refused).toBe('not-running');
    expect(runs.getRun(db, id)).toMatchObject({ state: 'done', claimedBy: 'w1' });
  });

  it('asOwner guards only its own run; outside asOwner the writes are as before', () => {
    const { db, id } = claimed();
    const other = runs.enqueue(db, scan, 's2', null, at(1));
    runs.claim(db, 'w9', at(2));
    runs.asOwner({ runId: id, workerId: 'w1', refused: null }, () => {
      expect(runs.setSteps(db, other, [], at(3))).toBe(true);                                          // another run: unchecked, as before
    });
    runs.claim(db, 'w2', at(62));
    expect(runs.finish(db, id, result, at(63))).toBe(true);                                            // no scope: as before
  });

  it('release hands a run back: unclaimed, claimable at once, and the old owner\'s writes are refused', () => {
    const { db, id } = claimed();
    expect(runs.release(db, id, 'w2', at(2))).toBe(false);                                             // not w2's
    expect(runs.release(db, id, 'w1', at(2))).toBe(true);
    expect(runs.getRun(db, id)).toMatchObject({ state: 'running', claimedBy: null, heartbeat: null });
    const own: runs.Owner = { runId: id, workerId: 'w1', refused: null };
    expect(runs.asOwner(own, () => runs.finish(db, id, result, at(3)))).toBe(false);
    expect(own.refused).toBe('not-owner');
    expect(runs.claim(db, 'w3', at(3))).toMatchObject({ id, claimedBy: 'w3' });                        // no 60 s wait
  });

  it('holds: running and claimed by that worker', () => {
    const { db, id } = claimed();
    expect(runs.holds(db, id, 'w1')).toBe(true);
    expect(runs.holds(db, id, 'w2')).toBe(false);
    runs.finish(db, id, result, at(2));
    expect(runs.holds(db, id, 'w1')).toBe(false);
  });
});

describe('bounded crash recovery', () => {
  it('quarantines after three stale takeovers and claims the next job', () => {
    const db = openDb(file());
    const bad = runs.enqueue(db, produce, 'poison', paid, T0);
    runs.claim(db, 'initial', at(0));
    for (let n = 1; n <= 3; n++) expect(runs.claim(db, `w${n}`, at(61 * n))?.id).toBe(bad);
    const good = runs.enqueue(db, scan, 'next', null, at(184));
    expect(runs.claim(db, 'last', at(244))?.id).toBe(good);
    expect(runs.getRun(db, bad)).toMatchObject({ state: 'stopped', reason: 'engine-error', detail: 'takeover-limit', takeovers: 3 });
  });
  it('a voluntary hand-back consumes no crash budget', () => {
    const db = openDb(file());
    const id = runs.enqueue(db, scan, 'handback', null, T0);
    for (let n = 0; n < 5; n++) {
      expect(runs.claim(db, 'w', at(n))?.id).toBe(id);
      runs.release(db, id, 'w', at(n));
    }
    expect(runs.getRun(db, id)).toMatchObject({ takeovers: 0 });
  });
  it('aged non-produce work cannot starve behind newer produce work', () => {
    const db = openDb(file());
    const id = runs.enqueue(db, scan, 'old', null, T0);
    runs.enqueue(db, produce, 'new', paid, at(300));
    expect(runs.claim(db, 'w', at(301))?.id).toBe(id);
  });
});

it('a handed-back run is held by nobody, including a null caller', () => {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 've-unclaimed-')), 'db.sqlite'));
  const id = runs.enqueue(db, { kind: 'scan', source: 'topads', trigger: 'manual' }, 'unclaimed', null, at(0));
  runs.claim(db, 'w1', at(1)); runs.release(db, id, 'w1', at(2));
  expect(runs.holds(db, id, null)).toBe(false);
  db.close();
});

describe('claim for a lane: only the kinds asked for', () => {
  const edit = { kind: 'edit', templateId: 't3', ownerId: null, card: {} } as unknown as RunInput;

  it('takes the oldest queued run of those kinds and leaves the others queued, also a produce run that would go first', () => {
    const db = openDb(file());
    const p = runs.enqueue(db, produce, 'job1', paid, T0);
    const s = runs.enqueue(db, scan, 's1', null, at(1));
    const a = runs.enqueue(db, prepare, 't2', null, at(2));
    const b = runs.enqueue(db, prepare, 't2b', null, at(3));
    expect(runs.claim(db, 'w#0', at(4), ['prepare'])?.id).toBe(a);
    expect(runs.claim(db, 'w#1', at(4), ['prepare'])?.id).toBe(b);
    expect(runs.claim(db, 'w#0', at(4), ['prepare'])).toBeNull();
    expect(runs.getRun(db, p)?.state).toBe('queued');
    expect(runs.getRun(db, s)?.state).toBe('queued');
  });

  it('a lane of two kinds takes either, oldest first', () => {
    const db = openDb(file());
    runs.enqueue(db, prepare, 't2', null, T0);
    const e = runs.enqueue(db, edit, 't3', null, at(1));
    const s = runs.enqueue(db, scan, 's1', null, at(2));
    expect(runs.claim(db, 'w#2', at(3), ['scan', 'edit'])?.id).toBe(e);
    expect(runs.claim(db, 'w#2', at(3), ['scan', 'edit'])?.id).toBe(s);
    expect(runs.claim(db, 'w#2', at(3), ['scan', 'edit'])).toBeNull();
  });

  it('takes over a stale run of its kinds only: a dead worker\'s produce run is left to the produce lane', () => {
    const db = openDb(file());
    const p = runs.enqueue(db, produce, 'job1', paid, T0);
    const a = runs.enqueue(db, prepare, 't2', null, at(1));
    expect(runs.claim(db, 'dead', at(2))?.id).toBe(p);
    expect(runs.claim(db, 'dead', at(2))?.id).toBe(a);
    expect(runs.claim(db, 'w#0', at(30), ['prepare'])).toBeNull();                              // 28 s old: alive
    expect(runs.claim(db, 'w#0', at(63), ['prepare'])).toMatchObject({ id: a, claimedBy: 'w#0', takeovers: 1 });
    expect(runs.claim(db, 'w#1', at(63), ['prepare'])).toBeNull();
    expect(runs.getRun(db, p)).toMatchObject({ state: 'running', claimedBy: 'dead', takeovers: 0 });
    expect(runs.claim(db, 'w#5', at(63), ['produce'])).toMatchObject({ id: p, claimedBy: 'w#5', takeovers: 1 });
  });

  it('the takeover limit holds for every kind, whichever lane claims: a poisoned produce run is stopped by the prepare lane\'s claim', () => {
    const db = openDb(file());
    const bad = runs.enqueue(db, produce, 'poison', paid, T0);
    runs.claim(db, 'initial', at(0));
    for (let n = 1; n <= 3; n++) expect(runs.claim(db, `w${n}`, at(61 * n), ['produce'])?.id).toBe(bad);
    const next = runs.enqueue(db, prepare, 't2', null, at(184));
    expect(runs.claim(db, 'w#0', at(244), ['prepare'])?.id).toBe(next);
    expect(runs.getRun(db, bad)).toMatchObject({ state: 'stopped', reason: 'engine-error', detail: 'takeover-limit', takeovers: 3 });
  });

  it('a queued run of its kinds with broken JSON is stopped and the run behind it is claimed; a broken run of another kind is not touched', () => {
    const db = openDb(file());
    const brokenScan = runs.enqueue(db, scan, 's1', null, T0);
    const brokenPrepare = runs.enqueue(db, prepare, 't2', null, at(1));
    const good = runs.enqueue(db, prepare, 't2b', null, at(2));
    db.prepare(`UPDATE runs SET input = '{' WHERE id IN (?, ?)`).run(brokenScan, brokenPrepare);
    expect(runs.claim(db, 'w#0', at(3), ['prepare'])?.id).toBe(good);
    expect(db.prepare('SELECT state, detail FROM runs WHERE id = ?').get(brokenPrepare)).toMatchObject({ state: 'stopped', detail: 'invalid-run-json' });
    expect(db.prepare('SELECT state FROM runs WHERE id = ?').get(brokenScan)).toMatchObject({ state: 'queued' });
  });

  it('two slots of one worker are two owners: when slot 1 takes over slot 0\'s stale run, slot 0\'s writes are refused', () => {
    const db = openDb(file());
    const id = runs.enqueue(db, prepare, 't2', null, T0);
    const mine = runs.claim(db, 'w#0', at(0), ['prepare'])!;
    const own: runs.Owner = { runId: id, workerId: mine.claimedBy!, refused: null };
    expect(runs.claim(db, 'w#1', at(61), ['prepare'])).toMatchObject({ id, claimedBy: 'w#1' });
    runs.asOwner(own, () => {
      expect(runs.beat(db, id, at(62))).toBe(false);
      expect(runs.setSteps(db, id, [], at(62))).toBe(false);
      expect(runs.stop(db, id, 'engine-error', null, at(62))).toBe(false);
    });
    expect(own.refused).toBe('not-owner');
    expect(runs.release(db, id, 'w#0', at(62))).toBe(false);
    expect(runs.getRun(db, id)).toMatchObject({ state: 'running', claimedBy: 'w#1', heartbeat: at(61).toISOString() });
  });
});

describe('claim for the produce lane: the customer with the fewest jobs running goes first', () => {
  const of = (ownerId: string | null): RunInput => ({ ...produce, ownerId });
  const lane = ['produce'] as const;

  it('two customers, five runs: the one with fewer running is served first, with as many the oldest run, and no slot is left empty', () => {
    const db = openDb(file());
    const [a1, a2, a3] = [0, 1, 2].map((n) => runs.enqueue(db, of('a'), `a${n}`, paid, at(n)));
    const [b1, b2] = [3, 4].map((n) => runs.enqueue(db, of('b'), `b${n}`, paid, at(n)));
    expect(runs.claim(db, 'w#0', at(5), lane)?.id).toBe(a1);                                   // nobody runs anything: the oldest
    expect(runs.claim(db, 'w#1', at(5), lane)?.id).toBe(b1);                                   // a runs one, b none
    expect(runs.claim(db, 'w#2', at(5), lane)?.id).toBe(a2);                                   // one each: the oldest
    expect(runs.claim(db, 'w#3', at(5), lane)?.id).toBe(b2);                                   // a runs two, b one
    expect(runs.claim(db, 'w#4', at(5), lane)?.id).toBe(a3);                                   // only a waits: it is not kept waiting
    expect(runs.claim(db, 'w#5', at(5), lane)).toBeNull();
  });

  it('a run to take over goes before every queued run, also an older one of a customer with nothing running', () => {
    const db = openDb(file());
    const half = runs.enqueue(db, of('a'), 'a1', paid, at(5));
    expect(runs.claim(db, 'dead', at(6), lane)?.id).toBe(half);
    const waiting = runs.enqueue(db, of('b'), 'b1', paid, T0);                                 // released by the site after it was made
    expect(runs.claim(db, 'w#0', at(70), lane)).toMatchObject({ id: half, claimedBy: 'w#0', takeovers: 1 });
    expect(runs.claim(db, 'w#1', at(70), lane)?.id).toBe(waiting);
  });

  it('only running jobs count: a customer whose job is done stands as one with none', () => {
    const db = openDb(file());
    const done = runs.enqueue(db, of('a'), 'a1', paid, T0);
    runs.enqueue(db, of('b'), 'b1', paid, at(1));
    runs.claim(db, 'w#0', at(2), lane); runs.claim(db, 'w#1', at(2), lane);
    runs.finish(db, done, { kind: 'produce', variants: [] }, at(3));
    const b2 = runs.enqueue(db, of('b'), 'b2', paid, at(4));
    const a2 = runs.enqueue(db, of('a'), 'a2', paid, at(5));
    expect(runs.claim(db, 'w#0', at(6), lane)?.id).toBe(a2);
    expect(runs.claim(db, 'w#2', at(6), lane)?.id).toBe(b2);
  });

  it('only produce runs count: an inspection the customer has running does not make them wait', () => {
    const db = openDb(file());
    runs.enqueue(db, of('a'), 'a1', paid, T0);
    runs.enqueue(db, { ...prepare, ownerId: 'b' } as RunInput, 't2', null, at(1));
    runs.claim(db, 'w#0', at(2), lane); runs.claim(db, 'w#9', at(2), ['prepare']);
    const a2 = runs.enqueue(db, of('a'), 'a2', paid, at(3));
    const b1 = runs.enqueue(db, of('b'), 'b1', paid, at(4));
    expect(runs.claim(db, 'w#1', at(5), lane)?.id).toBe(b1);
    expect(runs.claim(db, 'w#2', at(5), lane)?.id).toBe(a2);
  });

  it('runs written before there was an owner (none, or null) count as one customer', () => {
    const db = openDb(file());
    const old1 = runs.enqueue(db, produce, 'old1', paid, T0);
    const old2 = runs.enqueue(db, of(null), 'old2', paid, at(1));
    const c1 = runs.enqueue(db, of('c'), 'c1', paid, at(2));
    expect(runs.claim(db, 'w#0', at(3), lane)?.id).toBe(old1);
    expect(runs.claim(db, 'w#1', at(3), lane)?.id).toBe(c1);
    expect(runs.claim(db, 'w#2', at(3), lane)?.id).toBe(old2);
  });

  it('a produce run with broken JSON, running or queued, does not stop the lane: the readable run is claimed and the queued broken one is stopped', () => {
    const db = openDb(file());
    const running = runs.enqueue(db, of('a'), 'a1', paid, T0);
    runs.claim(db, 'w#0', at(1), lane);
    const queued = runs.enqueue(db, of('b'), 'b1', paid, at(1));
    const good = runs.enqueue(db, of('a'), 'a2', paid, at(2));
    db.prepare(`UPDATE runs SET input = '{' WHERE id IN (?, ?)`).run(running, queued);
    expect(runs.claim(db, 'w#1', at(3), lane)?.id).toBe(good);
    expect(runs.claim(db, 'w#2', at(3), lane)).toBeNull();
    expect(db.prepare('SELECT state, detail FROM runs WHERE id = ?').get(queued)).toMatchObject({ state: 'stopped', detail: 'invalid-run-json' });
    expect(db.prepare('SELECT state, claimed_by FROM runs WHERE id = ?').get(running)).toMatchObject({ state: 'running', claimed_by: 'w#0' });
  });

  it('without a lane the order is as before: the oldest queued run, whoever\'s it is', () => {
    const db = openDb(file());
    const a1 = runs.enqueue(db, of('a'), 'a1', paid, T0);
    const a2 = runs.enqueue(db, of('a'), 'a2', paid, at(1));
    const b1 = runs.enqueue(db, of('b'), 'b1', paid, at(2));
    expect([0, 1, 2].map((n) => runs.claim(db, `w${n}`, at(3))?.id)).toEqual([a1, a2, b1]);
  });
});

describe('claim order: what a customer waits for is not queued behind batch preparation', () => {
  const own: RunInput = { ...prepare, ownerId: 'u1' };
  const auto = (db: ReturnType<typeof openDb>, n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => runs.enqueue(db, { ...prepare, templateId: `a${from + i}` }, `a${from + i}`, null, at(from + i)));
  /** One batch job taken at `s`, worked on until `s + 5` and finished: the batch is being worked through. */
  const work = (db: ReturnType<typeof openDb>, s: number, kinds?: readonly RunInput['kind'][]) => {
    const run = runs.claim(db, 'w', at(s), kinds)!;
    runs.beat(db, run.id, at(s + 5));
    runs.finish(db, run.id, { kind: 'prepare', state: 'ready', note: null }, at(s + 6));
    return run.id;
  };

  it('this morning: thirty batch preparations that have all waited past five minutes, a customer\'s new video goes next', () => {
    const db = openDb(file());
    const batch = auto(db, 30);
    work(db, 600); work(db, 610);                                                     // the batch is running: the oldest two are done
    const video = runs.enqueue(db, produce, 'video', paid, at(620));
    expect(runs.claim(db, 'w', at(625))?.id).toBe(video);
    expect(runs.claim(db, 'w', at(626))?.id).toBe(batch[2]);                          // and the batch goes on in its order
  });

  it('batch work is not starved: with a video always waiting, a batch job that has waited five minutes is taken once, and again only five minutes later', () => {
    const db = openDb(file());
    const [a1, a2] = auto(db, 2);
    const videos = Array.from({ length: 4 }, (_, i) => runs.enqueue(db, produce, `v${i}`, paid, at(390 + i)));
    expect(runs.claim(db, 'w', at(400))?.id).toBe(a1);                                // nothing of the batch has run for five minutes: its turn
    runs.beat(db, a1, at(410)); runs.finish(db, a1, { kind: 'prepare', state: 'ready', note: null }, at(411));
    expect(runs.claim(db, 'w', at(420))?.id).toBe(videos[0]);                         // its turn is over for a while: the customer's video
    runs.finish(db, videos[0]!, { kind: 'produce', variants: [] }, at(421));
    expect(runs.claim(db, 'w', at(430))?.id).toBe(videos[1]);
    runs.finish(db, videos[1]!, { kind: 'produce', variants: [] }, at(431));
    expect(runs.claim(db, 'w', at(411 + runs.FAIR_WAIT_MS / 1000 + 10))?.id).toBe(a2);   // five minutes after the batch last worked: its turn again
  });

  it('a customer\'s own video preparation goes before batch preparations too, and a scan\'s preparation (no owner) is the batch', () => {
    const db = openDb(file());
    const batch = auto(db, 5);
    work(db, 600);
    const mine = runs.enqueue(db, own, 'mine', null, at(610));
    expect(runs.claim(db, 'w', at(615))?.id).toBe(mine);
    expect(runs.claim(db, 'w', at(616))?.id).toBe(batch[1]);
  });

  it('a video still goes before a customer\'s preparation, until that preparation has waited five minutes', () => {
    const db = openDb(file());
    const mine = runs.enqueue(db, own, 'mine', null, T0);
    const video = runs.enqueue(db, produce, 'video', paid, at(100));
    expect(runs.claim(db, 'w1', at(200))?.id).toBe(video);
    runs.finish(db, video, { kind: 'produce', variants: [] }, at(201));
    const later = runs.enqueue(db, produce, 'video2', paid, at(250));
    expect(runs.claim(db, 'w2', at(301))?.id).toBe(mine);                             // waited five minutes: not pushed back again
    expect(runs.claim(db, 'w3', at(302))?.id).toBe(later);
  });

  it('a held run is not taken, whoever\'s it is', () => {
    const db = openDb(file());
    const held = runs.enqueue(db, produce, 'held', paid, T0);
    db.prepare(`UPDATE runs SET state = 'held' WHERE id = ?`).run(held);
    const [a] = auto(db, 1, 1);
    expect(runs.claim(db, 'w', at(600))?.id).toBe(a);
  });

  it('a lane that takes preparation, scan and edit alone orders them the same way: the customer\'s preparation before the batch', () => {
    const db = openDb(file());
    const lane = ['prepare', 'scan', 'edit'] as const;
    auto(db, 5);
    work(db, 600, lane);
    const mine = runs.enqueue(db, own, 'mine', null, at(610));
    expect(runs.claim(db, 'w#1', at(615), lane)?.id).toBe(mine);
  });
});
