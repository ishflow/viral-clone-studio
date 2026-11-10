// @vitest-environment node
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '..';
import { NotFoundError } from '../ports';
import type { SwapSlot, TemplateSwap } from '../ports';
import { getStore, resetStore } from '../mock/store';
import { addDemoCustomers } from '../mock/test-helpers';
import { closeSqliteEngines } from './sqlite-engine';
import { card, makeDataDir, putTemplate, viraleditorJson } from './testing';

// The people of a person-swap video as an admin sets them, next to the real engine: the site queues an `edit` run that carries them
// and writes nothing of them itself (no file, and not the card); the worker checks them and writes them. What the preparation said of
// its suggestion (the `detail` of its run) and what became of the admin's edits (their runs) is what the admin's copy says.

let dir: string, db: DatabaseSync;
const ADMIN = 'usr-admin';
const ID = 'swap-1';
const PLACEHOLDER: SwapSlot = { slot: 1, box: { left: 0, top: 0, right: 100, bottom: 100 }, hint: 'the person in the video' };
const STORED: TemplateSwap = { people: 1, persons: [PLACEHOLDER], parts: [{ n: 1, from: 0, to: 6 }, { n: 2, from: 6, to: 12 }], sound: true };
const WOMAN: SwapSlot = { slot: 1, box: { left: 12.5, top: 20, right: 60, bottom: 98 }, hint: 'the woman on the left in a red dress' };
const MAN: SwapSlot = { slot: 2, box: { left: 55, top: 18, right: 100, bottom: 100 }, hint: 'the man on the right in a white shirt' };
const SWAP_CARD = card({ title: 'A dance', category: '', seconds: 12, image: `templates/${ID}/poster.jpg`, video: `templates/${ID}/source.mp4`, products: 0, shots: [], description: '', tags: [], swap: STORED });

const file = () => join(dir, 'templates', ID, 'swap.json');
const row = () => db.prepare('SELECT state, note, card FROM templates WHERE id = ?').get(ID) as { state: string; note: string | null; card: string };
const runs = (kind: string) => (db.prepare('SELECT id, ref, state, input FROM runs WHERE kind = ? ORDER BY created_at, id').all(kind) as { id: string; ref: string; state: string; input: string }[])
  .map((run) => ({ ...run, input: JSON.parse(run.input) as Record<string, unknown> }));
/** The template as its preparation left it: the row, swap.json, and the prepare run with what it said of its suggestion. */
function prepared(detail: string | null, state = 'ready'): void {
  putTemplate(db, { id: ID, state: state as 'ready', sourceKind: 'link', card: SWAP_CARD, estimate: { images: 0, clips: 2, clipSeconds: 12, music: 0, voice: 0 }, minutes: null });
  mkdirSync(join(dir, 'templates', ID), { recursive: true });
  writeFileSync(file(), `${JSON.stringify(STORED, null, 2)}\n`);
  db.prepare(`INSERT INTO runs (id, kind, ref, state, input, steps, result, detail, created_at, updated_at) VALUES ('run-prepare', 'prepare', ?, 'done', ?, '[]', ?, ?, '2026-10-04T10:00:00.000Z', '2026-10-04T10:01:00.000Z')`)
    .run(ID, JSON.stringify({ kind: 'prepare', templateId: ID, ownerId: null, mode: 'swap', from: { kind: 'link', url: 'https://www.tiktok.com/@a/video/1' } }), JSON.stringify({ kind: 'prepare', state: 'ready', note: null }), detail);
}
/** How the worker ended the edit run that waits: taken (the people are in the card, as the worker writes them) or refused. */
function answered(ok: boolean, persons: SwapSlot[] = [WOMAN]): void {
  const [run] = runs('edit').filter((edit) => edit.state === 'queued');
  db.prepare(`UPDATE runs SET state = 'done', result = ? WHERE id = ?`).run(JSON.stringify({ kind: 'edit', ok, note: ok ? null : 'check-failed' }), run!.id);
  if (ok) db.prepare('UPDATE templates SET card = ?, note = NULL WHERE id = ?').run(JSON.stringify({ ...SWAP_CARD, swap: { ...STORED, people: persons.length, persons } }), ID);
  else db.prepare(`UPDATE templates SET note = 'check-failed' WHERE id = ?`).run(ID);
}

beforeEach(() => {
  ({ dir, db } = makeDataDir());
  vi.stubEnv('VC_ENGINE', 'sqlite'); vi.stubEnv('VC_DATA_DIR', dir); vi.stubEnv('VC_ADMIN_PASSWORD', 'test-only-password-123');
  resetStore(); addDemoCustomers(); closeSqliteEngines();
});
afterEach(() => {
  closeSqliteEngines(); db.close(); rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs(); vi.restoreAllMocks(); resetStore();
});

