// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../ports';
import { closeSqliteEngines, ORPHAN_AGE_MS, settleOrphans, sqliteEngine } from './sqlite-engine';
import { card, jobRecord, makeDataDir, PAID, putTemplate, viraleditorJson } from './testing';

let dir: string;
let db: DatabaseSync;
const engine = () => sqliteEngine(dir);
const runs = () => db.prepare('SELECT * FROM runs ORDER BY created_at, id').all() as Record<string, string | null>[];
const one = (sql: string, ...args: string[]) => db.prepare(sql).get(...args) as Record<string, string | number | null>;

beforeEach(() => {
  ({ dir, db } = makeDataDir());
});
afterEach(() => {
  closeSqliteEngines();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The clock of the site moves on by `minutes` (a held run is an orphan only when it is older than `ORPHAN_AGE_MS`). */
function later(minutes: number): void {
  if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.now() + minutes * 60_000));
}

/** The pid of a process that has ended. */
const deadPid = (): number => Number(execFileSync('node', ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }));

/** A stored upload of `userId`, as `diskUploads.save` leaves it. */
function upload(userId: string): string {
  const id = crypto.randomUUID();
  mkdirSync(join(dir, 'uploads', id), { recursive: true });
  writeFileSync(join(dir, 'uploads', id, 'uploader'), userId);
  writeFileSync(join(dir, 'uploads', id, '1.png'), 'png');
  return `uploads/${id}/1.png`;
}

/** What the worker writes when it stops a run. */
function stopRun(jobId: string, reason: string, missing: object | null, steps: object[] = []): void {
  db.prepare(`UPDATE runs SET state = 'stopped', reason = ?, missing = ?, steps = ? WHERE ref = ?`)
    .run(reason, missing ? JSON.stringify(missing) : null, JSON.stringify(steps), jobId);
}

describe('templates: rows → the site', () => {
  it('exposes cached shot counts only for published sources or the matching owner', () => {
    putTemplate(db, { owner: 'u-1' });
    db.prepare('UPDATE templates SET source_url = ?').run('https://www.instagram.com/reel/known');
    expect(engine().sourceInfo?.('u-1', 'https://www.instagram.com/reel/known')).toEqual({ ok: true, seconds: 8, format: 'no-talking', shots: 1 });
    expect(engine().sourceInfo?.('u-2', 'https://www.instagram.com/reel/known')).toBeNull();
    expect(engine().sourceInfo?.('u-1', 'https://www.instagram.com/reel/unknown')).toBeNull();
  });
  it('canonical Reel metadata is local and owner scoped, unknown stays null', () => {
    putTemplate(db, { owner: 'u-1' });
    db.prepare('UPDATE templates SET source_url = ?').run('https://www.instagram.com/reel/CODE/?utm=x');
    const known = engine().sourceInfo!('u-1', 'https://instagram.com/reels/CODE/');
    expect(known).toMatchObject({ ok: true, shots: 1 });
    expect(engine().sourceInfo!('u-1', 'https://www.instagram.com/reel/CODE/?utm=y')).toEqual(known);
    expect(engine().sourceInfo!('u-2', 'https://instagram.com/reels/CODE/')).toBeNull();
    expect(engine().sourceInfo!('u-1', 'https://instagram.com/reel/unknown/')).toBeNull();
  });

  it('reads the reference like rate from local prepared metrics and preserves unknown as null', () => {
    putTemplate(db);
    mkdirSync(join(dir, 'templates', 't1'), { recursive: true });
    writeFileSync(join(dir, 'templates', 't1', 'template.json'), JSON.stringify({ source: { metrics: { views: 1900000, likes: 191900 } } }));
    expect(engine().template('t1')?.referenceLikes).toBe('10.1%');
    writeFileSync(join(dir, 'templates', 't1', 'template.json'), JSON.stringify({ source: { metrics: { views: 0, likes: 0 } } }));
    expect(engine().template('t1')?.referenceLikes).toBeNull();
  });

  it('maps each state: published, hidden, ready → waiting, an owner → private with its preparation', () => {
    putTemplate(db, { id: 'pub', state: 'published' });
    putTemplate(db, { id: 'hid', state: 'hidden' });
    putTemplate(db, { id: 'wait', state: 'ready' });
    putTemplate(db, { id: 'cat-prep', state: 'preparing', note: 'unit-taken', estimate: null });
    putTemplate(db, { id: 'own-prep', state: 'preparing', owner: 'u-1', note: 'unit-taken', estimate: null });
    putTemplate(db, { id: 'own-ready', state: 'ready', owner: 'u-1' });
    putTemplate(db, { id: 'own-failed', state: 'failed', owner: 'u-1', note: 'split-screen', estimate: null });
    putTemplate(db, { id: 'own-odd', state: 'failed', owner: 'u-1', note: 'engine-error', estimate: null });
    const by = Object.fromEntries(engine().templates().map((t) => [t.id, [t.status, t.preparation, t.preparationNote]]));
    expect(by).toEqual({
      pub: ['published', null, null], hid: ['hidden', null, null], wait: ['waiting', null, null], 'cat-prep': ['waiting', 'preparing', null],
      'own-prep': ['private', 'preparing', null], 'own-ready': ['private', 'ready', null], 'own-failed': ['private', 'failed', 'split-screen'],
      'own-odd': ['private', 'failed', null],
    });
  });

  it('reads the card: media paths under /media, an absent poster as "", the source kind', () => {
    putTemplate(db, { id: 'a', state: 'published', sourceKind: 'topads', timesGenerated: 4 });
    putTemplate(db, { id: 'b', state: 'published', sourceKind: 'seed', card: card({ image: null, video: null }) });
    const a = engine().template('a')!;
    expect(a).toMatchObject({
      title: 'Layering recipe', category: 'Fragrance', format: 'no-talking', seconds: 8, referenceViews: '1.2M', products: 1,
      image: '/media/templates/t1/poster.jpg', video: '/media/templates/t1/sample.mp4', source: 'topads', timesGenerated: 4,
      ownerId: null, description: 'Two sentences.', tags: ['oil'], editedAt: '2026-10-04T10:00:00.000Z',
    });
    expect(a.shots).toEqual(card().shots);
    expect(engine().template('b')).toMatchObject({ image: '', video: null, source: 'link' });
    expect(engine().template('nope')).toBeNull();
  });

  it('a row with broken JSON is skipped and logged, the others are still read', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    putTemplate(db, { id: 'good', state: 'published' });
    putTemplate(db, { id: 'broken', state: 'published', card: '{"title": "half' });
    putTemplate(db, { id: 'no-shots', state: 'published', card: '{"title": "x"}' });
    expect(engine().templates().map((t) => t.id)).toEqual(['good']);
    expect(engine().template('broken')).toBeNull();
    expect(log.mock.calls.flat().join('\n')).toMatch(/template-row-unreadable: broken/);
    expect(log.mock.calls.flat().join('\n')).toMatch(/template-row-unreadable: no-shots/);
    expect(log.mock.calls.flat().join('\n')).not.toContain('half');        // no text of the row in the log
    const count = log.mock.calls.length;
    engine().templates();
    expect(log.mock.calls.length).toBe(count);                             // once per row and process
  });

  it('updateTemplate: a status is the row state (waiting → ready); card fields are written and an edit run takes them over', () => {
    putTemplate(db, { id: 't1', state: 'ready' });
    expect(engine().updateTemplate('t1', { status: 'published' }).status).toBe('published');
    expect(one('SELECT state FROM templates WHERE id = ?', 't1').state).toBe('published');
    expect(runs()).toEqual([]);
    const edited = engine().updateTemplate('t1', { title: 'New title', tags: ['a'] });
    expect(edited).toMatchObject({ title: 'New title', tags: ['a'], status: 'published' });
    const [edit] = runs();
    expect(edit).toMatchObject({ kind: 'edit', ref: 't1', state: 'queued' });
    expect(JSON.parse(edit!.input!)).toEqual({
      kind: 'edit', templateId: 't1',
      card: { title: 'New title', category: 'Fragrance', products: 1, shots: card().shots, description: 'Two sentences.', tags: ['a'] },
    });
    expect(engine().updateTemplate('t1', { status: 'waiting' }).status).toBe('waiting');
    putTemplate(db, { id: 'prep', state: 'preparing', estimate: null });
    expect(() => engine().updateTemplate('prep', { status: 'published' })).toThrow('template-not-ready');
    expect(() => engine().updateTemplate('nope', { title: 'x' })).toThrow(NotFoundError);
    putTemplate(db, { id: 'bare', state: 'ready', card: card({ image: null, video: null }) });
    expect(() => engine().updateTemplate('bare', { status: 'published' })).toThrow('template-no-sample');
    expect(one('SELECT state FROM templates WHERE id = ?', 'bare').state).toBe('ready');
  });

  it('addFromLink: a private preparing row and its prepare run, together; removeTemplate deletes the row', () => {
    const made = engine().addFromLink('u-1', 'https://www.tiktok.com/@a/video/1');
    expect(made).toMatchObject({ status: 'private', ownerId: 'u-1', preparation: 'preparing', title: 'https://www.tiktok.com/@a/video/1', source: 'link' });
    expect(one('SELECT state, owner, source_kind, source_url FROM templates WHERE id = ?', made.id))
      .toEqual({ state: 'preparing', owner: 'u-1', source_kind: 'link', source_url: 'https://www.tiktok.com/@a/video/1' });
    const [prepare] = runs();
    expect(prepare).toMatchObject({ kind: 'prepare', ref: made.id, state: 'held' });
    expect(JSON.parse(prepare!.input!)).toEqual({ kind: 'prepare', templateId: made.id, ownerId: 'u-1', from: { kind: 'link', url: 'https://www.tiktok.com/@a/video/1' } });
    engine().removeTemplate(made.id);
    expect(engine().template(made.id)).toBeNull();
    expect(() => engine().removeTemplate(made.id)).toThrow(NotFoundError);
  });
});

