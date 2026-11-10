// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '..';
import { resetStore, getStore } from '../mock/store';
import { addDemoCustomers } from '../mock/test-helpers';
import { closeSqliteEngines, sqliteEngine } from './sqlite-engine';
import { registeredVideo } from './video-test-fixture';
import { makeDataDir } from './testing';

let dir: string, db: DatabaseSync;
beforeEach(() => {
  ({ dir, db } = makeDataDir());
  vi.stubEnv('VC_ENGINE', 'sqlite'); vi.stubEnv('VC_DATA_DIR', dir);
  vi.stubEnv('VC_ADMIN_PASSWORD', 'test-only-password-123');
  resetStore(); addDemoCustomers();
});
afterEach(() => { closeSqliteEngines(); db.close(); vi.unstubAllEnvs(); resetStore(); vi.restoreAllMocks(); });
const runs = () => db.prepare('SELECT * FROM runs ORDER BY created_at, id').all() as { id: string; state: string; input: string; ref: string }[];
const link = (range?: { from: number; to: number }) => ({ kind: 'link' as const, url: 'https://youtu.be/long-video', ...(range ? { range } : {}) });
const file = (uploadId: string, range?: { from: number; to: number }) => ({
  kind: 'file' as const, uploadId, name: 'video.mp4', type: 'video/mp4', bytes: 1000, seconds: null, width: null, height: null, ...(range ? { range } : {}),
});

