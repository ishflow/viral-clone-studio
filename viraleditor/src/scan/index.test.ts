import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { openDb } from '../db/open.ts';
import { enqueue, getRun } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import { list as listCandidates, upsert } from '../db/candidates.ts';
import { get as getScan } from '../db/scans.ts';
import { upsert as upsertTemplate } from '../db/templates.ts';
import type { Card, PrepareNote } from '../contracts.ts';
import { readSettings, writeSettings } from '../db/settings.ts';
import { FakeClock, FakeShorts, FakeTopAds } from '../adapters/fakes.ts';
import { scanHandler } from './index.ts';

const NOW = '2026-10-04T09:00:00.000Z';
const CARD: Card = { title: 't', category: '', format: 'no-talking', seconds: 0, referenceViews: '', image: null, video: null, products: 1, shots: [], description: '', tags: [] };
const mem = () => openDb(join(mkdtempSync(join(tmpdir(), 'vc-scan-')), 'db.sqlite'));
const ad = (n: number, o: Record<string, unknown> = {}) => ({ url: `https://t/${n}`, title: `ad ${n}`, likes: 100 + n, seconds: 15, video: `https://v/${n}.mp4`, ...o });
const short = (n: number, o: Record<string, unknown> = {}) => ({ url: `https://s/${n}`, title: `short ${n}`, views: 600000 + n, seconds: 20, ...o });

function setup(opts: { topAds?: FakeTopAds; shorts?: FakeShorts; settings?: Partial<ReturnType<typeof readSettings>> } = {}) {
  const db = mem();
  if (opts.settings) writeSettings(db, { ...readSettings(db), ...opts.settings });
  const clock = new FakeClock(NOW);
  const handler = scanHandler({ db, topAds: opts.topAds ?? new FakeTopAds([[]]), shorts: opts.shorts ?? new FakeShorts({ queue: [] }), clock });
  const run = (source: 'topads' | 'shorts', ref = `scan-${source}`): RunRow => {
    const id = enqueue(db, { kind: 'scan', source, trigger: 'manual' }, ref, null, clock.now());
    db.prepare("UPDATE runs SET state = 'running', claimed_by = 'w', heartbeat = ? WHERE id = ?").run(clock.now().toISOString(), id);   // the scan run itself, not an older queued prepare run
    return getRun(db, id)!;
  };
  return { db, clock, handler, run };
}
const prepareRuns = (db: ReturnType<typeof mem>) => (db.prepare("SELECT input FROM runs WHERE kind='prepare' ORDER BY created_at, rowid").all() as { input: string }[]).map((r) => JSON.parse(r.input));