describe('what a job costs: the estimate the worker wrote', () => {
  it('paid and minutes are the row estimate and minutes times the variants; a template without an estimate is not ready', () => {
    putTemplate(db, { id: 't1' });
    expect(engine().paid('t1', 3)).toEqual({ images: 15, clips: 15, clipSeconds: 60, music: 3, voice: 0 });
    expect(engine().minutes('t1', 2)).toBe(14);
    putTemplate(db, { id: 'prep', state: 'preparing', estimate: null, minutes: null });
    expect(() => engine().paid('prep', 1)).toThrow('template-not-ready');
    expect(() => engine().paid('nope', 1)).toThrow(NotFoundError);
  });

  it('a template with shots that continue a clip: paid is the worker\'s own paidFor, not one image and one clip per shot', () => {
    // The worker's code computes everything here: the row as its seed writes it (estimate = paidFor(t, 1)), and paidFor(t, 2).
    const worker = viraleditorJson<{ card: unknown; estimate: typeof PAID; minutes: number; two: typeof PAID; shots: number }>(`
      import { goldenWithParts } from './src/produce/testing.ts';
      import { paidFor, minutesFor } from './src/template/estimate.ts';
      import { cardOf } from './src/template/card.ts';
      const { template } = goldenWithParts();
      console.log(JSON.stringify({ card: cardOf(template, { image: null, video: null }), estimate: paidFor(template, 1), minutes: minutesFor(template),
        two: paidFor(template, 2), shots: template.shots.length }));
    `);
    putTemplate(db, { id: 'parts', state: 'published', card: JSON.stringify(worker.card), estimate: worker.estimate, minutes: worker.minutes });
    expect(worker.shots).toBe(5);
    expect(worker.two.clips).toBe(6);                                     // three shots own a clip, two variants
    expect(engine().paid('parts', 2)).toEqual(worker.two);
    expect(engine().template('parts')!.shots).toHaveLength(5);
  });
});

