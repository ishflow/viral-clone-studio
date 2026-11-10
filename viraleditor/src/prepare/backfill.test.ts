import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as templates from '../db/templates.ts';
import { cardOf } from '../template/card.ts';
import { minutesFor, paidFor } from '../template/estimate.ts';
import { backfillFrames, backfillMinutes, backfillReferences } from './backfill.ts';
import { golden, world } from './testing.ts';
import type { World } from './testing.ts';

it('fills old prepared reference media offline and is idempotent', async () => {
  const w = world(), template = golden('layering-01');
  templates.upsert(w.db, { id: 'old', state: 'published', owner: null, sourceKind: 'link', sourceUrl: '', note: null, card: cardOf(template, { image: null, video: null }), estimate: paidFor(template, 1), minutes: 4 }, w.clock.now());
  mkdirSync(join(w.dataDir, 'sources/old'), { recursive: true });
  mkdirSync(join(w.dataDir, 'templates/old'), { recursive: true });
  writeFileSync(join(w.dataDir, 'sources/old/meta.json'), JSON.stringify({ file: '../../downloaded.mp4' }));
  expect(await backfillReferences(w)).toEqual({ updated: ['old'], unavailable: [], failed: [] });
  expect(templates.get(w.db, 'old')?.card).toMatchObject({ image: null, video: null, referenceImage: 'templates/old/reference.jpg', referenceVideo: 'templates/old/reference.mp4' });
  expect(await backfillReferences(w)).toEqual({ updated: [], unavailable: [], failed: [] });
  expect(w.downloader.calls).toHaveLength(0);
  expect(w.llm.calls).toHaveLength(0);
});

it('a missing or retired source remains unavailable; incomplete ready rows are failed', async () => {
  const w = world(), template = golden('layering-01');
  mkdirSync(join(w.dataDir, 'templates'), { recursive: true });
  const base = { owner: null, sourceKind: 'link' as const, sourceUrl: '', note: null, card: cardOf(template, { image: null, video: null }), estimate: paidFor(template, 1), minutes: 4 };
  templates.upsert(w.db, { ...base, id: 'missing', state: 'published' }, w.clock.now());
  templates.upsert(w.db, { ...base, id: 'broken', state: 'ready', card: { ...base.card, seconds: 0, shots: [] } }, w.clock.now());
  expect(await backfillReferences(w)).toEqual({ updated: [], unavailable: ['missing'], failed: ['broken'] });
  expect(templates.get(w.db, 'broken')).toMatchObject({ state: 'failed', note: 'check-failed' });
});


it('does not follow a template-directory symlink even into the same data root', async () => {
  const w = world(), template = golden('layering-01');
  templates.upsert(w.db, { id: 'old', state: 'published', owner: null, sourceKind: 'link', sourceUrl: '', note: null, card: cardOf(template, { image: null, video: null }), estimate: paidFor(template, 1), minutes: 4 }, w.clock.now());
  mkdirSync(join(w.dataDir, 'sources/old'), { recursive: true });
  writeFileSync(join(w.dataDir, 'sources/old/meta.json'), JSON.stringify({ file: '../../downloaded.mp4' }));
  mkdirSync(join(w.dataDir, 'another-owner'), { recursive: true });
  symlinkSync(join(w.dataDir, 'another-owner'), join(w.dataDir, 'templates'));
  expect(await backfillReferences(w)).toEqual({ updated: [], unavailable: ['old'], failed: [] });
  expect(w.media.calls).toHaveLength(0);
});

it('recomputes the minutes of a ready template from its template.json, offline, once', () => {
  const w = world(), template = golden('layering-01');
  const base = { owner: null, sourceKind: 'link' as const, sourceUrl: '', note: null, card: cardOf(template, { image: null, video: null }), estimate: paidFor(template, 1), minutes: 5 };
  templates.upsert(w.db, { ...base, id: 'old', state: 'published' }, w.clock.now());
  templates.upsert(w.db, { ...base, id: 'right', state: 'ready', minutes: minutesFor(template) }, w.clock.now());
  templates.upsert(w.db, { ...base, id: 'nofile', state: 'ready' }, w.clock.now());
  for (const id of ['old', 'right']) {
    mkdirSync(join(w.dataDir, 'templates', id), { recursive: true });
    writeFileSync(join(w.dataDir, 'templates', id, 'template.json'), JSON.stringify(template));
  }
  expect(backfillMinutes(w)).toEqual({ updated: ['old'], unavailable: ['nofile'] });
  expect(templates.get(w.db, 'old')).toMatchObject({ minutes: minutesFor(template), estimate: paidFor(template, 1), state: 'published' });
  expect(templates.get(w.db, 'nofile')?.minutes).toBe(5);
  expect(backfillMinutes(w)).toEqual({ updated: [], unavailable: ['nofile'] });
  expect(w.llm.calls).toHaveLength(0);
});