describe('a customer picks a part of a longer video', () => {
  it('a link with a range writes the range into the prepare run and charges the same one credit', async () => {
    const before = await data.ledger.balance('usr-demo');
    await data.catalog.prepareOwn('usr-demo', link({ from: 30, to: 80 }), 1, 'k1');
    expect(JSON.parse(runs()[0]!.input)).toMatchObject({ kind: 'prepare', from: { kind: 'link', url: 'https://youtu.be/long-video', range: { from: 30, to: 80 } } });
    expect(await data.ledger.balance('usr-demo')).toBe(before - 1);
  });

  it('a link without a range leaves the run input as it was (no range key)', async () => {
    await data.catalog.prepareOwn('usr-demo', link(), 1, 'k1');
    expect(JSON.parse(runs()[0]!.input).from).toEqual({ kind: 'link', url: 'https://youtu.be/long-video' });
  });

  it.each([
    ['longer than a minute', { from: 0, to: 61 }],
    ['empty', { from: 10, to: 10 }],
    ['backwards', { from: 40, to: 10 }],
    ['negative start', { from: -1, to: 20 }],
    ['shorter than 3 s', { from: 5, to: 7 }],
    ['not numbers', { from: Number.NaN, to: 20 }],
  ])('a range %s is refused: nothing is charged and no run opens', async (_name, range) => {
    const before = await data.ledger.balance('usr-demo');
    await expect(data.catalog.prepareOwn('usr-demo', link(range), 1, 'bad')).rejects.toThrow('source-rejected:range');
    expect(await data.ledger.balance('usr-demo')).toBe(before);
    expect(runs()).toHaveLength(0);
    expect(getStore().ownTemplates).toHaveLength(0);
  });

  it('a 150 s upload is accepted with a range and refused without one; the range goes into the run and the card shows the part', async () => {
    const id = registeredVideo(dir, 'usr-demo', 150);
    expect(await data.catalog.checkSource('usr-demo', file(id, { from: 30, to: 80 }))).toEqual({ ok: true, seconds: 150, format: null, shots: null, needsRange: true });
    expect(await data.catalog.checkSource('usr-demo', file(id))).toEqual({ ok: false, reason: 'length' });
    await expect(data.catalog.prepareOwn('usr-demo', file(id), 1, 'none')).rejects.toThrow('source-rejected:length');
    expect(runs()).toHaveLength(0);
    const made = await data.catalog.prepareOwn('usr-demo', file(id, { from: 30, to: 80 }), 1, 'ranged');
    expect(JSON.parse(runs()[0]!.input).from).toMatchObject({ kind: 'upload', uploadId: id, range: { from: 30, to: 80 } });
    expect(made.seconds).toBe(50);
  });

  it('an upload of 60 s or less needs no range and keeps its old check result', async () => {
    const id = registeredVideo(dir, 'usr-demo', 8);
    expect(await data.catalog.checkSource('usr-demo', file(id))).toEqual({ ok: true, seconds: 8, format: null, shots: null });
  });

  it('an upload longer than 5 minutes is refused as too long, with or without a range', async () => {
    const id = registeredVideo(dir, 'usr-demo', 301);
    expect(await data.catalog.checkSource('usr-demo', file(id, { from: 0, to: 30 }))).toEqual({ ok: false, reason: 'length' });
    expect(await data.catalog.checkSource('usr-demo', file(id))).toEqual({ ok: false, reason: 'length' });
  });

  it('a range that starts after the end of the upload is refused as a range', async () => {
    const id = registeredVideo(dir, 'usr-demo', 100);
    expect(await data.catalog.checkSource('usr-demo', file(id, { from: 100, to: 130 }))).toEqual({ ok: false, reason: 'range' });
    expect(await data.catalog.checkSource('usr-demo', file(id, { from: 50, to: 120 }))).toEqual({ ok: false, reason: 'range' });
  });

  it('a range that runs past the end of the upload by a fraction is cut to the end first: what is left must still be 3 s, or it is refused as a range and nothing is charged', async () => {
    const id = registeredVideo(dir, 'usr-demo', 61);
    const before = await data.ledger.balance('usr-demo');
    expect(await data.catalog.checkSource('usr-demo', file(id, { from: 58.4, to: 61.4 }))).toEqual({ ok: false, reason: 'range' });
    await expect(data.catalog.prepareOwn('usr-demo', file(id, { from: 58.4, to: 61.4 }), 1, 'short')).rejects.toThrow('source-rejected:range');
    expect(await data.ledger.balance('usr-demo')).toBe(before);
    expect(runs()).toHaveLength(0);
    expect(await data.catalog.checkSource('usr-demo', file(id, { from: 58, to: 61.4 }))).toMatchObject({ ok: true });
  });

  it('the same link with another range is another video for the free check; the same range finds the prepared one', async () => {
    const made = await data.catalog.prepareOwn('usr-demo', link({ from: 30, to: 80 }), 1, 'k1');
    db.prepare("UPDATE templates SET state = 'ready', card = json_set(card, '$.seconds', 50, '$.format', 'no-talking') WHERE id = ?").run(made.id);
    const engine = sqliteEngine(dir);
    expect(engine.sourceInfo!('usr-demo', 'https://youtu.be/long-video', { from: 30, to: 80 })).toMatchObject({ ok: true, seconds: 50 });
    expect(engine.sourceInfo!('usr-demo', 'https://youtu.be/long-video', { from: 0, to: 40 })).toBeNull();
    expect(engine.sourceInfo!('usr-demo', 'https://youtu.be/long-video')).toBeNull();
  });

  it('the catalog tells the part each preparation was given, and null for one given none', async () => {
    const ranged = await data.catalog.prepareOwn('usr-demo', link({ from: 30, to: 80 }), 1, 'k1');
    const whole = await data.catalog.prepareOwn('usr-demo', { kind: 'link', url: 'https://youtu.be/short-video' }, 1, 'k2');
    expect(await data.catalog.sourceParts([ranged.id, whole.id, 'no-such-template'])).toEqual(new Map([[ranged.id, { from: 30, to: 80 }], [whole.id, null], ['no-such-template', null]]));
  });

  it('when the worker ends the preparation with bad-range the credit comes back once, as for any failed preparation', async () => {
    const before = await data.ledger.balance('usr-demo');
    const made = await data.catalog.prepareOwn('usr-demo', link({ from: 30, to: 80 }), 1, 'k1');
    expect(await data.ledger.balance('usr-demo')).toBe(before - 1);
    db.prepare("UPDATE templates SET state = 'failed', note = 'bad-range' WHERE id = ?").run(made.id);
    const failed = await data.catalog.get(made.id, 'usr-demo');
    await data.catalog.get(made.id, 'usr-demo');
    expect(failed).toMatchObject({ preparation: 'failed', preparationNote: 'bad-range' });
    expect(await data.ledger.balance('usr-demo')).toBe(before);
    expect(getStore().ledger.filter(entry => entry.type === 'returned')).toHaveLength(1);
  });
});