describe('a job: start, committed, refresh, resume', () => {
  it('start hands over ONE held run with what was approved; the template counts it; committed() releases it', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    const image = upload('u-1');
    const job = jobRecord({}, { products: [{ name: 'Oil', description: 'Body oil', images: [image] }], variants: 1 });
    engine().start(job, PAID, false);
    const [run] = runs();
    expect(run).toMatchObject({ kind: 'produce', ref: job.id, state: 'held' });
    expect(JSON.parse(run!.approved!)).toEqual(PAID);
    expect(JSON.parse(run!.input!)).toEqual({
      kind: 'produce', templateId: 't1', ownerId: 'u-1', quality: 'fast', variants: 1, language: 'en', sample: false,
      products: [{ name: 'Oil', description: 'Body oil', images: [image] }],
    });
    expect(job.steps.find((step) => step.key === 'clips')).toEqual({ key: 'clips', status: 'waiting', done: 0, total: 5 });
    expect(one('SELECT times_generated FROM templates WHERE id = ?', 't1').times_generated).toBe(1);

    engine().start(job, PAID, false);                                      // the same job id again: still one run, counted once
    expect(runs()).toHaveLength(1);
    expect(one('SELECT times_generated FROM templates WHERE id = ?', 't1').times_generated).toBe(1);

    engine().committed();
    expect(runs()[0]!.state).toBe('queued');
  });

  it('committed() releases only the runs this process handed over', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    engine();                                                              // open first: a held run found at opening is an orphan
    db.prepare(`INSERT INTO runs (id, kind, ref, state, input, steps, created_at, updated_at) VALUES ('other', 'produce', 'job-x', 'held', '{}', '[]', 'a', 'a')`).run();
    const job = jobRecord();
    engine().start(job, PAID, false);
    engine().committed();
    expect(Object.fromEntries(runs().map((r) => [r.ref, r.state]))).toEqual({ 'job-x': 'held', [job.id]: 'queued' });
  });

  it('a sample is not counted; a photo that is not an upload of the job\'s owner makes no run', () => {
    putTemplate(db, { id: 't1', state: 'ready' });
    engine().start(jobRecord({ userId: 'admin-1' }), PAID, true);
    expect(JSON.parse(runs()[0]!.input!).sample).toBe(true);
    expect(one('SELECT times_generated FROM templates WHERE id = ?', 't1').times_generated).toBe(0);
    const theirs = upload('u-2');
    expect(() => engine().start(jobRecord({}, { products: [{ name: 'x', description: '', images: [theirs] }] }), PAID, false)).toThrow('upload-not-found');
    expect(() => engine().start(jobRecord({}, { products: [{ name: 'x', description: '', images: ['../../etc/passwd'] }] }), PAID, false)).toThrow('upload-not-found');
    expect(runs()).toHaveLength(1);
  });

  it('a template that is preparing, or unknown, takes no job', () => {
    putTemplate(db, { id: 'prep', state: 'preparing', estimate: null });
    expect(() => engine().start(jobRecord({ templateId: 'prep' }), PAID, false)).toThrow('template-not-ready');
    expect(() => engine().start(jobRecord({ templateId: 'nope' }), PAID, false)).toThrow(NotFoundError);
    expect(runs()).toEqual([]);
  });

  it('refresh: a running run is running with its steps; a done run gives its variants under /media', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    const job = jobRecord();
    engine().start(job, PAID, false);
    engine().committed();
    const steps = [{ key: 'adaptation', status: 'done', done: 1, total: 1 }, { key: 'images', status: 'running', done: 2, total: 5 }];
    db.prepare(`UPDATE runs SET state = 'running', steps = ? WHERE ref = ?`).run(JSON.stringify(steps), job.id);
    expect(engine().refresh(job)).toMatchObject({ status: 'running', steps });
    const runId = runs()[0]!.id!;
    const done = { kind: 'produce', variants: [{ video: `jobs/${runId}/v1/final.mp4`, image: `jobs/${runId}/v1/poster.jpg` }] };
    db.prepare(`UPDATE runs SET state = 'done', result = ?, updated_at = '2026-10-04T12:09:00.000Z' WHERE ref = ?`).run(JSON.stringify(done), job.id);
    expect(engine().refresh(job)).toMatchObject({
      status: 'done', finishedAt: '2026-10-04T12:09:00.000Z',
      variants: [{ id: `${job.id}-v1`, video: `/media/jobs/${runId}/v1/final.mp4`, image: `/media/jobs/${runId}/v1/poster.jpg` }],
    });
  });

  it('refresh of a stopped run: status, reason, missing; a run that delivered some variants is a done job (B2, D0 Ruling 9)', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    const job = jobRecord({}, { variants: 2 });
    engine().start(job, PAID, false);
    engine().committed();
    const missing = { images: 0, clips: 2, clipSeconds: 8, music: 0, voice: 0 };
    stopRun(job.id, 'clips-failed', missing, [{ key: 'clips', status: 'stopped', done: 3, total: 5 }]);
    db.prepare('UPDATE runs SET variants = ? WHERE ref = ?').run(JSON.stringify([
      { n: 1, status: 'done', video: 'jobs/r/v1/final.mp4', image: 'jobs/r/v1/poster.jpg', reason: null },
      { n: 2, status: 'stopped', video: null, image: null, reason: 'clips-failed' },
    ]), job.id);
    expect(engine().missing(job)).toEqual({ images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 });   // not stopped yet for the site
    expect(engine().refresh(job)).toMatchObject({
      status: 'done', stoppedReason: null, steps: [{ key: 'clips', status: 'stopped', done: 3, total: 5 }],
      variants: [{ id: `${job.id}-v1`, video: '/media/jobs/r/v1/final.mp4', status: 'done' }, { id: `${job.id}-v2`, status: 'stopped', reason: 'clips-failed' }],
    });
    expect(engine().refresh(job).status).toBe('done');                     // stays as it is

    const none = jobRecord();
    engine().start(none, PAID, false);
    engine().committed();
    stopRun(none.id, 'clips-failed', missing, [{ key: 'clips', status: 'stopped', done: 3, total: 5 }]);
    expect(engine().refresh(none)).toMatchObject({ status: 'stopped', stoppedReason: 'clips-failed', variants: [{ status: 'stopped', reason: 'clips-failed' }] });
    expect(engine().missing(none)).toEqual(missing);
    expect(engine().refresh(none).status).toBe('stopped');                 // stays as it is

    const odd = jobRecord();
    engine().start(odd, PAID, false);
    stopRun(odd.id, 'something-new', null);
    expect(engine().refresh(odd).stoppedReason).toBe('engine-error');
  });

  it('resume: approved + missing, held, the job running; committed() queues it; a run that is not stopped is not held', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    const job = jobRecord();
    engine().start(job, PAID, false);
    engine().committed();
    const missing = { images: 0, clips: 2, clipSeconds: 8, music: 0, voice: 0 };
    stopRun(job.id, 'clips-failed', missing, [{ key: 'clips', status: 'stopped', done: 3, total: 5 }]);
    engine().refresh(job);
    engine().resume(job, engine().missing(job));
    expect(job).toMatchObject({ status: 'running', stoppedReason: null, steps: [{ key: 'clips', status: 'waiting', done: 3, total: 5 }] });
    expect(runs()[0]).toMatchObject({ state: 'held', missing: JSON.stringify(missing) });
    expect(JSON.parse(runs()[0]!.approved!)).toEqual({ images: 5, clips: 7, clipSeconds: 28, music: 1, voice: 0 });
    engine().committed();
    expect(runs()[0]!.state).toBe('queued');
    expect(() => engine().resume(job, missing)).toThrow('engine-not-stopped');
    expect(runs()[0]!.state).toBe('queued');
  });
});