describe('the people of a person-swap video, set by an admin', () => {
  it('go to the worker in one edit run that carries them; the site writes no file and not the card, and the admin\'s copy says the worker has them', async () => {
    prepared(null);
    const before = { card: row().card, bytes: readFileSync(file(), 'utf8'), files: readdirSync(join(dir, 'templates', ID)) };
    const saved = await data.admin.setSwapPeople(ADMIN, ID, [WOMAN, MAN]);
    expect(runs('edit')).toEqual([{ id: expect.any(String), ref: ID, state: 'queued', input: {
      kind: 'edit', templateId: ID, card: { title: 'A dance', category: '', products: 0, shots: [], description: '', tags: [] }, swap: { persons: [WOMAN, MAN] },
    } }]);
    expect([row().card, readFileSync(file(), 'utf8'), readdirSync(join(dir, 'templates', ID))]).toEqual([before.card, before.bytes, before.files]);
    expect(saved).toMatchObject({ id: ID, status: 'waiting', swapPeople: 'pending', swap: STORED });
  });

  it('are an admin\'s alone to set, and only what the people of such a video can be: nothing is queued for anybody else or for anything else', async () => {
    prepared(null);
    for (const who of ['usr-demo', '', 'usr-nobody']) await expect(data.admin.setSwapPeople(who, ID, [WOMAN])).rejects.toThrow('forbidden');
    for (const persons of [[], [{ ...WOMAN, hint: '' }], [{ ...WOMAN, box: { ...WOMAN.box, bottom: 100.01 } }], [MAN], [WOMAN, MAN, { ...MAN, slot: 3 }]]) {
      await expect(data.admin.setSwapPeople(ADMIN, ID, persons)).rejects.toThrow('swap-people-invalid');
    }
    putTemplate(db, { id: 'product-1' });
    await expect(data.admin.setSwapPeople(ADMIN, 'product-1', [WOMAN])).rejects.toBeInstanceOf(NotFoundError);
    await expect(data.admin.setSwapPeople(ADMIN, 'nowhere', [WOMAN])).rejects.toBeInstanceOf(NotFoundError);
    expect(runs('edit')).toEqual([]);
  });

  it('are not set while the video is still being prepared, or after its preparation failed', async () => {
    for (const state of ['preparing', 'failed']) {
      prepared(null, state);
      await expect(data.admin.setSwapPeople(ADMIN, ID, [WOMAN])).rejects.toThrow('template-not-ready');
      expect(runs('edit')).toEqual([]);
      db.exec('DELETE FROM runs; DELETE FROM templates');
    }
  });

  it('the run the site queues is one the worker\'s own handler takes: swap.json and the admin\'s copy have the people, and the parts and the sound stay', async () => {
    prepared('no-suggestion:llm-error');
    await data.admin.setSwapPeople(ADMIN, ID, [WOMAN]);
    const result = viraleditorJson<unknown>(`
      import { openDb } from './src/db/open.ts';
      import { claim, getRun } from './src/db/runs.ts';
      import { swapEditHandler } from './src/swap/edit.ts';
      const db = openDb(${JSON.stringify(join(dir, 'db.sqlite'))});
      const clock = { now: () => new Date() };
      const run = claim(db, 'worker-test', clock.now());
      await swapEditHandler({ db, dataDir: ${JSON.stringify(dir)}, clock })(run);
      console.log(JSON.stringify(getRun(db, run.id).result));
    `);
    expect(result).toEqual({ kind: 'edit', ok: true, note: null });
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({ ...STORED, persons: [WOMAN] });
    const shown = (await data.admin.template(ID))!;
    expect(shown.swap).toEqual({ ...STORED, persons: [WOMAN] });
    expect(shown).not.toHaveProperty('swapPeople');
    expect(existsSync(join(dir, 'templates', ID, 'swap.edit.json'))).toBe(false);
  });
});

