// @vitest-environment node
import { existsSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '..';
import { resetStore, getStore } from '../mock/store';
import { addDemoCustomers } from '../mock/test-helpers';
import { closeSqliteEngines, ORPHAN_AGE_MS, settleOrphans, sqliteEngine } from './sqlite-engine';
import { mediaFile, sweepMedia } from './media';
import { sweepUploads } from './uploads';
import { registeredVideo } from './video-test-fixture';
import { makeDataDir, viraleditorJson } from './testing';
let dir: string, db: DatabaseSync;
beforeEach(() => {
  ({ dir, db } = makeDataDir());
  vi.stubEnv('VC_ENGINE', 'sqlite'); vi.stubEnv('VC_DATA_DIR', dir);
  vi.stubEnv('VC_ADMIN_PASSWORD', 'test-only-password-123');
  resetStore(); addDemoCustomers();
});
afterEach(() => { closeSqliteEngines(); db.close(); vi.unstubAllEnvs(); resetStore(); vi.restoreAllMocks(); });
const runs = () => db.prepare('SELECT * FROM runs ORDER BY created_at, id').all() as { id: string; state: string; input: string; ref: string }[];
const sourceOf = (uploadId: string) => ({ kind: 'file' as const, uploadId, name: 'video.mp4', type: 'video/mp4', bytes: 1000, seconds: 8, width: 90, height: 160 });

describe('SQLite upload preparation transaction', () => {
  it('unnamed and old placeholder upload titles use a neutral filename in either interface language', () => {
    const id = registeredVideo(dir, 'usr-demo');
    const file = join(dir, 'uploads', id, 'video.json');
    const registry = JSON.parse(readFileSync(file, 'utf8')); delete registry.name;
    writeFileSync(file, JSON.stringify(registry));
    const made = sqliteEngine(dir).addFromUpload('usr-demo', id);
    expect(made.title).toBe('video.mp4');
    db.prepare("UPDATE templates SET card = json_set(card, '$.title', 'Uploaded video') WHERE id = ?").run(made.id);
    expect(sqliteEngine(dir).template(made.id)?.title).toBe('video.mp4');
  });

  it('free file check resolves owned registry facts and refuses unknown or foreign IDs without creating work', async () => {
    const id = registeredVideo(dir, 'usr-demo');
    const advisory = { ...sourceOf(id), seconds: null, width: null, height: null };
    expect(await data.catalog.checkSource('usr-demo', advisory)).toEqual({ ok: true, seconds: 8, format: null, shots: null });
    expect(await data.catalog.checkSource('usr-paying', advisory)).toEqual({ ok: false, reason: 'unreadable' });
    expect(await data.catalog.checkSource('usr-demo', { ...advisory, uploadId: crypto.randomUUID() })).toEqual({ ok: false, reason: 'unreadable' });
    expect(runs()).toHaveLength(0);
    expect(getStore().ownTemplates).toHaveLength(0);
  });

  it('refunds a failed own template before removal, once, and refuses to remove a preparing charge', async () => {
    const id = registeredVideo(dir, 'usr-demo');
    const initial = await data.ledger.balance('usr-demo');
    const made = await data.catalog.prepareOwn('usr-demo', sourceOf(id), 1, 'remove-own');
    await expect(data.catalog.remove(made.id, 'usr-paying')).rejects.toThrow('template');
    await expect(data.catalog.remove(made.id, 'usr-demo')).rejects.toThrow('template-in-use');
    expect(sqliteEngine(dir).template(made.id)?.preparation).toBe('preparing');
    expect(await data.ledger.balance('usr-demo')).toBe(initial - 1);
    db.prepare("UPDATE templates SET state = 'failed', note = 'source-unavailable' WHERE id = ?").run(made.id);
    const removal = vi.spyOn(sqliteEngine(dir), 'removeTemplate').mockImplementationOnce(() => {
      const saved = JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8'));
      expect(saved.ownTemplates.find((record: { templateId: string }) => record.templateId === made.id).returnedEntryId).not.toBeNull();
      throw new Error('simulated interruption before SQLite deletion');
    });
    await expect(data.catalog.remove(made.id, 'usr-demo')).rejects.toThrow('simulated interruption');
    removal.mockRestore();
    resetStore();
    expect(await data.ledger.balance('usr-demo')).toBe(initial);
    await data.catalog.remove(made.id, 'usr-demo');
    expect(sqliteEngine(dir).template(made.id)).toBeNull();
    expect(await data.ledger.balance('usr-demo')).toBe(initial);
    await expect(data.catalog.remove(made.id, 'usr-demo')).rejects.toThrow('template');
    await data.catalog.list({ viewerId: 'usr-demo' });
    expect(getStore().ownTemplates.filter(record => record.returnedEntryId)).toHaveLength(1);
    expect(getStore().ledger.filter(entry => entry.type === 'returned')).toHaveLength(1);
  });

  it('owns admission before charge, holds until durable, releases once per key and refunds refused preparation once', async () => {
    const id = registeredVideo(dir, 'usr-demo');
    const initial = await data.ledger.balance('usr-demo');
    await expect(data.catalog.prepareOwn('usr-paying', sourceOf(id), 1, 'bad-owner')).rejects.toThrow('source-rejected:unreadable');
    expect(runs()).toHaveLength(0);
    const made = await data.catalog.prepareOwn('usr-demo', sourceOf(id), 1, 'key');
    expect(runs()).toHaveLength(1); expect(runs()[0]?.state).toBe('queued');
    expect(await data.catalog.prepareOwn('usr-demo', sourceOf(id), 1, 'key')).toEqual(made);
    expect(await data.ledger.balance('usr-demo')).toBe(initial - 1);
    db.prepare("UPDATE templates SET state = 'failed', note = 'source-unavailable' WHERE id = ?").run(made.id);
    await data.catalog.get(made.id, 'usr-demo'); await data.catalog.get(made.id, 'usr-demo');
    expect(await data.ledger.balance('usr-demo')).toBe(initial);
    expect(getStore().ownTemplates.filter(record => record.returnedEntryId)).toHaveLength(1);
  });

  it('an uncharged prepare is never released; a saved charge survives a crash', () => {
    const id = registeredVideo(dir, 'usr-demo');
    const made = sqliteEngine(dir).addFromUpload('usr-demo', id);
    expect(runs()[0]?.state).toBe('held');
    sqliteEngine(dir).committed();
    expect(runs()[0]?.state).toBe('stopped');
    const paid = sqliteEngine(dir).addFromUpload('usr-demo', id);
    db.prepare('UPDATE runs SET updated_at = ? WHERE ref = ?').run(new Date(Date.now() - ORPHAN_AGE_MS - 1000).toISOString(), paid.id);
    settleOrphans(db, new Map(), new Set(), new Set(), new Map([[paid.id, 'usr-demo']]));
    expect(runs().find(run => run.ref === paid.id)?.state).toBe('queued');
    expect(sqliteEngine(dir).template(made.id)?.preparation).toBe('failed');
  });

  it('a real MP4 reaches a ready private template through the actual SQLite prepare handler without downloader use', async () => {
    const id = registeredVideo(dir, 'usr-demo', 8, 'ürün-denemesi.mp4');
    const made = await data.catalog.prepareOwn('usr-demo', sourceOf(id), 1, 'local');
    expect(made.title).toBe('ürün-denemesi.mp4');
    const result = viraleditorJson<{ state: string; downloads: number; owner: string; sourceKind: string; title: string }>(`
      import { openDb } from './src/db/open.ts';
      import { claim, getRun } from './src/db/runs.ts';
      import { prepareHandler } from './src/prepare/index.ts';
      import { world, golden } from './src/prepare/testing.ts';
      import { createMedia } from './src/adapters/media.ts';
      import { get } from './src/db/templates.ts';
      const w = world({ llm: [{ score: 82, notes: [], unsupported: null, mode: 'beats', brands: [] }, golden('layering-01')] });
      const db = openDb(${JSON.stringify(dir + '/db.sqlite')});
      const real = createMedia('ffmpeg', 'ffprobe');
      const media = Object.create(w.media); media.probe = real.probe.bind(real);
      const run = claim(db, 'upload-worker', w.clock.now());
      await prepareHandler({ ...w, db, dataDir: ${JSON.stringify(dir)}, media })(run);
      const row = get(db, ${JSON.stringify(made.id)});
      console.log(JSON.stringify({ state: row.state, owner: row.owner, sourceKind: row.sourceKind, title: row.card.title, downloads: w.downloader.calls.length }));
      db.close(); w.db.close();
    `);
    expect(result).toEqual({ state: 'ready', owner: 'usr-demo', sourceKind: 'upload', title: 'ürün-denemesi.mp4', downloads: 0 });
    expect(readFileSync(join(dir, 'sources', made.id, 'source.mp4')).subarray(4, 8).toString()).toBe('ftyp');
  });

  it('mutation of admitted bytes is refused by the worker before any model/transcriber request', async () => {
    const id = registeredVideo(dir, 'usr-demo');
    const made = await data.catalog.prepareOwn('usr-demo', sourceOf(id), 1, 'mutation');
    writeFileSync(join(dir, 'uploads', id, 'source.mp4'), '#EXTM3U');
    const result = viraleditorJson<{ state: string; calls: number }>(`
      import { openDb } from './src/db/open.ts'; import { claim } from './src/db/runs.ts';
      import { prepareHandler } from './src/prepare/index.ts'; import { world } from './src/prepare/testing.ts';
      import { get } from './src/db/templates.ts';
      const w = world(); const db = openDb(${JSON.stringify(dir + '/db.sqlite')});
      await prepareHandler({ ...w, db, dataDir: ${JSON.stringify(dir)} })(claim(db, 'upload-worker', w.clock.now()));
      console.log(JSON.stringify({ state: get(db, ${JSON.stringify(made.id)}).state, calls: w.llm.calls.length + w.transcriber.calls.length }));
      db.close(); w.db.close();
    `);
    expect(result).toEqual({ state: 'failed', calls: 0 });
  });
});

it('serves admitted video only to its owner and protects an active opaque-id lease from retirement', async () => {
  const id = registeredVideo(dir, 'usr-demo');
  const made = await data.catalog.prepareOwn('usr-demo', sourceOf(id), 1, 'lease');
  const path = ['uploads', id, 'source.mp4'];
  expect(mediaFile(path, await data.auth.getUser('usr-demo'))).not.toBeNull();
  expect(mediaFile(path, await data.auth.getUser('usr-paying'))).toBeNull();
  expect(mediaFile(path, null)).toBeNull();
  const folder = join(dir, 'uploads', id);
  const old = new Date(Date.now() - 3 * 86400000); utimesSync(folder, old, old);
  sweepUploads(dir, prefix => runs().some(run => run.input.includes(`"${prefix.split('/')[1]}"`)));
  expect(existsSync(folder)).toBe(true);
  const store = getStore(); store.users = store.users.filter(user => user.id !== 'usr-demo');
  expect(mediaFile(path, { id: 'usr-demo' } as never)).toBeNull();
  sweepMedia(dir, db); expect(existsSync(folder)).toBe(true);
  db.prepare("UPDATE runs SET state = 'done' WHERE ref = ?").run(made.id);
  sweepMedia(dir, db); expect(existsSync(folder)).toBe(false);
  expect(existsSync(join(dir, 'retired', 'uploads', id))).toBe(true);
});

it('retires completed prepare copies without deleting bytes, protecting active leases even for deleted accounts', async () => {
  const made = await data.catalog.prepareOwn('usr-demo', sourceOf(registeredVideo(dir, 'usr-demo')), 1, 'copy-retention');
  const run = runs().find(run => run.ref === made.id)!;
  const copy = join(dir, 'jobs', run.id, 'upload-attempts', 'lease', 'source.mp4');
  mkdirSync(join(copy, '..'), { recursive: true }); writeFileSync(copy, 'private copy');
  const legacy = join(dir, 'upload-attempts', 'legacy-copy');
  mkdirSync(legacy, { recursive: true }); writeFileSync(join(legacy, 'source.mp4'), 'legacy private bytes');
  const old = new Date(Date.now() - 3 * 86400000); utimesSync(legacy, old, old);
  const store = getStore(); store.users = store.users.filter(user => user.id !== 'usr-demo');
  sweepMedia(dir, db);
  expect(existsSync(copy)).toBe(true); expect(existsSync(legacy)).toBe(true);
  db.prepare("UPDATE runs SET state = 'stopped' WHERE id = ?").run(run.id);
  sweepMedia(dir, db);
  expect(existsSync(copy)).toBe(false); expect(existsSync(legacy)).toBe(false);
  expect(readFileSync(join(dir, 'retired', 'jobs', run.id, 'upload-attempts', 'lease', 'source.mp4'), 'utf8')).toBe('private copy');
  expect(readFileSync(join(dir, 'retired', 'upload-attempts', 'legacy-copy', 'source.mp4'), 'utf8')).toBe('legacy private bytes');
  expect(sweepMedia(dir, db)).toEqual({ moved: 0, failed: 0 });
});