describe('orphans: held runs of a process that died before its store was saved', () => {
  it('a never-run start is removed (and not counted); a resume goes back to stopped without what it approved', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    const fresh = jobRecord();
    engine().start(fresh, PAID, false);
    const resumed = jobRecord();
    engine().start(resumed, PAID, false);
    engine().committed();
    const missing = { images: 0, clips: 2, clipSeconds: 8, music: 0, voice: 0 };
    stopRun(resumed.id, 'clips-failed', missing);
    db.prepare(`INSERT INTO operations (run_id, key, kind, state, created_at, updated_at) SELECT id, 'v1:clip:s1', 'clip', 'done', 'a', 'a' FROM runs WHERE ref = ?`).run(resumed.id);
    engine().refresh(resumed);
    const third = jobRecord();
    engine().start(third, PAID, false);                                    // held, never committed: the process "dies" now
    engine().resume(resumed, missing);
    expect(one('SELECT times_generated FROM templates WHERE id = ?', 't1').times_generated).toBe(3);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    later(10);
    closeSqliteEngines();
    engine();                                                              // a new process opens the database
    expect(runs().map((r) => r.ref).sort()).toEqual([fresh.id, resumed.id].sort());   // one millisecond may hold both: no order
    const back = runs().find((r) => r.ref === resumed.id)!;
    expect(back).toMatchObject({ state: 'stopped', reason: 'clips-failed' });
    expect(JSON.parse(back.approved!)).toEqual(PAID);
    expect(runs().find((r) => r.ref === fresh.id)!.state).toBe('queued');
    expect(one('SELECT times_generated FROM templates WHERE id = ?', 't1').times_generated).toBe(2);
  });
});

