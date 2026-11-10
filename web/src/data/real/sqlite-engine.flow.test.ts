// @vitest-environment node
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobRecord } from '../mock/store';
import { NotFoundError } from '../ports';
import { closeSqliteEngines, sqliteEngine } from './sqlite-engine';
import { card, jobRecord, makeDataDir, PAID, putTemplate } from './testing';

// The engine members of the launch-review flow contract (task D0) on the worker's database: variants (B2), the content rules (B12),
// closing (B17) and deleting (B18) a job, the sample's state (B11) and one sample at a time, an own video file (B6), `scan-failed`.

let dir: string;
let db: DatabaseSync;
const engine = () => sqliteEngine(dir);
const runs = () => db.prepare('SELECT * FROM runs ORDER BY created_at, id').all() as Record<string, string | null>[];
const one = (sql: string, ...args: string[]) => db.prepare(sql).get(...args) as Record<string, string | number | null>;
const PAID_ONE = PAID;
const PAID_TWO = { images: 10, clips: 10, clipSeconds: 40, music: 2, voice: 0 };
const T0 = '2026-10-04T12:00:00.000Z';

beforeEach(() => {
  ({ dir, db } = makeDataDir());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(T0));
});
afterEach(() => {
  closeSqliteEngines();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const tick = (seconds = 1) => vi.setSystemTime(new Date(Date.now() + seconds * 1000));

/** What the worker writes as a run goes on. */
function worker(ref: string, state: string, over: { reason?: string; missing?: object; variants?: object[]; result?: object; at?: string } = {}): void {
  db.prepare(`UPDATE runs SET state = ?, reason = ?, missing = ?, variants = ?, result = ?, updated_at = ? WHERE ref = ?`).run(
    state, over.reason ?? null, over.missing ? JSON.stringify(over.missing) : null, JSON.stringify(over.variants ?? []),
    over.result ? JSON.stringify(over.result) : null, over.at ?? new Date().toISOString(), ref,
  );
}
const doneVariant = (n: number, runId = 'r') => ({ n, status: 'done', video: `jobs/${runId}/v${n}/final.mp4`, image: `jobs/${runId}/v${n}/poster.jpg`, reason: null });
const stoppedVariant = (n: number, reason = 'clips-failed') => ({ n, status: 'stopped', video: null, image: null, reason });

/** A job started and released on template t1. */
function started(variants: 1 | 2 | 3 = 1, over: Partial<JobRecord> = {}): JobRecord {
  if (!one(`SELECT 1 AS x FROM templates WHERE id = 't1'`)) putTemplate(db, { id: 't1', state: 'published' });
  const job = jobRecord(over, { variants });
  engine().start(job, variants === 1 ? PAID_ONE : PAID_TWO, over.sample ?? false);
  engine().committed();
  return job;
}

/** A 2-variant job that delivered v1 and lost v2 (B2): `done` for the site. */
function partlyDone(): JobRecord {
  const job = started(2);
  worker(job.id, 'stopped', { reason: 'clips-failed', missing: { images: 0, clips: 2, clipSeconds: 8, music: 0, voice: 0 }, variants: [doneVariant(1), stoppedVariant(2)] });
  engine().refresh(job);
  return job;
}

describe('B2: refresh writes each variant\'s status and reason', () => {
  it('held → every variant waits; running → the worker\'s variants (running = generating); a variant the worker has not begun waits', () => {
    const job = started(2);
    expect(engine().refresh(job).variants).toEqual([
      { id: `${job.id}-v1`, image: '', video: null, status: 'waiting', reason: null },
      { id: `${job.id}-v2`, image: '', video: null, status: 'waiting', reason: null },
    ]);
    worker(job.id, 'running', { variants: [{ n: 1, status: 'running', video: null, image: null, reason: null }] });
    expect(engine().refresh(job).variants.map((v) => v.status)).toEqual(['generating', 'waiting']);
    worker(job.id, 'running', { variants: [doneVariant(1), { n: 2, status: 'running', video: null, image: null, reason: null }] });
    expect(engine().refresh(job).variants).toEqual([
      { id: `${job.id}-v1`, image: '/media/jobs/r/v1/poster.jpg', video: '/media/jobs/r/v1/final.mp4', status: 'done', reason: null },
      { id: `${job.id}-v2`, image: '', video: null, status: 'generating', reason: null },
    ]);
  });

  it('a run that stops after delivering some variants is a done job with the others stopped; no stop time, no stop reason', () => {
    const job = partlyDone();
    expect(job).toMatchObject({ status: 'done', stoppedReason: null, stoppedAt: null, finishedAt: T0 });
    expect(job.variants.map((v) => [v.status, v.reason, v.video])).toEqual([['done', null, '/media/jobs/r/v1/final.mp4'], ['stopped', 'clips-failed', null]]);
    expect(engine().missing(job)).toEqual({ images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 });   // nothing to resume: a done job
  });

  it('a run that stops with nothing delivered: the job stops, with the worker\'s stop time; every variant stopped with its reason', () => {
    const job = started(2);
    worker(job.id, 'stopped', { reason: 'clips-failed', missing: { images: 0, clips: 1, clipSeconds: 4, music: 0, voice: 0 }, at: '2026-10-04T12:07:00.000Z', variants: [stoppedVariant(1)] });
    tick(600);
    engine().refresh(job);
    expect(job).toMatchObject({ status: 'stopped', stoppedReason: 'clips-failed', stoppedAt: '2026-10-04T12:07:00.000Z' });
    expect(job.variants.map((v) => [v.status, v.reason])).toEqual([['stopped', 'clips-failed'], ['stopped', 'clips-failed']]);
  });

  it('B12: a run stopped for breaking the content rules reads `content-rule` (not engine-error)', () => {
    const job = started();
    worker(job.id, 'stopped', { reason: 'content-rule' });
    expect(engine().refresh(job)).toMatchObject({ status: 'stopped', stoppedReason: 'content-rule', stoppedAt: T0 });
  });

  it('a running job whose run is gone stops with engine-error, and the time it was seen', () => {
    const job = jobRecord();
    expect(engine().refresh(job)).toMatchObject({ status: 'stopped', stoppedReason: 'engine-error', stoppedAt: T0 });
  });
});

describe('B2: regenerateVariant, the money path of a start', () => {
  it('one held produce run for ONE variant with the approved price of one; the job is marked; committed() releases it; the template does not count it', () => {
    const job = partlyDone();
    const variantId = `${job.id}-v2`;
    tick();
    engine().regenerateVariant(job, variantId, PAID_ONE);
    const regen = runs().find((r) => r.ref !== job.id)!;
    expect(regen).toMatchObject({ kind: 'produce', state: 'held', ref: `${job.id}/${variantId}/${regen.id}` });
    expect(JSON.parse(regen.approved!)).toEqual(PAID_ONE);
    expect(JSON.parse(regen.input!)).toEqual({ kind: 'produce', templateId: 't1', ownerId: job.userId, quality: 'fast', variants: 1, language: 'en', products: [], sample: false });
    expect(job.variantRuns[variantId]).toBe(regen.updated_at);           // the mark the settlement looks for in the saved job
    expect(job.status).toBe('done');
    expect(job.variants.map((v) => v.status)).toEqual(['done', 'generating']);
    expect(one(`SELECT times_generated FROM templates WHERE id = 't1'`).times_generated).toBe(1);
    engine().committed();
    expect(runs().find((r) => r.id === regen.id)!.state).toBe('queued');
  });

  it('refresh of the done job follows the run: generating, then done with its own video; a stop puts the variant back to stopped', () => {
    const job = partlyDone();
    const variantId = `${job.id}-v2`;
    engine().regenerateVariant(job, variantId, PAID_ONE);
    engine().committed();
    const regen = runs().find((r) => r.ref !== job.id)!;
    worker(regen.ref!, 'running', { variants: [{ n: 1, status: 'running', video: null, image: null, reason: null }] });
    expect(engine().refresh(job).variants.map((v) => v.status)).toEqual(['done', 'generating']);
    worker(regen.ref!, 'done', { variants: [doneVariant(1, regen.id!)] });
    expect(engine().refresh(job)).toMatchObject({ status: 'done', finishedAt: T0 });
    expect(job.variants[1]).toEqual({ id: variantId, image: `/media/jobs/${regen.id}/v1/poster.jpg`, video: `/media/jobs/${regen.id}/v1/final.mp4`, status: 'done', reason: null });
    expect(job.variants[0]!.video).toBe('/media/jobs/r/v1/final.mp4');

    const other = partlyDone();
    engine().regenerateVariant(other, `${other.id}-v2`, PAID_ONE);
    engine().committed();
    const failed = runs().find((r) => r.ref!.startsWith(`${other.id}/`))!;
    worker(failed.ref!, 'stopped', { reason: 'images-failed', variants: [stoppedVariant(1, 'images-failed')] });
    expect(engine().refresh(other)).toMatchObject({ status: 'done' });
    expect(other.variants.map((v) => [v.status, v.reason])).toEqual([['done', null], ['stopped', 'images-failed']]);
  });

  it('refuses an unknown variant, a variant that is not stopped, and photos that are not the owner\'s; a second call while it runs makes no second run', () => {
    const job = partlyDone();
    expect(() => engine().regenerateVariant(job, 'nope', PAID_ONE)).toThrow(NotFoundError);
    expect(() => engine().regenerateVariant(job, `${job.id}-v1`, PAID_ONE)).toThrow('not-stopped');
    engine().regenerateVariant(job, `${job.id}-v2`, PAID_ONE);
    job.variants[1]!.status = 'stopped';                                   // a stale record: the engine still knows the run
    expect(() => engine().regenerateVariant(job, `${job.id}-v2`, PAID_ONE)).toThrow('not-stopped');
    expect(runs()).toHaveLength(2);

    const foreign = partlyDone();
    foreign.input.products = [{ name: 'Oil', description: 'x', images: ['uploads/0a0a0a0a-0000-4000-8000-000000000000/1.png'] }];
    expect(() => engine().regenerateVariant(foreign, `${foreign.id}-v2`, PAID_ONE)).toThrow('upload-not-found');
    expect(runs()).toHaveLength(3);
  });

  it('orphans: a regeneration the store saved with its mark is released; one it did not save is removed and counts nothing', () => {
    const [kept, lost] = [partlyDone(), partlyDone()];
    for (const job of [kept, lost]) engine().regenerateVariant(job, `${job.id}-v2`, PAID_ONE);   // held; the process dies before committed()
    const saved = [kept, lost].map((job) => ({ id: job.id, status: 'done', resumedAt: null, variantRuns: job === kept ? job.variantRuns : {} }));
    writeFileSync(join(dir, 'site.json'), JSON.stringify({ jobs: saved }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    tick(10 * 60);
    closeSqliteEngines();
    engine();
    expect(runs().find((r) => r.ref!.startsWith(`${kept.id}/`))!.state).toBe('queued');
    expect(runs().find((r) => r.ref!.startsWith(`${lost.id}/`))).toBeUndefined();
    expect(one(`SELECT times_generated FROM templates WHERE id = 't1'`).times_generated).toBe(2);
  });
});

describe('S9d: a regeneration the worker has begun is `generating` until it ends (C1, M2, M4, I2)', () => {
  /** A 2-variant job whose v2 is being generated again; returns the job and the regeneration's run. */
  function regenerating(): { job: JobRecord; variantId: string; regen: Record<string, string | null> } {
    const job = partlyDone();
    const variantId = `${job.id}-v2`;
    engine().regenerateVariant(job, variantId, PAID_ONE);
    engine().committed();
    return { job, variantId, regen: runs().find((r) => r.ref!.startsWith(`${job.id}/`))! };
  }

  it('C1: run `running` with no variant written yet, or its variant still `waiting`: the variant is generating, and the job keeps following until it is done', () => {
    for (const written of [[], [{ n: 1, status: 'waiting', video: null, image: null, reason: null }]]) {
      const { job, regen } = regenerating();
      worker(regen.ref!, 'running', { variants: written });
      expect(engine().refresh(job).variants.map((v) => v.status)).toEqual(['done', 'generating']);
      worker(regen.ref!, 'running', { variants: [{ n: 1, status: 'running', video: null, image: null, reason: null }] });
      expect(engine().refresh(job).variants.map((v) => v.status)).toEqual(['done', 'generating']);
      worker(regen.ref!, 'done', { variants: [doneVariant(1, regen.id!)] });
      expect(engine().refresh(job).variants.map((v) => v.status)).toEqual(['done', 'done']);
    }
  });

  it('C1: a regeneration that stops while its variant was still waiting puts the variant to stopped (the site then gives the price back)', () => {
    const { job, regen } = regenerating();
    worker(regen.ref!, 'running', { variants: [] });
    engine().refresh(job);
    worker(regen.ref!, 'stopped', { reason: 'images-failed', variants: [] });
    expect(engine().refresh(job).variants.map((v) => [v.status, v.reason])).toEqual([['done', null], ['stopped', 'images-failed']]);
  });

  it('M2: a generating variant whose run row does not exist stops with engine-error (as the main run does)', () => {
    const job = partlyDone();
    job.variants = job.variants.map((v, i) => (i === 1 ? { ...v, status: 'generating' as const, reason: null } : v));
    expect(engine().refresh(job).variants.map((v) => [v.status, v.reason])).toEqual([['done', null], ['stopped', 'engine-error']]);
  });

  it('M4: a variant the content rules stopped is not generated again: refused, nothing held', () => {
    const job = started(2);
    worker(job.id, 'stopped', { reason: 'content-rule', variants: [doneVariant(1), stoppedVariant(2, 'content-rule')] });
    engine().refresh(job);
    expect(job.variants[1]).toMatchObject({ status: 'stopped', reason: 'content-rule' });
    expect(() => engine().regenerateVariant(job, `${job.id}-v2`, PAID_ONE)).toThrow('not-resumable');
    expect(runs()).toHaveLength(1);
  });

  it('I2: a regeneration held by a process that died is settled by the refresh of its done job, with no other job running', () => {
    const { job, variantId } = (() => {
      const base = partlyDone();
      const id = `${base.id}-v2`;
      engine().regenerateVariant(base, id, PAID_ONE);                      // held; the process dies before committed()
      return { job: base, variantId: id };
    })();
    writeFileSync(join(dir, 'site.json'), JSON.stringify({ jobs: [{ id: job.id, status: 'done', resumedAt: null, variantRuns: job.variantRuns }] }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    closeSqliteEngines();
    tick(60);
    engine();                                                              // opens: the run is young, left alone
    expect(runs().find((r) => r.ref!.startsWith(`${job.id}/`))!.state).toBe('held');
    tick(30 * 60);
    expect(engine().refresh(job).variants[1]).toMatchObject({ id: variantId, status: 'generating' });
    expect(runs().find((r) => r.ref!.startsWith(`${job.id}/`))!.state).toBe('queued');
  });
});

describe('B17 / B18: close and deleteMedia never touch a run that is not finished', () => {
  const folder = (runId: string) => {
    mkdirSync(join(dir, 'jobs', runId, 'v1'), { recursive: true });
    writeFileSync(join(dir, 'jobs', runId, 'v1', 'final.mp4'), 'mp4');
    return join(dir, 'jobs', runId);
  };

  it('close: the stopped run\'s saved parts are deleted; the row becomes closed; a run that is held (a resume in flight) is left alone', () => {
    const job = started();
    worker(job.id, 'stopped', { reason: 'clips-failed', missing: { images: 0, clips: 1, clipSeconds: 4, music: 0, voice: 0 } });
    engine().refresh(job);
    const parts = folder(runs()[0]!.id!);
    engine().close(job);
    expect(existsSync(parts)).toBe(false);
    expect(runs()[0]!.state).toBe('closed');

    const inFlight = started();
    worker(inFlight.id, 'stopped', { reason: 'clips-failed', missing: { images: 0, clips: 1, clipSeconds: 4, music: 0, voice: 0 } });
    engine().refresh(inFlight);
    engine().resume(inFlight, engine().missing(inFlight));
    const kept = folder(runs().find((r) => r.ref === inFlight.id)!.id!);
    engine().close(inFlight);
    expect(existsSync(kept)).toBe(true);
    expect(runs().find((r) => r.ref === inFlight.id)!.state).toBe('held');
    engine().close(jobRecord({ status: 'stopped' }));                       // no run at all: nothing to do
  });

  it('M3: close never throws, whatever goes wrong (a database that cannot be written, a folder that cannot be removed)', () => {
    const job = started();
    worker(job.id, 'stopped', { reason: 'clips-failed', missing: { images: 0, clips: 1, clipSeconds: 4, music: 0, voice: 0 } });
    engine().refresh(job);
    const parts = folder(runs()[0]!.id!);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stale = engine();
    closeSqliteEngines();                                                    // the connection is closed under it
    expect(() => stale.close(job)).not.toThrow();
    expect(existsSync(parts)).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('engine-close-failed'));
  });

  it('deleteMedia: the videos and images of the job and of its regenerations go; with a regeneration still to finish it refuses and deletes nothing', () => {
    const job = partlyDone();
    tick();
    engine().regenerateVariant(job, `${job.id}-v2`, PAID_ONE);
    engine().committed();
    const main = folder(runs()[0]!.id!);
    const regen = runs().find((r) => r.ref !== job.id)!;
    const again = folder(regen.id!);
    expect(() => engine().deleteMedia(job)).toThrow('engine-run-active');
    expect([existsSync(main), existsSync(again)]).toEqual([true, true]);
    worker(regen.ref!, 'done', { variants: [doneVariant(1, regen.id!)] });
    engine().refresh(job);
    engine().deleteMedia(job);
    expect([existsSync(main), existsSync(again)]).toEqual([false, false]);
    expect(runs().map((r) => r.state)).toEqual(['stopped', 'done']);
  });
});

describe('B11: the sample of a template', () => {
  const shots = [{ n: 1, from: 0, to: 3, action: 'Hands open the box', text: 'new', product: 1 }];
  const sampleOf = (id = 't1') => engine().template(id)!.sample;

  it('no sample video → none; a sample video → current', () => {
    putTemplate(db, { id: 't1', state: 'ready' });
    putTemplate(db, { id: 'bare', state: 'ready', card: card({ video: null }) });
    expect([sampleOf('t1'), sampleOf('bare')]).toEqual(['current', 'none']);
    expect(Object.fromEntries(engine().templates().map((t) => [t.id, t.sample]))).toEqual({ t1: 'current', bare: 'none' });
  });

  it('new shots make a current sample outdated (a title does not); publishing an outdated sample is refused and changes nothing', () => {
    putTemplate(db, { id: 't1', state: 'ready' });
    engine().updateTemplate('t1', { title: 'Renamed' });
    expect(sampleOf()).toBe('current');
    expect(JSON.parse(runs()[0]!.input!)).not.toHaveProperty('shotsChanged');
    tick();
    engine().updateTemplate('t1', { shots: card().shots });                  // the same shots: no change
    expect(sampleOf()).toBe('current');
    tick();
    engine().updateTemplate('t1', { shots });
    expect(sampleOf()).toBe('outdated');
    expect(JSON.parse(runs()[2]!.input!)).toMatchObject({ kind: 'edit', shotsChanged: true });
    const before = runs().length;
    expect(() => engine().updateTemplate('t1', { status: 'published', title: 'Again' })).toThrow('sample-outdated');
    expect(engine().template('t1')).toMatchObject({ status: 'waiting', title: 'Renamed' });
    expect(runs()).toHaveLength(before);
  });

  it('new shots and publish in one call are refused; a published template keeps its status with an outdated sample', () => {
    putTemplate(db, { id: 't1', state: 'ready' });
    expect(() => engine().updateTemplate('t1', { status: 'published', shots })).toThrow('sample-outdated');
    expect(engine().template('t1')).toMatchObject({ status: 'waiting', sample: 'current' });
    putTemplate(db, { id: 'pub', state: 'published' });
    expect(engine().updateTemplate('pub', { shots, status: 'published' })).toMatchObject({ status: 'published', sample: 'outdated' });
  });

  it('a sample made after the edit was taken over makes it current again; an edit the worker refused changes nothing', () => {
    putTemplate(db, { id: 't1', state: 'ready' });
    engine().updateTemplate('t1', { shots });
    const edit = runs()[0]!;
    tick();
    worker(edit.ref!, 'done', { result: { kind: 'edit', ok: true, note: null } });
    expect(sampleOf()).toBe('outdated');
    tick();
    const sample = jobRecord({ sample: true });
    engine().start(sample, PAID_ONE, true);
    engine().committed();
    expect(sampleOf()).toBe('outdated');                                    // running: the old sample is still the one shown
    tick();
    worker(sample.id, 'done', { variants: [doneVariant(1)] });
    expect(sampleOf()).toBe('current');

    putTemplate(db, { id: 't2', state: 'ready' });
    engine().updateTemplate('t2', { shots });
    db.prepare(`UPDATE runs SET state = 'done', result = ? WHERE ref = 't2'`).run(JSON.stringify({ kind: 'edit', ok: false, note: 'check-failed' }));
    expect(sampleOf('t2')).toBe('current');
  });

  it('one sample at a time: a second sample run of the template is refused while one is held, queued or running', () => {
    putTemplate(db, { id: 't1', state: 'ready' });
    const first = jobRecord({ sample: true });
    engine().start(first, PAID_ONE, true);
    expect(() => engine().start(jobRecord({ sample: true }), PAID_ONE, true)).toThrow('sample-running');
    engine().start(first, PAID_ONE, true);                                  // the same job again: a no-op, not a refusal
    engine().start(jobRecord(), PAID_ONE, false);                           // a customer's job is not a sample
    engine().committed();
    worker(first.id, 'running');
    expect(() => engine().start(jobRecord({ sample: true }), PAID_ONE, true)).toThrow('sample-running');
    worker(first.id, 'done');
    engine().start(jobRecord({ sample: true }), PAID_ONE, true);
    expect(runs().filter((r) => JSON.parse(r.input!).sample === true)).toHaveLength(2);
  });
});

describe('B6, scans, settings', () => {
  it('addFromUpload refuses an unknown opaque id before any row or run is made', () => {
    expect(() => engine().addFromUpload('u-1', 'up-1')).toThrow('upload-not-found');
    expect(runs()).toEqual([]);
    expect(engine().templates()).toEqual([]);
  });

  it('a scan stopped with `scan-failed` reads as that code', () => {
    db.prepare(`INSERT INTO scans (id, source, started_at, status, reason) VALUES ('s1', 'topads', '2026-10-04T11:00:00.000Z', 'stopped', 'scan-failed')`).run();
    db.prepare(`INSERT INTO scans (id, source, started_at, status, reason) VALUES ('s2', 'topads', '2026-10-04T10:00:00.000Z', 'stopped', 'source-unavailable')`).run();
    expect(engine().scans().map((s) => s.reason)).toEqual(['scan-failed', 'source-unavailable']);
  });

  it('settings: all seven scan fields, from the engine\'s defaults', () => {
    expect(engine().settings()).toMatchObject({
      sources: { topads: true, shorts: true }, searches: [], secondsMin: 6, secondsMax: 35, shortsMinViews: 500000, topAdsCards: 30, perScan: 15,
    });
  });
});

it('persists sample freshness independently of edit-run retention and closes runs durably', () => {
  putTemplate(db);
  engine().updateTemplate('t1', { shots: [{ n: 1, from: 0, to: 3, action: 'new', text: '', product: 1 }] });
  db.prepare("DELETE FROM runs WHERE kind = 'edit'").run();
  expect(engine().template('t1')?.sample).toBe('outdated');
  const job = started(); worker(job.id, 'stopped');
  engine().close(job);
  expect(one('SELECT state FROM runs WHERE ref = ?', job.id)?.state).toBe('closed');
});
