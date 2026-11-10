import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeMedia } from '../adapters/fakes.ts';
import { openDb } from '../db/open.ts';
import * as candidates from '../db/candidates.ts';
import * as templates from '../db/templates.ts';
import { seed, formatReport } from './seed.ts';
import type { SeedSources } from './seed.ts';

const here = new URL('.', import.meta.url).pathname;
const GOLDEN = join(here, '..', 'resolve', 'golden');
const REAL_CANDIDATES = join(here, '..', '..', '..', 'references', '_candidates', '2026-10-03-secim');
const NOW = new Date('2026-10-04T10:00:00.000Z');

function put(file: string, text: string) { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); }

function candidateJson(over: Record<string, unknown> = {}) {
  return { rank: 1, url: 'https://www.tiktok.com/@a/video/111', creator: '@a', views: 1000, likes: 100, duration_s: 12, format: 'Storytime', hook: 'h', beats: ['0-3s one', { t: '3-6s', what: 'two' }], ...over };
}

function world() {
  const root = mkdtempSync(join(tmpdir(), 've-seed-'));
  const data = join(root, 'data');
  const productions = join(root, 'productions');
  const cands = join(root, 'cands');
  put(join(productions, 'layering-01', 'drafts', 'final-v2.mp4'), 'old');
  put(join(productions, 'layering-01', 'drafts', 'final-v10.mp4'), 'newest');
  put(join(productions, 'layering-01', 'drafts', 'yan-yana.mp4'), 'not final');
  // lashly-01 has no finished video on purpose
  put(join(cands, 'a', '1.json'), JSON.stringify(candidateJson()));
  put(join(cands, 'a', '2.json'), JSON.stringify(candidateJson({ url: 'https://www.tiktok.com/@b/video/222', beats: ['x'] })));
  put(join(cands, 'b', '3.json'), JSON.stringify(candidateJson({ url: 'https://www.tiktok.com/@c/video/333' })));
  const sources: SeedSources = { golden: GOLDEN, productions, candidates: cands };
  const db = openDb(join(root, 'db.sqlite'));
  const media = new FakeMedia({ stills: { queue: [true, true, true, true, true, true] }, writeFiles: true });
  const run = () => seed({ db, media, clock: { now: () => NOW }, dataDir: data }, sources);
  return { root, data, cands, db, media, run, sources };
}

describe('seed', () => {
  it('writes two ready templates with cards, estimates and files', async () => {
    const w = world();
    const r = await w.run();
    expect(r.templates.map((t) => [t.id, t.status])).toEqual([['lashly-01', 'written'], ['layering-01', 'written']]);
    const lay = templates.get(w.db, 'layering-01')!;
    expect(lay).toMatchObject({ state: 'ready', owner: null, sourceKind: 'seed' });
    expect(lay.card.title.length).toBeGreaterThan(0);
    expect(lay.card.shots.length).toBeGreaterThan(0);
    expect(lay.estimate?.clips).toBe(lay.card.shots.length);
    expect(lay.minutes).toBeGreaterThan(0);
    expect(lay.card).toMatchObject({ video: 'templates/layering-01/sample.mp4', image: 'templates/layering-01/poster.jpg' });
    expect(readFileSync(join(w.data, 'templates/layering-01/sample.mp4'), 'utf8')).toBe('newest');   // newest final, numerically
    expect(existsSync(join(w.data, 'templates/layering-01/poster.jpg'))).toBe(true);
    expect(JSON.parse(readFileSync(join(w.data, 'templates/layering-01/template.json'), 'utf8')).id).toBe('layering-01');
    expect(w.media.calls).toHaveLength(1);
  });

  it('a production without a finished video is still ready, without sample, and says so', async () => {
    const w = world();
    const r = await w.run();
    const fl = templates.get(w.db, 'lashly-01')!;
    expect(fl.state).toBe('ready');
    expect(fl.card).toMatchObject({ video: null, image: null });
    expect(existsSync(join(w.data, 'templates/lashly-01/sample.mp4'))).toBe(false);
    expect(r.notes.join('\n')).toMatch(/lashly-01.*no finished video/);
  });

  it('writes candidates as manual / found, beats as strings or objects', async () => {
    const w = world();
    const r = await w.run();
    expect(r.candidates.map((c) => c.status)).toEqual(['written', 'written', 'written']);
    const rows = candidates.list(w.db);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ source: 'manual', state: 'found', views: 1000, likes: 100, seconds: 12, scanId: null });
    expect(rows.every((c) => c.title.length > 0)).toBe(true);
  });

  it('a second run changes nothing', async () => {
    const w = world();
    await w.run();
    const before = JSON.stringify([templates.list(w.db), candidates.list(w.db)]);
    const r = await w.run();
    expect(r.templates.every((t) => t.status === 'unchanged')).toBe(true);
    expect(r.candidates.every((c) => c.status === 'unchanged')).toBe(true);
    expect(JSON.stringify([templates.list(w.db), candidates.list(w.db)])).toBe(before);
    expect(w.media.calls).toHaveLength(1);
  });

  it('skips a malformed candidate file and names it', async () => {
    const w = world();
    put(join(w.cands, 'c', 'no-url.json'), JSON.stringify({ ...candidateJson(), url: undefined }));
    put(join(w.cands, 'c', 'bad-beats.json'), JSON.stringify(candidateJson({ url: 'https://www.tiktok.com/@d/video/444', beats: 'nope' })));
    put(join(w.cands, 'c', 'broken.json'), '{ not json');
    const r = await w.run();
    const skipped = r.candidates.filter((c) => c.status === 'skipped');
    expect(skipped.map((c) => c.file).sort()).toEqual(['c/bad-beats.json', 'c/broken.json', 'c/no-url.json']);
    expect(skipped.every((c) => c.reason)).toBe(true);
    expect(candidates.list(w.db)).toHaveLength(3);
    const text = formatReport(r);
    expect(text).toContain('no-url.json');
    expect(JSON.parse(JSON.stringify(r)).candidates).toHaveLength(6);
  });
});