describe('what the admin\'s copy of a person-swap video says of its people', () => {
  it('nothing when the preparation suggested them: it is published as it is', async () => {
    prepared(null);
    expect(await data.admin.template(ID)).not.toHaveProperty('swapPeople');
    expect(await data.admin.updateTemplate(ID, { status: 'published' })).toMatchObject({ status: 'published' });
  });

  it.each(['no-suggestion:daily-cap', 'no-suggestion:llm-invalid', 'no-suggestion:llm-error'])('unset when the preparation said %s: it cannot be published, whatever else is changed of it', async (detail) => {
    prepared(detail);
    expect(await data.admin.template(ID)).toMatchObject({ status: 'waiting', swapPeople: 'unset', swap: { persons: [PLACEHOLDER] } });
    expect((await data.admin.templates({})).find((template) => template.id === ID)).toMatchObject({ swapPeople: 'unset' });
    await expect(data.admin.updateTemplate(ID, { status: 'published' })).rejects.toThrow('swap-people-unset');
    await expect(data.admin.updateTemplate(ID, { status: 'published', title: 'Another title' })).rejects.toThrow('swap-people-unset');
    expect(row()).toMatchObject({ state: 'ready', card: JSON.stringify(SWAP_CARD) });
    expect(await data.admin.updateTemplate(ID, { status: 'hidden' })).toMatchObject({ status: 'hidden', swapPeople: 'unset' });
  });

  it('pending while the worker has not answered, and not published meanwhile; set once the worker took them: then it is published, withdrawn and published again', async () => {
    getStore().limits.personSwap = true;
    prepared('no-suggestion:llm-error');
    expect(await data.admin.setSwapPeople(ADMIN, ID, [WOMAN])).toMatchObject({ swapPeople: 'pending', swap: { persons: [PLACEHOLDER] } });
    await expect(data.admin.updateTemplate(ID, { status: 'published' })).rejects.toThrow('swap-people-unset');
    expect(row().state).toBe('ready');
    answered(true);
    const set = (await data.admin.template(ID))!;
    expect(set).not.toHaveProperty('swapPeople');
    expect(set.swap!.persons).toEqual([WOMAN]);
    const swapPages = async () => (await data.swap.templates()).map((template) => template.id);
    const gallery = async () => (await data.catalog.list({ viewerId: 'usr-demo' })).map((template) => template.id);
    expect(await data.admin.updateTemplate(ID, { status: 'published' })).toMatchObject({ status: 'published' });
    expect([await swapPages(), await gallery()]).toEqual([[ID], []]);
    expect(await data.admin.updateTemplate(ID, { status: 'hidden' })).toMatchObject({ status: 'hidden' });
    expect([await swapPages(), await gallery()]).toEqual([[], []]);
    expect(await data.admin.updateTemplate(ID, { status: 'published' })).toMatchObject({ status: 'published' });
    expect([await swapPages(), await gallery()]).toEqual([[ID], []]);
  });

  it('unset again when the worker refused the only edit, with the note of an edit that was not taken; a later edit it takes sets them', async () => {
    prepared('no-suggestion:llm-error');
    await data.admin.setSwapPeople(ADMIN, ID, [WOMAN]);
    answered(false);
    expect(await data.admin.template(ID)).toMatchObject({ swapPeople: 'unset', preparationNote: 'check-failed', swap: { persons: [PLACEHOLDER] } });
    await expect(data.admin.updateTemplate(ID, { status: 'published' })).rejects.toThrow('swap-people-unset');
    await data.admin.setSwapPeople(ADMIN, ID, [WOMAN]);
    answered(true);
    expect(await data.admin.template(ID)).not.toHaveProperty('swapPeople');
  });

  it('pending on a published video whose people an admin changes: it stays published, with the people before, until the worker has written the new ones', async () => {
    getStore().limits.personSwap = true;
    prepared(null, 'published');
    expect(await data.admin.setSwapPeople(ADMIN, ID, [WOMAN])).toMatchObject({ status: 'published', swapPeople: 'pending', swap: { persons: [PLACEHOLDER] } });
    const [copy] = await data.swap.templates();
    expect(copy).toMatchObject({ id: ID });
    expect(copy).not.toHaveProperty('swapPeople');
    answered(true);
    expect(await data.admin.template(ID)).toMatchObject({ status: 'published', swap: { persons: [WOMAN] } });
  });

  it('nothing on a product template, whatever its runs say', async () => {
    putTemplate(db, { id: 'product-1' });
    db.prepare(`INSERT INTO runs (id, kind, ref, state, input, steps, detail, created_at, updated_at) VALUES ('run-p', 'prepare', 'product-1', 'done', '{"kind":"prepare"}', '[]', 'no-suggestion:llm-error', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:00.000Z')`).run();
    expect(await data.admin.template('product-1')).not.toHaveProperty('swapPeople');
    expect(await data.admin.updateTemplate('product-1', { status: 'published' })).toMatchObject({ status: 'published' });
  });
});