it('does not read a template.json through a symlink out of the data root', () => {
  const w = world(), template = golden('layering-01');
  templates.upsert(w.db, { id: 'old', state: 'published', owner: null, sourceKind: 'link', sourceUrl: '', note: null, card: cardOf(template, { image: null, video: null }), estimate: paidFor(template, 1), minutes: 5 }, w.clock.now());
  mkdirSync(join(w.dataDir, 'another-owner'), { recursive: true });
  writeFileSync(join(w.dataDir, 'another-owner', 'template.json'), JSON.stringify(template));
  symlinkSync(join(w.dataDir, 'another-owner'), join(w.dataDir, 'templates'));
  expect(backfillMinutes(w)).toEqual({ updated: [], unavailable: ['old'] });
  expect(templates.get(w.db, 'old')?.minutes).toBe(5);
});

it('a dry run of the minutes says which template would change, from what to what, and writes nothing', () => {
  const w = world(), template = golden('layering-01'), lines: string[] = [];
  templates.upsert(w.db, { id: 'old', state: 'published', owner: null, sourceKind: 'link', sourceUrl: '', note: null, card: cardOf(template, { image: null, video: null }), estimate: paidFor(template, 1), minutes: 5 }, w.clock.now());
  mkdirSync(join(w.dataDir, 'templates/old'), { recursive: true });
  writeFileSync(join(w.dataDir, 'templates/old/template.json'), JSON.stringify(template));
  expect(backfillMinutes(w, { apply: false }, (line) => lines.push(line))).toEqual({ updated: ['old'], unavailable: [] });
  expect(lines).toEqual([`old: 5 -> ${minutesFor(template)} min`]);
  expect(templates.get(w.db, 'old')?.minutes).toBe(5);
});