describe('seed repairs', () => {
  it('a: video appears after the first run: files and card follow, state and owner stay', async () => {
    const w = world();
    await w.run();
    w.db.prepare("UPDATE templates SET state = 'published', owner = 'u9', times_generated = 3 WHERE id = 'lashly-01'").run();
    put(join(w.sources.productions, 'lashly-01', 'drafts', 'final-v1.mp4'), 'fl');
    const r = await w.run();
    expect(r.templates.find((t) => t.id === 'lashly-01')!.status).toBe('written');
    expect(readFileSync(join(w.data, 'templates/lashly-01/sample.mp4'), 'utf8')).toBe('fl');
    expect(existsSync(join(w.data, 'templates/lashly-01/poster.jpg'))).toBe(true);
    const row = templates.get(w.db, 'lashly-01')!;
    expect(row.card).toMatchObject({ video: 'templates/lashly-01/sample.mp4', image: 'templates/lashly-01/poster.jpg' });
    expect(row).toMatchObject({ state: 'published', owner: 'u9', timesGenerated: 3 });
    expect((await w.run()).templates.every((t) => t.status === 'unchanged')).toBe(true);
  });

  it('b: a leftover sample.mp4.tmp from a crashed copy: whole sample, no temp files left', async () => {
    const w = world();
    const dir = join(w.data, 'templates/layering-01');
    put(join(dir, 'sample.mp4.tmp'), 'tru');
    await w.run();
    expect(readFileSync(join(dir, 'sample.mp4'), 'utf8')).toBe('newest');
    expect(existsSync(join(dir, 'sample.mp4.tmp'))).toBe(false);
    expect(existsSync(join(dir, 'poster.tmp.jpg'))).toBe(false);
    expect(templates.get(w.db, 'layering-01')!.card.video).toBe('templates/layering-01/sample.mp4');
  });

  it('c: a row whose card names a sample that is gone from disk: file back, card still names it', async () => {
    const w = world();
    await w.run();
    unlinkSync(join(w.data, 'templates/layering-01/sample.mp4'));
    expect(templates.get(w.db, 'layering-01')!.card.video).toBe('templates/layering-01/sample.mp4');
    await w.run();
    expect(readFileSync(join(w.data, 'templates/layering-01/sample.mp4'), 'utf8')).toBe('newest');
    expect(templates.get(w.db, 'layering-01')!.card.video).toBe('templates/layering-01/sample.mp4');
  });

  it('a production with clips and drafts but no final-vN.mp4 gets no sample', async () => {
    const w = world();
    put(join(w.sources.productions, 'lashly-01', 'drafts', 'test-hook.mp4'), 'draft');
    put(join(w.sources.productions, 'lashly-01', 'assets', 'clip.mp4'), 'clip');
    await w.run();
    expect(existsSync(join(w.data, 'templates/lashly-01/sample.mp4'))).toBe(false);
    expect(templates.get(w.db, 'lashly-01')!.card.video).toBeNull();
  });
});

describe.skipIf(!existsSync(REAL_CANDIDATES))('seed with the real candidate files', () => {
  it('ten candidates and two templates', async () => {
    const root = mkdtempSync(join(tmpdir(), 've-seed-real-'));
    const db = openDb(join(root, 'db.sqlite'));
    const empty = join(root, 'none');
    const r = await seed(
      { db, media: new FakeMedia({ stills: { queue: [true, true] }, writeFiles: true }), clock: { now: () => NOW }, dataDir: join(root, 'data') },
      { golden: GOLDEN, productions: empty, candidates: REAL_CANDIDATES },
    );
    expect(r.candidates.filter((c) => c.status === 'skipped')).toEqual([]);
    expect(candidates.list(db)).toHaveLength(10);
    expect(templates.list(db)).toHaveLength(2);
  });
});