describe('orphans, with the site store in hand (the store was saved, committed() was not)', () => {
  /** What `site.json` holds of these jobs, as the site saved it. */
  const saved = (...jobs: { id: string; status: string; resumedAt?: string | null }[]) => writeFileSync(join(dir, 'site.json'), JSON.stringify({ jobs }));
  const restart = (minutes = 10) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    later(minutes);
    closeSqliteEngines();
    engine();
  };
  const row = (ref: string) => runs().find((r) => r.ref === ref)!;
  const missing = { images: 0, clips: 2, clipSeconds: 8, music: 0, voice: 0 };
  /** A started, released and stopped job, ready for a resume. */
  const stopped = (missingOf: object | null = missing, reason = 'clips-failed') => {
    putTemplate(db, { id: 't1', state: 'published' });
    const job = jobRecord();
    engine().start(job, PAID, false);
    engine().committed();
    stopRun(job.id, reason, missingOf);
    engine().refresh(job);
    return job;
  };

  it('a start whose job is in the saved store is released, not removed (committed() threw, then the process restarted)', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    const job = jobRecord();
    engine().start(job, PAID, false);
    saved({ id: job.id, status: 'running' });
    restart();
    expect(runs().map((r) => [r.ref, r.state])).toEqual([[job.id, 'queued']]);
    expect(one('SELECT times_generated FROM templates WHERE id = ?', 't1').times_generated).toBe(1);
  });

  it('a resume the store saved (job running, with this resume\'s mark) is released with what it approved; one it did not save goes back', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    const [kept, lost] = [jobRecord(), jobRecord()];
    for (const job of [kept, lost]) engine().start(job, PAID, false);
    engine().committed();
    for (const job of [kept, lost]) {
      stopRun(job.id, 'clips-failed', missing);
      engine().refresh(job);
      engine().resume(job, missing);                                       // held; committed() is never reached
    }
    expect(kept.resumedAt).not.toBeNull();                                 // the mark of the resume is in the job record
    saved({ id: kept.id, status: 'running', resumedAt: kept.resumedAt }, { id: lost.id, status: 'stopped' });
    restart();
    expect(row(kept.id).state).toBe('queued');
    expect(JSON.parse(row(kept.id).approved!)).toEqual({ images: 5, clips: 7, clipSeconds: 28, music: 1, voice: 0 });
    expect(row(lost.id).state).toBe('stopped');
    expect(JSON.parse(row(lost.id).approved!)).toEqual(PAID);
  });

  it('M1: a saved status "running" that is stale (the store never saved the stop nor this resume) does not release the resume', () => {
    const job = stopped();
    saved({ id: job.id, status: 'running' });                              // the save of the first run: no mark of this resume
    engine().resume(job, missing);                                         // charge in memory only; the process dies
    restart();
    expect(row(job.id).state).toBe('stopped');
    expect(JSON.parse(row(job.id).approved!)).toEqual(PAID);
  });

  it('M1: the mark of an earlier resume does not release a later one', () => {
    const job = stopped();
    engine().resume(job, missing);
    const first = job.resumedAt;
    engine().committed();
    later(1);
    stopRun(job.id, 'clips-failed', missing);
    engine().refresh(job);
    engine().resume(job, missing);                                         // the second resume: its save was lost
    expect(job.resumedAt).not.toBe(first);
    saved({ id: job.id, status: 'running', resumedAt: first });
    restart();
    expect(row(job.id).state).toBe('stopped');
  });

  it('M2: a resume of a run stopped with no `missing` (template-missing) is not taken for a start', () => {
    const job = stopped(null, 'template-missing');
    saved({ id: job.id, status: 'stopped' });                              // in the store since its start
    engine().resume(job, { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 });
    restart();
    expect(row(job.id).state).toBe('stopped');                             // not released: the resume was not saved
  });

  it('M2: and the same resume, saved with its mark, is released', () => {
    const job = stopped(null, 'template-missing');
    saved({ id: job.id, status: 'stopped' });
    engine().resume(job, { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 });
    saved({ id: job.id, status: 'running', resumedAt: job.resumedAt });
    restart();
    expect(row(job.id).state).toBe('queued');
  });

  it('refresh of a running job whose run is gone ends it: stopped, engine-error (never "running" forever)', () => {
    const job = jobRecord();
    expect(engine().refresh(job)).toMatchObject({ status: 'stopped', stoppedReason: 'engine-error' });
  });

  it('M3: a run row that cannot be read leaves the job as it is and logs once; when the worker finishes it, the job shows it', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    const job = jobRecord();
    engine().start(job, PAID, false);
    engine().committed();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.prepare(`UPDATE runs SET state = 'running', steps = '['`).run();   // unreadable
    expect(engine().refresh(job)).toMatchObject({ status: 'running', stoppedReason: null });
    expect(engine().refresh(job)).toMatchObject({ status: 'running' });
    expect(log.mock.calls.flat().filter((line) => String(line).startsWith('run-row-unreadable')).length).toBe(1);
    db.prepare(`UPDATE runs SET state = 'done', steps = '[]'`).run();
    expect(engine().refresh(job)).toMatchObject({ status: 'done' });
  });

  it('a corrupt runs row is skipped and logged: opening, scans and refresh still work', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.prepare(`INSERT INTO runs (id, kind, ref, state, input, missing, steps, created_at, updated_at) VALUES ('bad', 'produce', 'job-bad', 'held', '{', '{', '[]', 'a', 'a')`).run();
    db.prepare(`INSERT INTO runs (id, kind, ref, state, input, steps, created_at, updated_at) VALUES ('bad-scan', 'scan', 'scan-x', 'queued', '{', '[', 'a', 'a')`).run();
    expect(() => engine()).not.toThrow();
    expect(engine().scans()).toEqual([]);
    expect(engine().refresh(jobRecord({ id: 'job-bad' }))).toMatchObject({ status: 'running' });   // unreadable: left as it is
    expect(log.mock.calls.flat().join('\n')).toMatch(/run-row-unreadable: bad/);
  });
});

describe('I1: a second site process on the same data directory', () => {
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});
  const lock = () => join(dir, 'site.lock');

  it('settlement leaves a held run that is younger than the window (P1: another process is still handing it over)', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    quiet();
    const job = jobRecord();
    engine().start(job, PAID, false);                                      // A: held, site.json not written yet
    settleOrphans(db, new Map());                                          // B opens
    expect(runs().map((r) => r.state)).toEqual(['held']);
    expect(one('SELECT times_generated FROM templates WHERE id = ?', 't1').times_generated).toBe(1);
    writeFileSync(join(dir, 'site.json'), JSON.stringify({ jobs: [{ id: job.id, status: 'running' }] }));
    engine().committed();                                                  // A: release
    expect(engine().refresh(job)).toMatchObject({ status: 'running' });
    expect(runs().map((r) => r.state)).toEqual(['queued']);
  });

  it('P2: a resume in flight is not put back by a young settlement', () => {
    const job = jobRecord();
    putTemplate(db, { id: 't1', state: 'published' });
    engine().start(job, PAID, false);
    engine().committed();
    const missing = { images: 0, clips: 2, clipSeconds: 8, music: 0, voice: 0 };
    stopRun(job.id, 'clips-failed', missing);
    engine().refresh(job);
    engine().resume(job, missing);
    quiet();
    settleOrphans(db, new Map([[job.id, { status: 'stopped', resumedAt: null, variantRuns: {} }]]));
    engine().committed();
    expect(runs()[0]).toMatchObject({ state: 'queued' });
  });

  it('a held run older than the window is an orphan again', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    quiet();
    engine().start(jobRecord(), PAID, false);
    later(ORPHAN_AGE_MS / 60_000 + 1);
    settleOrphans(db, new Map());
    expect(runs()).toEqual([]);
  });

  it('refuses opening while another live process owns the store', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    quiet();
    engine().start(jobRecord(), PAID, false);
    closeSqliteEngines();
    writeFileSync(lock(), String(process.ppid));                           // a live process that is not this one
    later(10);
    expect(() => engine()).toThrow('site-not-started');
    expect(runs().map((r) => r.state)).toEqual(['held']);
    expect(readFileSync(lock(), 'utf8')).toBe(String(process.ppid));       // the other one's lock is left alone
    closeSqliteEngines();
    expect(existsSync(lock())).toBe(true);
  });

  it('a lock of a process that is gone is taken over, and given back at close', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    quiet();
    engine().start(jobRecord(), PAID, false);
    closeSqliteEngines();
    writeFileSync(lock(), String(deadPid()));
    later(10);
    engine();
    expect(runs()).toEqual([]);
    expect(readFileSync(lock(), 'utf8')).toBe(String(process.pid));
    closeSqliteEngines();
    expect(existsSync(lock())).toBe(false);
  });

  it('a run left held is settled later in a long-running process (refresh / health), not only at opening', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    quiet();
    engine().start(jobRecord(), PAID, false);
    closeSqliteEngines();
    engine();                                                              // the restart is within the window: nothing settled yet
    expect(runs().map((r) => r.state)).toEqual(['held']);
    later(10);
    engine().health();
    expect(runs()).toEqual([]);
  });

  it('a run this process handed over and has not released is never settled by it, however old', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    quiet();
    const job = jobRecord();
    engine().start(job, PAID, false);
    later(30);
    engine().health();
    engine().refresh(job);
    expect(runs().map((r) => r.state)).toEqual(['held']);
    engine().committed();
    expect(runs().map((r) => r.state)).toEqual(['queued']);
  });
});

