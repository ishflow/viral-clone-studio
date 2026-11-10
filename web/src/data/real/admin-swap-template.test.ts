// @vitest-environment node
import { rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '..';
import { getStore, resetStore } from '../mock/store';
import { addDemoCustomers } from '../mock/test-helpers';
import { closeSqliteEngines, sqliteEngine } from './sqlite-engine';
import { makeDataDir } from './testing';
import { registeredVideo } from './video-test-fixture';

// The video of a person swap, as an admin gives it to the real engine: a catalog row and a `prepare` run that says `mode: 'swap'`
// (the worker's person-swap preparation takes it). A product template is prepared as before: its run says no mode.

let dir: string, db: DatabaseSync;
const ADMIN = 'usr-admin';
const LINK = 'https://www.tiktok.com/@a/video/1';
const rows = () => db.prepare('SELECT id, state, owner, source_kind FROM templates').all() as { id: string; state: string; owner: string | null; source_kind: string }[];
const runs = () => (db.prepare('SELECT ref, kind, state, input FROM runs ORDER BY created_at, id').all() as { ref: string; kind: string; state: string; input: string }[])
  .map((run) => ({ ...run, input: JSON.parse(run.input) as Record<string, unknown> }));

beforeEach(() => {
  ({ dir, db } = makeDataDir());
  vi.stubEnv('VC_ENGINE', 'sqlite'); vi.stubEnv('VC_DATA_DIR', dir); vi.stubEnv('VC_ADMIN_PASSWORD', 'test-only-password-123');
  resetStore(); addDemoCustomers(); closeSqliteEngines();
});
afterEach(() => {
  closeSqliteEngines(); db.close(); rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs(); vi.restoreAllMocks(); resetStore();
});

describe('a person-swap video an admin adds', () => {
  it('by a link: a catalog row that is being prepared (no owner) and one prepare run that says mode swap, released to the worker', async () => {
    const made = await data.admin.addSwapTemplate(ADMIN, { kind: 'link', url: LINK, range: { from: 2, to: 14 } });
    expect(rows()).toEqual([{ id: made.id, state: 'preparing', owner: null, source_kind: 'link' }]);
    expect(runs()).toEqual([{ ref: made.id, kind: 'prepare', state: 'queued',
      input: { kind: 'prepare', templateId: made.id, ownerId: null, mode: 'swap', from: { kind: 'link', url: LINK, range: { from: 2, to: 14 } } } }]);
    expect(made).toMatchObject({ ownerId: null, status: 'waiting', preparation: 'preparing' });
  });

  it('by an uploaded file: the run names who uploaded it (the worker checks the file is theirs), the row stays the catalog\'s', async () => {
    const uploadId = registeredVideo(dir, ADMIN);
    const made = await data.admin.addSwapTemplate(ADMIN, { kind: 'upload', uploadId });
    expect(rows()).toEqual([{ id: made.id, state: 'preparing', owner: null, source_kind: 'upload' }]);
    const [run] = runs();
    expect(run).toMatchObject({ ref: made.id, kind: 'prepare', state: 'queued', input: { kind: 'prepare', templateId: made.id, ownerId: ADMIN, mode: 'swap', from: { kind: 'upload', uploadId } } });
    expect((run!.input.from as { sha256?: string }).sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is nobody\'s to add but an admin\'s, and not from a file somebody else uploaded: no row, no run', async () => {
    for (const who of ['usr-demo', '', 'usr-nobody']) await expect(data.admin.addSwapTemplate(who, { kind: 'link', url: LINK })).rejects.toThrow('forbidden');
    await expect(data.admin.addSwapTemplate(ADMIN, { kind: 'upload', uploadId: registeredVideo(dir, 'usr-demo') })).rejects.toThrow('upload-not-found');
    await expect(data.admin.addSwapTemplate(ADMIN, { kind: 'link', url: 'http://www.tiktok.com/@a/video/1' })).rejects.toThrow('source-rejected:unsupported-site');
    expect([rows(), runs()]).toEqual([[], []]);
  });

  it('is in no list a customer sees while it is prepared, with person swap switched on too', async () => {
    getStore().limits.personSwap = true;
    const made = await data.admin.addSwapTemplate(ADMIN, { kind: 'link', url: LINK });
    expect((await data.catalog.list({ viewerId: 'usr-demo' })).map((template) => template.id)).not.toContain(made.id);
    expect(await data.swap.templates()).toEqual([]);
    expect((await data.admin.templates({})).map((template) => template.id)).toEqual([made.id]);
  });
});

describe('a product template', () => {
  it('is prepared as before: the run of a link and of an upload says no mode, and the row is its owner\'s', () => {
    const link = sqliteEngine(dir).addFromLink('usr-demo', LINK);
    const upload = sqliteEngine(dir).addFromUpload('usr-demo', registeredVideo(dir, 'usr-demo'));
    expect(rows().map((row) => row.owner)).toEqual(['usr-demo', 'usr-demo']);
    const inputs = Object.fromEntries(runs().map((run) => [run.ref, run.input]));
    expect(inputs[link.id]).toEqual({ kind: 'prepare', templateId: link.id, ownerId: 'usr-demo', from: { kind: 'link', url: LINK } });
    expect(inputs[upload.id]).toMatchObject({ kind: 'prepare', templateId: upload.id, ownerId: 'usr-demo', from: { kind: 'upload' } });
    expect(inputs[upload.id]).not.toHaveProperty('mode');
  });
});