describe('scanHandler', () => {
  it('records candidates found, writes checked, queues a prepare run (force false) for each, finishes done', async () => {
    const t = setup({ topAds: new FakeTopAds([[ad(1), ad(2), ad(3, { seconds: 90 })]]) });
    const r = t.run('topads');
    await t.handler(r);
    const cs = listCandidates(t.db);
    expect(cs.map((c) => c.url).sort()).toEqual(['https://t/1', 'https://t/2']);
    expect(cs[0]).toMatchObject({ state: 'found', source: 'topads', scanId: 'scan-topads' });
    expect(getScan(t.db, 'scan-topads')).toMatchObject({ status: 'done', checked: 3, reason: null });
    const ps = prepareRuns(t.db);
    expect(ps).toHaveLength(2);
    for (const p of ps) expect(p).toMatchObject({ kind: 'prepare', ownerId: null, from: { kind: 'candidate', force: false } });
    expect(new Set(ps.map((p) => p.from.candidateId))).toEqual(new Set(cs.map((c) => c.id)));
    expect(getRun(t.db, r.id)).toMatchObject({ state: 'done', result: { kind: 'scan', checked: 3 } });
  });

  it('the scans row counts what the scan sent on to scoring (queued): fresh candidates and re-queues, not what the daily cap held back', async () => {
    const t = setup({ topAds: new FakeTopAds([[ad(1), ad(2), ad(3), ad(4)]]), settings: { dailyCandidates: 3 } });
    await t.handler(t.run('topads'));
    expect(prepareRuns(t.db)).toHaveLength(3);
    expect(getScan(t.db, 'scan-topads')).toMatchObject({ checked: 4, queued: 3 });
    const again = setup({ topAds: new FakeTopAds([[ad(1)]]) });
    upsert(again.db, { id: 'old', scanId: null, source: 'topads', url: 'https://old/x', title: 'x', views: null, likes: 5, seconds: 15, state: 'found', score: null, scoreNotes: null, image: null }, again.clock.now());
    await again.handler(again.run('topads'));
    expect(getScan(again.db, 'scan-topads')?.queued).toBe(prepareRuns(again.db).length);       // the re-queue of an old candidate counts too
  });

  it('Top Ads asks for settings.topAdsCards cards; Shorts searches every query of the list', async () => {
    const topAds = new FakeTopAds([[]]);
    const shorts = new FakeShorts({ by: { 'a b': [short(1)], c: [short(2), short(1)] } });
    const t = setup({ topAds, shorts, settings: { searches: ['a b', 'c'], topAdsCards: 12 } });
    await t.handler(t.run('topads'));
    expect(topAds.calls).toEqual([{ limit: 12 }]);
    await t.handler(t.run('shorts'));
    expect(shorts.calls.map((c) => c.query)).toEqual(['a b', 'c']);
    expect(listCandidates(t.db).map((c) => c.url).sort()).toEqual(['https://s/1', 'https://s/2']);
    expect(getScan(t.db, 'scan-shorts')).toMatchObject({ status: 'done', checked: 2 });      // s/1 under both tags counts once
  });

  it('a URL already in candidates is not recorded or queued again', async () => {
    const t = setup({ topAds: new FakeTopAds([[ad(1), ad(2)]]) });
    upsert(t.db, { id: 'old', scanId: null, source: 'manual', url: 'https://t/1', title: 'x', views: null, likes: null, seconds: 10, state: 'rejected', score: null, scoreNotes: null, image: null }, t.clock.now());
    await t.handler(t.run('topads'));
    expect(listCandidates(t.db)).toHaveLength(2);
    expect(prepareRuns(t.db)).toHaveLength(1);
  });

  it('at most perScan pass', async () => {
    const t = setup({ topAds: new FakeTopAds([Array.from({ length: 25 }, (_, i) => ad(i + 1))]) });
    await t.handler(t.run('topads'));
    expect(listCandidates(t.db)).toHaveLength(15);
    expect(getScan(t.db, 'scan-topads')?.checked).toBe(25);
  });

  it('dailyCandidates reached: the rest are recorded as found without a run; the next day\'s scan queues them, oldest first', async () => {
    const t = setup({ topAds: new FakeTopAds([[ad(1), ad(2), ad(3), ad(4)], [], []]), settings: { dailyCandidates: 3 } });
    await t.handler(t.run('topads', 'a'));
    expect(listCandidates(t.db)).toHaveLength(4);
    expect(prepareRuns(t.db)).toHaveLength(3);
    expect(listCandidates(t.db, { state: 'found' })).toHaveLength(4);
    expect(getScan(t.db, 'a')?.status).toBe('done');
    await t.handler(t.run('topads', 'b'));                 // same day: the cap is used up
    expect(prepareRuns(t.db)).toHaveLength(3);
    t.clock.set('2026-10-05T09:00:00.000Z');               // next day
    await t.handler(t.run('topads', 'c'));
    const ps = prepareRuns(t.db);
    expect(ps).toHaveLength(4);
    const left = listCandidates(t.db).find((c) => c.url === 'https://t/1');   // the lowest-ranked card was the one left over
    expect(ps[3].from.candidateId).toBe(left?.id);
    await t.handler(t.run('topads', 'd'));                 // nothing is queued twice
    expect(prepareRuns(t.db)).toHaveLength(4);
  });

  it('one source throws: its scan is stopped + source-unavailable (run too), the other source still finishes done', async () => {
    const t = setup({ topAds: new FakeTopAds([new Error('page changed')]), shorts: new FakeShorts({ by: { q: [short(1)] } }), settings: { searches: ['q'] } });
    const bad = t.run('topads');
    await t.handler(bad);
    expect(getScan(t.db, 'scan-topads')).toMatchObject({ status: 'stopped', reason: 'source-unavailable', checked: 0 });
    expect(getRun(t.db, bad.id)).toMatchObject({ state: 'stopped', reason: 'source-unavailable' });
    await t.handler(t.run('shorts'));
    expect(getScan(t.db, 'scan-shorts')).toMatchObject({ status: 'done', checked: 1 });
    expect(listCandidates(t.db)).toHaveLength(1);
  });

  it('one source throws: the worker log names the source and says what the error said', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const t = setup({ topAds: new FakeTopAds([new Error('page changed')]) });
      await t.handler(t.run('topads'));
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0]!.join(' ')).toContain('topads');
      expect(logged.mock.calls[0]!.join(' ')).toContain('page changed');
    } finally { logged.mockRestore(); }
  });

  it('Shorts: hands minViews, the known URLs and perScan to the source', async () => {
    const shorts = new FakeShorts({ by: { q: [] } });
    const t = setup({ shorts, settings: { searches: ['q'], shortsMinViews: 123456, perScan: 7 } });
    upsert(t.db, { id: 'c1', scanId: null, source: 'shorts', url: 'https://s/known', title: 't', views: 1, likes: null, seconds: 10, state: 'found', score: null, scoreNotes: null, image: null }, t.clock.now());
    await t.handler(t.run('shorts'));
    expect(shorts.calls).toHaveLength(1);
    expect(shorts.calls[0]!.want).toEqual({ minViews: 123456, skip: new Set(['https://s/known']), limit: 7 });
  });

  // F8 (review C7b I1): the handler's own stop / finish are made as the worker the run was handed to; after another worker took the run over they change nothing
  it('a worker that lost its scan run does not stop it (source unavailable)', async () => {
    const t = setup({ topAds: new FakeTopAds([new Error('page changed')]) });
    const r = t.run('topads');
    t.db.prepare("UPDATE runs SET claimed_by = 'w2' WHERE id = ?").run(r.id);              // another worker holds it now
    await t.handler(r);
    expect(getRun(t.db, r.id)).toMatchObject({ state: 'running', claimedBy: 'w2', reason: null });
  });
  it('a worker that lost its scan run does not finish it', async () => {
    const t = setup({ topAds: new FakeTopAds([[ad(1)]]) });
    const r = t.run('topads');
    t.db.prepare("UPDATE runs SET claimed_by = 'w2' WHERE id = ?").run(r.id);
    await t.handler(r);
    expect(getRun(t.db, r.id)).toMatchObject({ state: 'running', claimedBy: 'w2', result: null });
  });

  it('Shorts: one query failing does not stop the scan; all failing does', async () => {
    const t = setup({ shorts: new FakeShorts({ by: { a: new Error('x'), b: [short(1)] } }), settings: { searches: ['a', 'b'] } });
    await t.handler(t.run('shorts', 's1'));
    expect(getScan(t.db, 's1')).toMatchObject({ status: 'done', checked: 1 });
    const t2 = setup({ shorts: new FakeShorts({ by: { a: new Error('x') } }), settings: { searches: ['a'] } });
    await t2.handler(t2.run('shorts', 's2'));
    expect(getScan(t2.db, 's2')).toMatchObject({ status: 'stopped', reason: 'source-unavailable' });
  });

  it('Shorts with an empty search list finishes done with nothing checked', async () => {
    const t = setup();
    const r = t.run('shorts');
    await t.handler(r);
    expect(getScan(t.db, 'scan-shorts')).toMatchObject({ status: 'done', checked: 0 });
    expect(getRun(t.db, r.id)?.state).toBe('done');
  });

  it('time comes from the injected clock', async () => {
    const t = setup({ topAds: new FakeTopAds([[ad(1)]]) });
    await t.handler(t.run('topads'));
    expect(getScan(t.db, 'scan-topads')?.startedAt).toBe(NOW);
    expect(listCandidates(t.db)[0]?.foundAt).toBe(NOW);
  });

  // ── queueing again ──
  const cand = (db: ReturnType<typeof mem>, id: string, state: 'found' | 'scored' | 'prepared', clock: FakeClock) =>
    upsert(db, { id, scanId: null, source: 'topads', url: `https://old/${id}`, title: id, views: null, likes: 5, seconds: 15, state, score: null, scoreNotes: null, image: null }, clock.now());
  // A prepare run of a candidate, in the state and with the stored result a prepare handler leaves.
  const prep = (db: ReturnType<typeof mem>, clock: FakeClock, candidateId: string, end: 'queued' | 'running' | 'engine-error' | 'daily-cap' | PrepareNote) => {
    clock.advance(1000);
    const id = enqueue(db, { kind: 'prepare', templateId: `tpl-${candidateId}-${clock.now().getTime()}`, ownerId: null, from: { kind: 'candidate', candidateId, force: false } }, `tpl-${candidateId}-${clock.now().getTime()}`, null, clock.now());
    if (end === 'running') db.prepare("UPDATE runs SET state = 'running' WHERE id = ?").run(id);
    if (end === 'engine-error') db.prepare("UPDATE runs SET state = 'stopped', reason = 'engine-error' WHERE id = ?").run(id);
    if (end !== 'queued' && end !== 'running' && end !== 'engine-error') {
      db.prepare("UPDATE runs SET state = 'done', result = ? WHERE id = ?").run(JSON.stringify({ kind: 'prepare', state: 'failed', note: end }), id);
    }
  };
  const queuedFor = (db: ReturnType<typeof mem>) => prepareRuns(db).map((p) => p.from.candidateId as string);

  it('a scored candidate whose newest prepare run ended daily-cap is queued by the next scan; below-threshold is not', async () => {
    const t = setup();
    cand(t.db, 'cap', 'scored', t.clock); prep(t.db, t.clock, 'cap', 'daily-cap');
    cand(t.db, 'low', 'scored', t.clock); prep(t.db, t.clock, 'low', 'below-threshold');
    cand(t.db, 'mix', 'scored', t.clock); prep(t.db, t.clock, 'mix', 'daily-cap'); prep(t.db, t.clock, 'mix', 'below-threshold');   // newest decides
    cand(t.db, 'done', 'prepared', t.clock); prep(t.db, t.clock, 'done', 'daily-cap');
    await t.handler(t.run('topads'));
    expect(queuedFor(t.db).filter((c) => c === 'cap')).toHaveLength(2);
    for (const [c, n] of [['low', 1], ['mix', 2], ['done', 1]] as const) expect(queuedFor(t.db).filter((x) => x === c)).toHaveLength(n);   // only the runs the test made
  });

  it('a scored candidate whose newest prepare run failed on the way (llm-invalid, engine-error, source-unavailable) is queued again, at most 3 failures (R2fix, C7b I3)', async () => {
    const t = setup();
    cand(t.db, 'llm', 'scored', t.clock); prep(t.db, t.clock, 'llm', 'llm-invalid');
    cand(t.db, 'err', 'scored', t.clock); prep(t.db, t.clock, 'err', 'engine-error');
    cand(t.db, 'src', 'scored', t.clock); prep(t.db, t.clock, 'src', 'source-unavailable');
    cand(t.db, 'cap', 'scored', t.clock); prep(t.db, t.clock, 'cap', 'daily-cap');
    cand(t.db, 'out', 'scored', t.clock);                                  // three failures in all: it stays scored, in the site's inbox
    prep(t.db, t.clock, 'out', 'llm-invalid'); prep(t.db, t.clock, 'out', 'daily-cap'); prep(t.db, t.clock, 'out', 'llm-invalid'); prep(t.db, t.clock, 'out', 'engine-error');
    cand(t.db, 'two', 'scored', t.clock);                                  // daily-cap runs do not count as failures
    prep(t.db, t.clock, 'two', 'llm-invalid'); prep(t.db, t.clock, 'two', 'daily-cap'); prep(t.db, t.clock, 'two', 'daily-cap'); prep(t.db, t.clock, 'two', 'engine-error');
    await t.handler(t.run('topads'));
    for (const [c, n] of [['llm', 2], ['err', 2], ['src', 2], ['cap', 2], ['out', 4], ['two', 5]] as const) expect(queuedFor(t.db).filter((x) => x === c), c).toHaveLength(n);
  });

  it('a candidate that failed for a reason of its own (check-failed, unsupported, below-threshold) is never queued again by a scan', async () => {
    const t = setup();
    for (const note of ['check-failed', 'unsupported', 'too-long', 'split-screen', 'below-threshold'] as const) {
      cand(t.db, note, 'scored', t.clock); prep(t.db, t.clock, note, note);
    }
    cand(t.db, 'mix', 'scored', t.clock); prep(t.db, t.clock, 'mix', 'llm-invalid'); prep(t.db, t.clock, 'mix', 'check-failed');   // newest decides
    await t.handler(t.run('topads'));
    for (const c of ['check-failed', 'unsupported', 'too-long', 'split-screen', 'below-threshold', 'mix']) expect(queuedFor(t.db).filter((x) => x === c), c).toHaveLength(c === 'mix' ? 2 : 1);   // only the runs the test made
  });

  it('a candidate that already has a template row (failed in the inbox) is not queued again: no second failed row', async () => {
    const t = setup();
    cand(t.db, 'row', 'scored', t.clock); prep(t.db, t.clock, 'row', 'llm-invalid');
    const first = prepareRuns(t.db)[0]!;
    upsertTemplate(t.db, { id: first.templateId, state: 'failed', owner: null, sourceKind: 'shorts', sourceUrl: 'https://old/row', note: 'llm-invalid', card: CARD, estimate: null, minutes: null }, t.clock.now());
    cand(t.db, 'none', 'scored', t.clock); prep(t.db, t.clock, 'none', 'llm-invalid');   // the same ending, but no row was made
    await t.handler(t.run('topads'));
    expect(queuedFor(t.db).filter((x) => x === 'row')).toHaveLength(1);
    expect(queuedFor(t.db).filter((x) => x === 'none')).toHaveLength(2);
  });

  it('a found candidate with one failed prepare run is queued again; with three it is not', async () => {
    const t = setup();
    cand(t.db, 'one', 'found', t.clock); prep(t.db, t.clock, 'one', 'engine-error');
    cand(t.db, 'three', 'found', t.clock);
    for (let i = 0; i < 3; i += 1) prep(t.db, t.clock, 'three', 'engine-error');
    await t.handler(t.run('topads'));
    expect(queuedFor(t.db).filter((c) => c === 'one')).toHaveLength(2);
    expect(queuedFor(t.db).filter((c) => c === 'three')).toHaveLength(3);
  });

  it('a candidate with a prepare run still queued or running is not queued twice', async () => {
    const t = setup();
    cand(t.db, 'q', 'found', t.clock); prep(t.db, t.clock, 'q', 'queued');
    cand(t.db, 'r', 'found', t.clock); prep(t.db, t.clock, 'r', 'running');
    cand(t.db, 's', 'scored', t.clock); prep(t.db, t.clock, 's', 'daily-cap'); prep(t.db, t.clock, 's', 'queued');
    await t.handler(t.run('topads'));
    expect(queuedFor(t.db).sort()).toEqual(['q', 'r', 's', 's']);
  });

  it('queueing again uses the same daily cap, oldest first, before the new cards', async () => {
    const t = setup({ topAds: new FakeTopAds([[ad(1)]]), settings: { dailyCandidates: 2 } });
    cand(t.db, 'a', 'found', t.clock);
    cand(t.db, 'b', 'found', t.clock);
    await t.handler(t.run('topads'));
    expect(queuedFor(t.db)).toEqual(['a', 'b']);
    expect(listCandidates(t.db).filter((c) => c.url === 'https://t/1')).toHaveLength(1);     // recorded, not queued
  });

  it('a second scan of the same source on the same day queues nothing twice and counts the cap across both', async () => {
    const t = setup({ topAds: new FakeTopAds([[ad(1), ad(2)], [ad(1), ad(2), ad(3), ad(4)]]), settings: { dailyCandidates: 3 } });
    await t.handler(t.run('topads', 'a'));
    await t.handler(t.run('topads', 'b'));
    const q = queuedFor(t.db);
    expect(q).toHaveLength(3);
    expect(new Set(q).size).toBe(3);
    expect((t.db.prepare("SELECT count FROM usage WHERE kind = 'score'").get() as { count: number }).count).toBe(3);
    expect(listCandidates(t.db)).toHaveLength(4);
  });

  it('a run taken over after a crash (handler called again for the same run): nothing is queued twice, usage is not counted twice', async () => {
    const t = setup({ topAds: new FakeTopAds([[ad(1), ad(2), ad(3)], [ad(1), ad(2), ad(3)]]) });
    const r = t.run('topads');
    await t.handler(r);
    // the crash left the run `running` with its work saved; one candidate had been saved but not queued
    t.db.prepare("UPDATE runs SET state = 'running', result = NULL WHERE id = ?").run(r.id);
    const lost = listCandidates(t.db)[0]!;
    t.db.prepare("DELETE FROM runs WHERE kind = 'prepare' AND json_extract(input, '$.from.candidateId') = ?").run(lost.id);
    t.db.prepare("UPDATE usage SET count = count - 1 WHERE kind = 'score'").run();
    await t.handler(getRun(t.db, r.id)!);
    const q = queuedFor(t.db);
    expect(q).toHaveLength(3);
    expect(new Set(q).size).toBe(3);
    expect((t.db.prepare("SELECT count FROM usage WHERE kind = 'score'").get() as { count: number }).count).toBe(3);
    expect(getScan(t.db, r.ref)).toMatchObject({ status: 'done' });
  });

  it('a card whose URL another writer recorded while the source was read is skipped, not the end of the scan (R2fix, C7b minor 2)', async () => {
    const t = setup();
    const topAds = { cards: async () => {
      upsert(t.db, { id: 'seed', scanId: null, source: 'manual', url: 'https://t/1', title: 'x', views: null, likes: null, seconds: 10, state: 'found', score: null, scoreNotes: null, image: null }, t.clock.now());
      return [ad(1), ad(2)];
    } };
    const handler = scanHandler({ db: t.db, topAds, shorts: new FakeShorts({ queue: [] }), clock: t.clock });
    const r = t.run('topads');
    await handler(r);
    expect(getRun(t.db, r.id)).toMatchObject({ state: 'done' });
    expect(getScan(t.db, r.ref)).toMatchObject({ status: 'done', checked: 2 });
    const cs = listCandidates(t.db);
    expect(cs.map((c) => c.url).sort()).toEqual(['https://t/1', 'https://t/2']);
    expect(queuedFor(t.db).sort()).toEqual([cs.find((c) => c.url === 'https://t/2')!.id, 'seed'].sort());   // the seed's own row is a found candidate like any other
  });

  it('Shorts: a video under two tags is fetched and counted once; a second spelling of a tag is not searched again (R2fix, C7b minor 3)', async () => {
    const shorts = new FakeShorts({ by: { a: [short(1), short(2)], b: [short(1), short(2)] } });
    const t = setup({ shorts, settings: { searches: ['a', '#A', 'b'] } });
    await t.handler(t.run('shorts'));
    expect(shorts.calls.map((c) => c.query)).toEqual(['a', 'b']);
    expect(shorts.calls[1]!.want?.skip).toEqual(new Set(['https://s/1', 'https://s/2']));
    expect(getScan(t.db, 'scan-shorts')).toMatchObject({ status: 'done', checked: 2 });
    expect(listCandidates(t.db)).toHaveLength(2);
  });

  it('Top Ads: the card\'s direct video file is kept with the candidate; a Short has none (R2fix, C7b I2)', async () => {
    const t = setup({ topAds: new FakeTopAds([[ad(1)]]), shorts: new FakeShorts({ by: { q: [short(1)] } }), settings: { searches: ['q'] } });
    await t.handler(t.run('topads'));
    await t.handler(t.run('shorts'));
    const byUrl = new Map(listCandidates(t.db).map((c) => [c.url, c]));
    expect(byUrl.get('https://t/1')).toMatchObject({ url: 'https://t/1', video: 'https://v/1.mp4' });
    expect(byUrl.get('https://s/1')).toMatchObject({ video: null });
  });

  it('an unexpected error ends the scan row stopped and still reaches the worker', async () => {
    const t = setup({ topAds: new FakeTopAds([[ad(1)]]) });
    const r = t.run('topads');
    t.db.exec("CREATE TRIGGER boom BEFORE INSERT ON candidates BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    await expect(t.handler(r)).rejects.toThrow('disk full');
    expect(getScan(t.db, r.ref)).toMatchObject({ status: 'stopped', reason: 'scan-failed' });
    expect(getScan(t.db, r.ref)?.finishedAt).not.toBeNull();
  });
});