describe('M4: site.json leftovers', () => {
  it('open removes `site.json.<pid>.tmp` of a pid that is gone, and keeps one of a live process', () => {
    const [gone, live] = [join(dir, `site.json.${deadPid()}.tmp`), join(dir, `site.json.${process.ppid}.tmp`)];
    writeFileSync(gone, '{');
    writeFileSync(live, '{');
    engine();
    expect([existsSync(gone), existsSync(live)]).toEqual([false, true]);
  });
});

describe('uploads kept by the engine', () => {
  it('at opening, a photo folder older than two days that no run names is removed; a used or recent one stays', () => {
    const old = upload('u-1'), used = upload('u-1'), fresh = upload('u-1');
    const folder = (stored: string) => join(dir, stored.split('/').slice(0, 2).join('/'));
    const past = new Date(Date.now() - 3 * 86_400_000);
    for (const stored of [old, used]) utimesSync(folder(stored), past, past);
    putTemplate(db, { id: 't1', state: 'published' });
    db.prepare(`INSERT INTO runs (id, kind, ref, state, input, steps, created_at, updated_at) VALUES ('r', 'produce', 'j', 'done', ?, '[]', 'a', 'a')`)
      .run(JSON.stringify({ kind: 'produce', templateId: 't1', products: [{ name: 'x', description: '', images: [used] }] }));
    engine();
    expect([old, used, fresh].map((stored) => existsSync(folder(stored)))).toEqual([false, true, true]);
  });

  it('a folder with the uploader marker but no photo is not an upload: start refuses it', () => {
    putTemplate(db, { id: 't1', state: 'published' });
    const stored = upload('u-1');
    rmSync(join(dir, stored));
    expect(() => engine().start(jobRecord({}, { products: [{ name: 'x', description: '', images: [stored] }] }), PAID, false)).toThrow('upload-not-found');
  });
});

