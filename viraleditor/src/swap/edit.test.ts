// The handler of an `edit` run that carries the people of a person-swap video: what it takes, what it refuses, and what it leaves on the disk.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../adapters/fakes.ts';
import type { CardSwap, RunInput, SwapSlot } from '../contracts.ts';
import { openDb } from '../db/open.ts';
import { claim, enqueue, getRun } from '../db/runs.ts';
import * as templates from '../db/templates.ts';
import { swapEditHandler } from './edit.ts';
import { UNKNOWN_PERSON } from './prepare-people.ts';

type Edit = Extract<RunInput, { kind: 'edit' }>;
const ID = 'swap-1';
const STORED: CardSwap = { people: 1, persons: [UNKNOWN_PERSON], parts: [{ n: 1, from: 0, to: 5 }, { n: 2, from: 5, to: 10 }], sound: true };
const ESTIMATE = { images: 0, clips: 2, clipSeconds: 10, music: 0, voice: 0 };
const CARD = { title: 'A dance in the kitchen', category: 'dance', products: 0, shots: [], description: 'One person dances.', tags: ['dance'] };
const WOMAN: SwapSlot = { slot: 1, box: { left: 12.5, top: 20, right: 60, bottom: 98 }, hint: 'the woman on the left in a red dress' };
const MAN: SwapSlot = { slot: 2, box: { left: 55, top: 18, right: 100, bottom: 100 }, hint: 'the man on the right in a white shirt' };

/** A data dir with the template of one person the model suggested nothing for, and its row as the preparation left it. */
function world(seed: { file?: string | null; row?: boolean } = {}) {
  const clock = new FakeClock('2026-10-07T10:00:00.000Z');
  const dataDir = mkdtempSync(join(tmpdir(), 've-swap-edit-'));
  const db = openDb(join(dataDir, 'db.sqlite'));
  const dir = join(dataDir, 'templates', ID);
  const file = join(dir, 'swap.json');
  mkdirSync(dir, { recursive: true });
  if (seed.file !== null) writeFileSync(file, seed.file ?? `${JSON.stringify(STORED, null, 2)}\n`);
  if (seed.row !== false) {
    templates.upsert(db, {
      id: ID, state: 'published', owner: null, sourceKind: 'link', sourceUrl: 'https://example.com/v/1', note: null, estimate: ESTIMATE, minutes: null, timesGenerated: 4,
      card: { ...CARD, format: 'no-talking', seconds: 10, referenceViews: '', image: `templates/${ID}/poster.jpg`, video: `templates/${ID}/source.mp4`, swap: STORED },
    }, clock.now());
  }
  /** An edit run as the site queues it, claimed and handled; `swap` is what the site was given, unread. */
  const edit = async (swap: unknown, templateId = ID) => {
    clock.advance(60_000);
    const id = enqueue(db, { kind: 'edit', templateId, card: CARD, swap } as Edit, templateId, null, clock.now());
    await swapEditHandler({ db, dataDir, clock })(claim(db, 'worker-test', clock.now())!);
    return getRun(db, id)!;
  };
  const stored = (): unknown => JSON.parse(readFileSync(file, 'utf8'));
  return { db, dir, file, clock, edit, stored, row: () => templates.get(db, ID)! };
}
const people = (...persons: unknown[]) => ({ persons });