it('internal scan DB failures report scan-failed, not source-unavailable', async () => {
  const t = setup({ topAds: new FakeTopAds([[ad(1)]]) });
  const r = t.run('topads');
  t.db.exec("CREATE TRIGGER break_checked BEFORE UPDATE OF checked ON scans BEGIN SELECT RAISE(ABORT, 'internal'); END");
  await expect(t.handler(r)).rejects.toThrow('internal');
  expect(getScan(t.db, r.ref)).toMatchObject({ status: 'stopped', reason: 'scan-failed' });
});

it('passes current saved Top Ads filters to the source on each scan', async () => {
  const t = setup({ settings: { topAdsIndustry: 'haircare', topAdsCountry: 'GB', topAdsPeriod: 30 } });
  const calls: unknown[] = [];
  const handler = scanHandler({ db: t.db, clock: t.clock, shorts: new FakeShorts({ queue: [] }), topAds: { cards: async (limit, filters) => { calls.push({ limit, filters }); return []; } } });
  await handler(t.run('topads'));
  expect(calls).toEqual([{ limit: 30, filters: expect.objectContaining({ topAdsIndustry: 'haircare', topAdsCountry: 'GB', topAdsPeriod: 30 }) }]);
  t.db.close();
});

it('a successful source with no matching industry finishes done with an explanatory note', async () => {
  const t = setup();
  const handler = scanHandler({ db: t.db, clock: t.clock, shorts: new FakeShorts({ queue: [] }), topAds: { cards: async () => Object.assign([], { inspected: 100, industryMatched: 0 }) } });
  const run = t.run('topads');
  await handler(run);
  expect(getScan(t.db, 'scan-topads')).toMatchObject({ status: 'done', checked: 100, reason: 'no-matching-industry', aboveThreshold: 0, prepared: 0 });
  expect(listCandidates(t.db)).toEqual([]);
  expect(getRun(t.db, run.id)?.state).toBe('done');
  t.db.close();
});