describe('the backfill-minutes script', () => {
  const script = fileURLToPath(new URL('./backfill-minutes.ts', import.meta.url));
  const template = golden('layering-01');
  /** A data folder with one template whose stored minutes are old, one whose minutes are right, and a row in another table. */
  const stale = (): string => {
    const w = world();
    const base = { owner: null, sourceKind: 'link' as const, sourceUrl: '', note: null, card: cardOf(template, { image: null, video: null }), estimate: paidFor(template, 1), minutes: 5 };
    templates.upsert(w.db, { ...base, id: 'old', state: 'published' }, w.clock.now());
    templates.upsert(w.db, { ...base, id: 'right', state: 'ready', owner: 'user-1', minutes: minutesFor(template) }, w.clock.now());
    w.candidate();
    for (const id of ['old', 'right']) {
      mkdirSync(join(w.dataDir, 'templates', id), { recursive: true });
      writeFileSync(join(w.dataDir, 'templates', id, 'template.json'), JSON.stringify(template));
    }
    w.db.close();
    return w.dataDir;
  };
  /** Every row of every table, and the name of every file in the data folder but the database's own. */
  const everything = (dataDir: string): { rows: Record<string, Record<string, unknown>[]>; files: string[] } => {
    const db = new DatabaseSync(join(dataDir, 'db.sqlite'));
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
      const rows = Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY 1`).all().map((row) => ({ ...row }))]));
      return { rows, files: (readdirSync(dataDir, { recursive: true }) as string[]).filter((file) => !file.startsWith('db.sqlite')).sort() };
    } finally { db.close(); }
  };
  // No key and no setting but the data folder: whatever the script does, it does without a paid service.
  const run = (dataDir: string | null, ...args: string[]) => spawnSync(process.execPath, [script, ...args], { env: { PATH: process.env.PATH ?? '', ...(dataDir ? { VC_DATA_DIR: dataDir } : {}) }, encoding: 'utf8' });
  const reportOf = (stdout: string): unknown => JSON.parse(stdout.slice(stdout.indexOf('{')));

  it('without --apply it is a dry run: it names the template and its minutes, and the data folder is as before', () => {
    const dataDir = stale(), before = everything(dataDir);
    const out = run(dataDir);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain(`old: 5 -> ${minutesFor(template)} min`);
    expect(reportOf(out.stdout)).toEqual({ mode: 'dry-run', updated: ['old'], unavailable: [] });
    expect(everything(dataDir)).toEqual(before);
  });
  it('--apply writes the stored minutes and nothing else: every other column (the update date too), every other table and every file are as before', () => {
    const dataDir = stale(), before = everything(dataDir);
    const out = run(dataDir, '--apply');
    expect(out.status, out.stderr).toBe(0);
    expect(reportOf(out.stdout)).toEqual({ mode: 'apply', updated: ['old'], unavailable: [] });
    const want = structuredClone(before);
    want.rows.templates!.find((row) => row.id === 'old')!.minutes = minutesFor(template);
    expect(minutesFor(template)).not.toBe(5);
    expect(everything(dataDir)).toEqual(want);
    expect(reportOf(run(dataDir, '--apply').stdout)).toEqual({ mode: 'apply', updated: [], unavailable: [] });
  });
  it('stops with a clear error when VC_DATA_DIR is not given, and does not touch the repository data folder', () => {
    const out = run(null, '--apply');
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain('VC_DATA_DIR');
  });
});

describe('backfillFrames', () => {
  const kept = (w: World, id: string, owner: string | null, over: Partial<ReturnType<typeof cardOf>> = {}, state: 'ready' | 'published' | 'failed' = 'ready', reference = true) => {
    const template = golden('layering-01');
    templates.upsert(w.db, { id, state, owner, sourceKind: 'link', sourceUrl: '', note: null, card: { ...cardOf(template, { image: null, video: null }), ...over }, estimate: paidFor(template, 1), minutes: 4 }, w.clock.now());
    mkdirSync(join(w.dataDir, 'templates', id), { recursive: true });
    if (reference) writeFileSync(join(w.dataDir, 'templates', id, 'reference.mp4'), 'the reference');
  };
  const stills = (w: World) => w.media.calls.filter((call) => call.kind === 'still').length;

  it('a dry run says what it would do and writes nothing, not a row and not a file', async () => {
    const w = world();
    kept(w, 'mine', 'user-1');
    const before = JSON.stringify(templates.get(w.db, 'mine'));
    expect(await backfillFrames(w, { apply: false })).toEqual({ updated: ['mine'], unavailable: [], covers: 1, shots: 5 });
    expect(JSON.stringify(templates.get(w.db, 'mine'))).toBe(before);
    expect(stills(w)).toBe(0);
    expect(existsSync(join(w.dataDir, 'templates/mine/poster.jpg'))).toBe(false);
  });

  it('applying gives an own template its card image and every shot its frame, a catalog one the frames only, a failed one nothing', async () => {
    const w = world();
    kept(w, 'mine', 'user-1');
    kept(w, 'catalog', null, {}, 'published');
    kept(w, 'broken', 'user-1', {}, 'failed');
    expect(await backfillFrames(w, { apply: true })).toEqual({ updated: ['catalog', 'mine'], unavailable: [], covers: 1, shots: 10 });
    const mine = templates.get(w.db, 'mine')!, catalog = templates.get(w.db, 'catalog')!;
    expect(mine.card.image).toBe('templates/mine/poster.jpg');
    expect(mine.card.shots.map((shot) => shot.image)).toEqual(mine.card.shots.map((shot) => `templates/mine/shots/${shot.n}.jpg`));
    expect(catalog.card.image).toBeNull();
    expect(catalog.card.shots.every((shot) => shot.image === `templates/catalog/shots/${shot.n}.jpg`)).toBe(true);
    expect(templates.get(w.db, 'broken')!.card.shots.every((shot) => shot.image === undefined)).toBe(true);
    expect(mine).toMatchObject({ state: 'ready', owner: 'user-1', estimate: paidFor(golden('layering-01'), 1) });
    for (const file of [mine.card.image!, ...mine.card.shots.map((shot) => shot.image!)]) expect(existsSync(join(w.dataDir, file))).toBe(true);
    expect(w.llm.calls).toHaveLength(0);
    expect(w.downloader.calls).toHaveLength(0);
  });

  it('is idempotent: a second run finds nothing to do and takes no frame', async () => {
    const w = world();
    kept(w, 'mine', 'user-1');
    await backfillFrames(w, { apply: true });
    const taken = stills(w);
    expect(await backfillFrames(w, { apply: true })).toEqual({ updated: [], unavailable: [], covers: 0, shots: 0 });
    expect(stills(w)).toBe(taken);
  });

  it('never replaces the image a template has already (its sample\'s poster)', async () => {
    const w = world();
    kept(w, 'sampled', 'user-1', { image: 'templates/sampled/poster.jpg' });
    await backfillFrames(w, { apply: true });
    expect(templates.get(w.db, 'sampled')!.card.image).toBe('templates/sampled/poster.jpg');
    expect(existsSync(join(w.dataDir, 'templates/sampled/poster.jpg'))).toBe(false);
  });

  it('a template whose reference video is not on disk is unavailable and keeps its card', async () => {
    const w = world();
    kept(w, 'lost', 'user-1', {}, 'ready', false);
    expect(await backfillFrames(w, { apply: true })).toEqual({ updated: [], unavailable: ['lost'], covers: 0, shots: 0 });
    expect(templates.get(w.db, 'lost')!.card.image).toBeNull();
  });

  it('does not follow a template-directory symlink out of the data root', async () => {
    const w = world();
    kept(w, 'mine', 'user-1');
    mkdirSync(join(w.dataDir, 'another-owner'), { recursive: true });
    writeFileSync(join(w.dataDir, 'another-owner/reference.mp4'), 'x');
    symlinkSync(join(w.dataDir, 'another-owner'), join(w.dataDir, 'templates/mine-link'));
    templates.upsert(w.db, { ...templates.get(w.db, 'mine')!, id: 'mine-link' }, w.clock.now());
    expect(await backfillFrames(w, { apply: true })).toEqual({ updated: ['mine'], unavailable: ['mine-link'], covers: 1, shots: 5 });
    expect(templates.get(w.db, 'mine-link')!.card.image).toBeNull();
  });

  it('keeps the update date of every template it writes, so the gallery order and "added" dates stay', async () => {
    const w = world();
    kept(w, 'mine', 'user-1');
    const before = templates.get(w.db, 'mine')!.updatedAt;
    w.clock.advance(3 * 24 * 3600 * 1000);
    await backfillFrames(w, { apply: true });
    const after = templates.get(w.db, 'mine')!;
    expect(after.card.image).toBe('templates/mine/poster.jpg');
    expect(after.updatedAt).toBe(before);
  });

  it('takes a frame again for a shot that has none on its card even when an old file is on disk', async () => {
    const w = world();
    kept(w, 'mine', 'user-1');
    mkdirSync(join(w.dataDir, 'templates/mine/shots'), { recursive: true });
    writeFileSync(join(w.dataDir, 'templates/mine/shots/2.jpg'), 'a frame of the old second');
    await backfillFrames(w, { apply: true });
    expect(w.media.calls.filter((call) => call.kind === 'still' && call.to.endsWith('shots/2.jpg'))).toHaveLength(1);
  });

  it('does not write through a shots folder or a poster that is a symlink out of the data root', async () => {
    const w = world(), outside = mkdtempSync(join(tmpdir(), 'backfill-outside-'));
    kept(w, 'by-shots', 'user-1');
    kept(w, 'by-poster', 'user-1');
    symlinkSync(outside, join(w.dataDir, 'templates/by-shots/shots'));
    symlinkSync(join(outside, 'poster.jpg'), join(w.dataDir, 'templates/by-poster/poster.jpg'));
    const report = await backfillFrames(w, { apply: true });
    expect(report).toMatchObject({ updated: [], unavailable: ['by-poster', 'by-shots'], covers: 0, shots: 0 });
    expect(readdirSync(outside)).toEqual([]);
    expect(stills(w)).toBe(0);
  });

  it('says line by line which template gets a cover and how many frames, in a dry run too', async () => {
    const w = world(), lines: string[] = [];
    kept(w, 'mine', 'user-1');
    kept(w, 'catalog', null, {}, 'published');
    await backfillFrames(w, { apply: false }, (line) => lines.push(line));
    expect(lines).toEqual(['catalog: 5 frames', 'mine: cover + 5 frames']);
  });
});

it('the script stops with a clear error when VC_DATA_DIR is not given, and does not touch the repository data folder', () => {
  const { VC_DATA_DIR: _, ...env } = process.env;
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./backfill-frames.ts', import.meta.url))], { env, encoding: 'utf8' });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain('VC_DATA_DIR');
});