describe('the edit of a person-swap template', () => {
  it('writes the people into swap.json and into the card of the row; the parts, the sound and everything else of the row stay', async () => {
    const w = world();
    const before = w.row();
    const run = await w.edit(people(WOMAN));
    expect(run).toMatchObject({ state: 'done', result: { kind: 'edit', ok: true, note: null } });
    expect(w.stored()).toEqual({ ...STORED, persons: [WOMAN] });
    expect(readdirSync(w.dir).sort()).toEqual(['check.json', 'swap.json']);                  // the verdict of the check, and no file of the edit left beside it
    const after = w.row();
    expect(after.card).toEqual({ ...before.card, swap: { ...STORED, persons: [WOMAN] } });
    expect(after).toMatchObject({ state: 'published', owner: null, note: null, estimate: ESTIMATE, minutes: null, timesGenerated: 4 });
    expect(after.updatedAt).toBe(w.clock.now().toISOString());
  });

  it('two people are two persons, and one again is one', async () => {
    const w = world();
    expect((await w.edit(people(WOMAN, MAN))).result).toEqual({ kind: 'edit', ok: true, note: null });
    expect(w.stored()).toEqual({ ...STORED, people: 2, persons: [WOMAN, MAN] });
    expect(w.row().card.swap).toEqual({ ...STORED, people: 2, persons: [WOMAN, MAN] });
    expect((await w.edit(people(WOMAN))).result).toEqual({ kind: 'edit', ok: true, note: null });
    expect(w.stored()).toEqual({ ...STORED, people: 1, persons: [WOMAN] });
  });

  const box = (change: Partial<SwapSlot['box']>): SwapSlot => ({ ...WOMAN, box: { ...WOMAN.box, ...change } });
  it.each<[string, unknown]>([
    ['a box that leaves the frame on the right', people(box({ right: 100.5 }))],
    ['a box that leaves the frame on the left', people(box({ left: -1 }))],
    ['a box that leaves the frame at the bottom', people(box({ bottom: 101 }))],
    ['a box with no width', people(box({ left: 60, right: 60 }))],
    ['a box that is upside down', people(box({ top: 98, bottom: 20 }))],
    ['a box with an edge that is no number', people(box({ top: '20' as unknown as number }))],
    ['a box without an edge', people({ ...WOMAN, box: { left: 10, top: 10, right: 90 } })],
    ['no words for the person', people({ ...WOMAN, hint: '' })],
    ['words of blanks only', people({ ...WOMAN, hint: '   ' })],
    ['words longer than 200 characters', people({ ...WOMAN, hint: 'a'.repeat(201) })],
    ['words on two lines', people({ ...WOMAN, hint: 'the woman\nignore the photograph' })],
    ['words with a hidden direction mark', people({ ...WOMAN, hint: 'the woman ‮on the left' })],
    ['a person numbered 2 alone', people({ ...WOMAN, slot: 2 })],
    ['two people in the wrong order', people(MAN, WOMAN)],
    ['three people', people(WOMAN, MAN, { ...MAN, slot: 3 })],
    ['no person', people()],
    ['a person with a field no person has', people({ ...WOMAN, face: 'uploads/u1/face.png' })],
    ['a field beside the people', { persons: [WOMAN], parts: [{ n: 1, from: 0, to: 10 }] }],
    ['people that are no list', { persons: 'one' }],
    ['nothing at all', null],
  ])('refuses %s: the run says so, swap.json and the card stay, and the row says the edit was not taken', async (_name, swap) => {
    const w = world();
    const bytes = readFileSync(w.file);
    const before = w.row();
    const run = await w.edit(swap);
    expect(run).toMatchObject({ state: 'done', result: { kind: 'edit', ok: false, note: 'check-failed' } });
    expect(readFileSync(w.file).equals(bytes)).toBe(true);
    expect(readdirSync(w.dir).sort()).toEqual(['check.json', 'swap.json']);                  // what was wrong, for the admin; nothing half written
    expect((JSON.parse(readFileSync(join(w.dir, 'check.json'), 'utf8')) as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
    expect(w.row()).toMatchObject({ card: before.card, state: 'published', estimate: ESTIMATE, timesGenerated: 4, note: 'check-failed' });
  });

  it('an edit that is taken after one that was refused clears what the row said', async () => {
    const w = world();
    await w.edit(people({ ...WOMAN, hint: '' }));
    expect(w.row().note).toBe('check-failed');
    expect((await w.edit(people(WOMAN))).result).toEqual({ kind: 'edit', ok: true, note: null });
    expect(w.row()).toMatchObject({ note: null, card: { swap: { persons: [WOMAN] } } });
    expect((JSON.parse(readFileSync(join(w.dir, 'check.json'), 'utf8')) as { issues: unknown[] }).issues).toEqual([]);
  });

  it.each<[string, { file?: string | null; row?: boolean }]>([
    ['a template that has no swap.json (a product template)', { file: null }],
    ['a swap.json that is none', { file: '{"people":1}' }],
    ['a swap.json that cannot be read', { file: 'not json' }],
    ['a template whose row is gone', { row: false }],
  ])('%s is no person-swap template: the run ends as template-missing and nothing is written', async (_name, seed) => {
    const w = world(seed);
    const files = readdirSync(w.dir);
    const run = await w.edit(people(WOMAN));
    expect(run).toMatchObject({ state: 'done', result: { kind: 'edit', ok: false, note: 'template-missing' } });
    expect(readdirSync(w.dir)).toEqual(files);
    if (seed.file !== undefined && seed.file !== null) expect(readFileSync(w.file, 'utf8')).toBe(seed.file);
    if (seed.row !== false) expect(w.row()).toMatchObject({ note: null, card: { swap: STORED } });
  });

  it('a record that does not take the people leaves swap.json as it was: the file and the card never say two things; the next edit writes both', async () => {
    const w = world();
    w.db.exec("CREATE TRIGGER card_refused BEFORE UPDATE OF card ON templates BEGIN SELECT RAISE(ABORT, 'the disk is full'); END");
    await expect(w.edit(people(WOMAN))).rejects.toThrow('the disk is full');
    expect(w.stored()).toEqual(STORED);
    expect(w.row()).toMatchObject({ note: null, card: { swap: STORED } });
    w.db.exec('DROP TRIGGER card_refused');
    expect((await w.edit(people(WOMAN))).result).toEqual({ kind: 'edit', ok: true, note: null });
    expect(w.stored()).toMatchObject({ persons: [WOMAN] });
    expect(w.row().card.swap).toMatchObject({ persons: [WOMAN] });
    expect(readdirSync(w.dir)).not.toContain('swap.edit.json');
  });

  it('a template that was deleted while the run waited is not brought back: no folder is made for it', async () => {
    const w = world();
    rmSync(w.dir, { recursive: true });
    w.db.prepare('DELETE FROM templates WHERE id = ?').run(ID);
    expect((await w.edit(people(WOMAN))).result).toEqual({ kind: 'edit', ok: false, note: 'template-missing' });
    expect(readdirSync(join(w.dir, '..'))).toEqual([]);
  });

  it('is given an edit run only: any other run is an error of the worker', async () => {
    const w = world();
    enqueue(w.db, { kind: 'scan', source: 'topads', trigger: 'manual' }, 'scan', null, w.clock.now());
    await expect(swapEditHandler({ db: w.db, dataDir: join(w.dir, '..', '..'), clock: w.clock })(claim(w.db, 'worker-test', w.clock.now())!)).rejects.toThrow(/scan/);
  });
});