describe('candidates, scans, settings, health', () => {
  const candidate = (id: string, state: string, score: number | null = null) => db.prepare(
    `INSERT INTO candidates (id, source, url, title, views, seconds, state, score, image, found_at, updated_at)
     VALUES (?, 'topads', ?, ?, 1234567, 12, ?, ?, NULL, '2026-10-04T09:00:00.000Z', 'a')`,
  ).run(id, `https://x/${id}`, `Title ${id}`, state, score);

  it('the inbox: found and scored candidates; reject; prepare (force) makes a preparing row and takes it out of the inbox', () => {
    candidate('c1', 'found');
    candidate('c2', 'scored', 81);
    candidate('c3', 'rejected');
    candidate('c4', 'prepared');
    expect(engine().candidates()).toEqual([
      { id: 'c1', title: 'Title c1', source: 'topads', referenceMetric: { kind: 'likes', count: 0 }, views: '1.2M', seconds: 12, score: 0, image: '', foundAt: '2026-10-04T09:00:00.000Z' },
      { id: 'c2', title: 'Title c2', source: 'topads', referenceMetric: { kind: 'likes', count: 0 }, views: '1.2M', seconds: 12, score: 81, image: '', foundAt: '2026-10-04T09:00:00.000Z' },
    ]);
    engine().rejectCandidate('c1');
    expect(one('SELECT state FROM candidates WHERE id = ?', 'c1').state).toBe('rejected');
    expect(() => engine().rejectCandidate('c1')).toThrow(NotFoundError);
    const made = engine().prepareCandidate('c2');
    expect(made).toMatchObject({ status: 'waiting', preparation: 'preparing', title: 'Title c2', ownerId: null, source: 'topads' });
    expect(JSON.parse(runs()[0]!.input!)).toEqual({ kind: 'prepare', templateId: made.id, ownerId: null, from: { kind: 'candidate', candidateId: 'c2', force: true } });
    expect(engine().candidates()).toEqual([]);
    expect(() => engine().prepareCandidate('c2')).toThrow(NotFoundError);
  });

  describe('addLinkCandidate: a link of the admin becomes a manual candidate', () => {
    const day = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const link = (n: number) => `https://www.youtube.com/shorts/vid${String(n).padStart(8, '0')}`;
    const caps = (dailyTemplates: number, dailyCandidates = 45) => db.prepare('INSERT OR REPLACE INTO settings (id, value) VALUES (1, ?)').run(JSON.stringify({ dailyTemplates, dailyCandidates }));
    const usage = (kind: 'score' | 'prepare', count: number) => db.prepare('INSERT OR REPLACE INTO usage (day, kind, count) VALUES (?, ?, ?)').run(day(), kind, count);

    it('adds a found manual candidate with the link as its title, and prepareCandidate takes it the way "Add to gallery" does', () => {
      const added = engine().addLinkCandidate(link(1));
      expect(added).toEqual({ status: 'added', id: expect.any(String) });
      const id = (added as { id: string }).id;
      expect(db.prepare('SELECT source, url, title, state, scan_id, score FROM candidates WHERE id = ?').get(id)).toEqual({ source: 'manual', url: link(1), title: link(1), state: 'found', scan_id: null, score: null });
      expect(engine().candidates().map((candidate) => candidate.id)).toEqual([id]);
      expect(runs()).toHaveLength(0);
      const made = engine().prepareCandidate(id);
      expect(made).toMatchObject({ status: 'waiting', preparation: 'preparing', ownerId: null });
      expect(JSON.parse(runs()[0]!.input!)).toEqual({ kind: 'prepare', templateId: made.id, ownerId: null, from: { kind: 'candidate', candidateId: id, force: true } });
    });

    it('the same video is there already: as a candidate (any state), by another link of it, or as a catalog template; a customer\'s private one does not count', () => {
      candidate('c1', 'rejected');
      db.prepare(`UPDATE candidates SET url = ? WHERE id = 'c1'`).run('https://youtu.be/vid00000001?si=track');
      expect(engine().addLinkCandidate(link(1))).toEqual({ status: 'exists' });
      putTemplate(db, { id: 'cat', state: 'published' });
      db.prepare(`UPDATE templates SET source_url = ? WHERE id = 'cat'`).run('https://www.youtube.com/watch?v=vid00000002&t=4');
      expect(engine().addLinkCandidate(link(2))).toEqual({ status: 'exists' });
      putTemplate(db, { id: 'own', owner: 'u-1' });
      db.prepare(`UPDATE templates SET source_url = ? WHERE id = 'own'`).run(link(3));
      expect(engine().addLinkCandidate(link(3))).toMatchObject({ status: 'added' });
      expect(engine().addLinkCandidate(link(3))).toEqual({ status: 'exists' });
    });

    it('refuses a link the catalog does not take', () => {
      expect(() => engine().addLinkCandidate('https://example.com/watch?v=abc')).toThrow('source-rejected:unsupported-site');
      expect(db.prepare('SELECT COUNT(*) AS n FROM candidates').get()).toEqual({ n: 0 });
    });

    it('the day\'s templates: what the worker took today and what is waiting for it count, and the rest is told "limit"', () => {
      caps(5);
      usage('prepare', 3);
      expect(engine().addLinkCandidate(link(1))).toMatchObject({ status: 'added' });
      engine().prepareCandidate((engine().candidates()[0]!).id);                  // one waits for the worker: 3 + 1 of 5
      expect(engine().addLinkCandidate(link(2))).toMatchObject({ status: 'added' });
      engine().prepareCandidate(engine().candidates()[0]!.id);                    // 3 + 2 of 5: full
      expect(engine().addLinkCandidate(link(3))).toEqual({ status: 'limit' });
      expect(db.prepare('SELECT COUNT(*) AS n FROM candidates').get()).toEqual({ n: 2 });
    });

    it('a waiting run whose template has taken its unit is not counted twice', () => {
      caps(2);
      const first = (engine().addLinkCandidate(link(1)) as { id: string }).id;
      const made = engine().prepareCandidate(first);
      db.prepare(`UPDATE templates SET note = 'unit-taken' WHERE id = ?`).run(made.id);
      usage('prepare', 1);                                                         // the worker took its unit: 1 used, the run still running
      expect(engine().addLinkCandidate(link(2))).toMatchObject({ status: 'added' });
    });

    it('a customer\'s own link waiting to be prepared does not use the catalog\'s day', () => {
      caps(1);
      engine().addFromLink('u-1', 'https://www.tiktok.com/@a/video/1');
      expect(engine().addLinkCandidate(link(1))).toMatchObject({ status: 'added' });
    });

    it('the day\'s candidates: those the scans sent to scoring and the manual ones of today count', () => {
      caps(100, 3);
      usage('score', 2);
      expect(engine().addLinkCandidate(link(1))).toMatchObject({ status: 'added' });
      expect(engine().addLinkCandidate(link(2))).toEqual({ status: 'limit' });
    });

    it('yesterday\'s use does not count today', () => {
      caps(1);
      db.prepare("INSERT INTO usage (day, kind, count) VALUES ('2020-01-01', 'prepare', 9)").run();
      expect(engine().addLinkCandidate(link(1))).toMatchObject({ status: 'added' });
    });
  });

  it('a scan row says how many candidates it sent on to scoring; a candidate carries the notes of its score, one per line', () => {
    candidate('c1', 'scored', 41);
    candidate('c2', 'scored', 30);
    db.prepare(`UPDATE candidates SET score_notes = ? WHERE id = 'c2'`).run('No product shown\nFace never appears');
    db.prepare(`INSERT INTO scans (id, source, started_at, checked, queued, status) VALUES ('s1', 'topads', '2026-10-04T09:00:00.000Z', 15, 9, 'done')`).run();
    expect(engine().scans()[0]).toMatchObject({ id: 's1', checked: 15, queued: 9 });
    const [c1, c2] = engine().candidates();
    expect(c1).not.toHaveProperty('scoreNotes');
    expect(c2?.scoreNotes).toEqual(['No product shown', 'Face never appears']);
  });

  it('runScan queues a manual scan with a ref of its own; while it waits or runs, that one is returned', () => {
    const first = engine().runScan();
    expect(first).toMatchObject({ source: 'topads', status: 'running', queued: 0 });
    expect(engine().runScan()).toEqual(first);
    expect(engine().scans()[0]!.startedAt).toBe(first.startedAt);
    expect(engine().scans()).toEqual([first]);
    // The worker begins it (scans row, id = ref) and ends it; the next manual scan gets another ref.
    db.prepare(`INSERT INTO scans (id, source, started_at, finished_at, checked, status) VALUES (?, 'topads', '2026-10-04T12:00:00.000Z', 'b', 9, 'done')`).run(first.id);
    db.prepare(`UPDATE runs SET state = 'done' WHERE ref = ?`).run(first.id);
    const second = engine().runScan();
    expect(second.id).not.toBe(first.id);
    expect(runs().map((r) => r.ref).sort()).toEqual([first.id, second.id].sort());
    expect(engine().scans().map((s) => [s.id, s.status, s.checked])).toEqual([[second.id, 'running', 0], [first.id, 'done', 9]]);
  });

  it('settings: the engine defaults; a save changes the given fields and keeps the worker\'s tiers', () => {
    expect(engine().settings()).toMatchObject({ scanTimes: ['09:00', '15:00', '21:00'], threshold: 70, providerAccount: '', sources: { topads: true, shorts: true }, perScan: 15 });
    const saved = engine().saveSettings({ threshold: 60, sources: { topads: false, shorts: true }, providerAccount: 'ops@x' });
    expect(saved).toMatchObject({ threshold: 60, sources: { topads: false, shorts: true }, providerAccount: 'ops@x', dailyCandidates: 45 });
    const stored = JSON.parse(one('SELECT value FROM settings WHERE id = 1').value as string);
    expect(stored).toMatchObject({ threshold: 60, tiers: { fast: { model: 'seedance-2-mini', resolution: '720p' } } });
  });

  it('health: no row → down; a fresh row → running; the provider as the worker says', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    expect(engine().health()).toEqual({ worker: 'down', lastSeen: null, provider: 'not-configured' });
    const write = (value: object) => db.prepare('INSERT INTO health (id, value) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value').run(JSON.stringify(value));
    write({ workerAt: '2026-10-04T11:59:40.000Z', provider: 'fake', renderer: 'ready', note: null });
    expect(engine().health()).toEqual({ worker: 'running', lastSeen: '2026-10-04T11:59:40.000Z', provider: 'fake' });
    write({ workerAt: '2026-10-04T11:50:00.000Z', provider: 'magnific', renderer: 'ready', note: 'MAGNIFIC_API_KEY is not set' });
    expect(engine().health()).toEqual({ worker: 'down', lastSeen: '2026-10-04T11:50:00.000Z', provider: 'not-configured' });
  });

  it('health: a provider on hold for its credits is configured and out of credits; a row without the field (an older worker) reads as before', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    const write = (value: object) => db.prepare('INSERT INTO health (id, value) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value').run(JSON.stringify(value));
    const row = { workerAt: '2026-10-04T11:59:40.000Z', provider: 'magnific', renderer: 'ready', note: null };
    const seen = { worker: 'running', lastSeen: '2026-10-04T11:59:40.000Z' };
    write({ ...row, noCredits: 'the provider has no credits left (refused run run-7 at 2026-10-04T11:58:00.000Z)' });
    expect(engine().health()).toEqual({ ...seen, provider: 'ready', outOfCredits: true });
    write({ ...row, noCredits: null });
    expect(engine().health()).toEqual({ ...seen, provider: 'ready' });
    write(row);   // written before the field existed
    expect(engine().health()).toEqual({ ...seen, provider: 'ready' });
    write({ ...row, noCredits: 7 });   // not the worker's: no warning is made up from it
    expect(engine().health()).toEqual({ ...seen, provider: 'ready' });
    // the key is missing AND the account is empty: both are said
    write({ ...row, note: 'MAGNIFIC_API_KEY is not set', noCredits: 'the provider has no credits left' });
    expect(engine().health()).toEqual({ ...seen, provider: 'not-configured', outOfCredits: true });
  });

  it('health: the person-swap provider is a field of its own, as the worker says it; it changes nothing of the product provider, and a row without it (an older worker) names none', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    const write = (value: object) => db.prepare('INSERT INTO health (id, value) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value').run(JSON.stringify(value));
    const row = { workerAt: '2026-10-04T11:59:40.000Z', provider: 'magnific', renderer: 'ready', note: null };
    const seen = { worker: 'running', lastSeen: '2026-10-04T11:59:40.000Z' };
    // the live worker today: it pays for products and has no person-swap provider. Products are ready, and no "not configured" of theirs is made of it
    write({ ...row, swap: 'not-configured' });
    expect(engine().health()).toEqual({ ...seen, provider: 'ready', swap: 'not-configured' });
    write({ ...row, swap: 'ready' });
    expect(engine().health()).toEqual({ ...seen, provider: 'ready', swap: 'ready' });
    write({ ...row, provider: 'fake', swap: 'fake' });
    expect(engine().health()).toEqual({ ...seen, provider: 'fake', swap: 'fake' });
    write({ ...row, note: 'MAGNIFIC_API_KEY is not set', swap: 'ready' });
    expect(engine().health()).toEqual({ ...seen, provider: 'not-configured', swap: 'ready' });
    for (const other of ['magnific', '', 7, null]) {   // not the worker's three words: nothing is made up from it
      write({ ...row, swap: other });
      expect(engine().health()).toEqual({ ...seen, provider: 'ready' });
    }
  });
});


it('an incomplete ready private row is failed so the catalog can return its charge', () => {
  putTemplate(db, { id: 'fragment', state: 'ready', owner: 'u-1', estimate: null, card: card({ seconds: 0, shots: [] }) });
  expect(engine().template('fragment')).toMatchObject({ preparation: 'failed', preparationNote: 'check-failed' });
});

it('Top Ads and Shorts metrics retain their own units and reference media paths', () => {
  putTemplate(db, { sourceKind: 'topads', card: card({ referenceMetric: { count: 155300, kind: 'likes' }, referenceImage: 'templates/t1/reference.jpg', referenceVideo: 'templates/t1/reference.mp4' }) });
  expect(engine().template('t1')).toMatchObject({ referenceMetric: { count: 155300, kind: 'likes' }, referenceImage: '/media/templates/t1/reference.jpg', referenceVideo: '/media/templates/t1/reference.mp4' });
  mkdirSync(join(dir, 'templates', 't1'), { recursive: true });
  writeFileSync(join(dir, 'templates', 't1', 'template.json'), JSON.stringify({ source: { metrics: { views: 0, likes: 155300 } } }));
  expect(engine().template('t1')?.referenceMetric).toEqual({ count: 155300, kind: 'likes' });
});
