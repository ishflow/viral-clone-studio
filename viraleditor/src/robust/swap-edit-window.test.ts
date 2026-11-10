// The one window the edit of a person-swap template leaves (swap/edit.ts): swap.json has taken its place and the COMMIT that
// writes the same people into the card of the row fails. The file is the new one, the card the one before. The site reads the
// card (how many photographs it asks for, what it shows), the worker reads the file (what it sends). Made here by the real edit
// handler on a database whose COMMIT fails once; then a customer's job is run on what is left.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { containerFacts } from '../adapters/encode.ts';
import { FakeClock } from '../adapters/fakes.ts';
import { createFakeSwapper } from '../adapters/fake-swapper.ts';
import type { CardSwap, Paid, RunInput, SwapSlot } from '../contracts.ts';
import { claim, enqueue, getRun } from '../db/runs.ts';
import * as templates from '../db/templates.ts';
import { abs } from '../paths.ts';
import type { PersonSwapper } from '../ports.ts';
import { countOf } from '../produce/plan.ts';
import { operationsOf } from '../produce/rows.ts';
import { workspace } from '../produce/testing.ts';
import { swapEditHandler } from '../swap/edit.ts';
import { swapHandler } from '../swap/index.ts';
import { loadSwap, needsOf } from '../swap/plan.ts';
import { BODY, FFMPEG, FFPROBE, finalOf, hasFfmpeg, inputOf, seedSwap, startSwap, TEMPLATE, tools } from '../swap/testing.ts';

type Edit = Extract<RunInput, { kind: 'edit' }>;
const TIERS = { fast: { model: 'fake-swap', resolution: '720p' }, best: { model: 'fake-swap', resolution: '1080p' } };
const ZERO: Paid = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };
const SLOW = 120_000;
const CARD = { title: 'A dance in the kitchen', category: 'dance', products: 0, shots: [], description: 'One person dances.', tags: ['dance'] };
const WOMAN: SwapSlot = { slot: 1, box: { left: 12.5, top: 20, right: 60, bottom: 98 }, hint: 'the woman on the left in a red dress' };
const MAN: SwapSlot = { slot: 2, box: { left: 55, top: 18, right: 100, bottom: 100 }, hint: 'the man on the right in a white shirt' };

let db: DatabaseSync, dir: string, clock: FakeClock, before: CardSwap, errors: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  ({ db, dir } = workspace());
  clock = new FakeClock('2026-10-07T10:00:00.000Z');
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  if (!hasFfmpeg) return;
  before = await seedSwap(12);                                              // one person, two parts of 6 seconds
  templates.upsert(db, {
    id: TEMPLATE, state: 'published', owner: null, sourceKind: 'link', sourceUrl: 'https://example.com/v/1', note: null, estimate: countOf(needsOf(before, 'any')), minutes: null, timesGenerated: 0,
    card: { ...CARD, format: 'no-talking', seconds: 12, referenceViews: '', image: `templates/${TEMPLATE}/poster.jpg`, video: `templates/${TEMPLATE}/source.mp4`, swap: before },
  }, clock.now());
}, SLOW);
afterEach(() => { errors.mockRestore(); });

/** The database, but its next COMMIT fails after everything inside the transaction was done; the ROLLBACK that follows is the real one. */
function commitFailsOnce(real: DatabaseSync): DatabaseSync {
  let failed = false;
  return new Proxy(real, {
    get(target, name) {
      if (name === 'exec') return (sql: string) => { if (sql === 'COMMIT' && !failed) { failed = true; throw new Error('disk I/O error'); } target.exec(sql); };
      const value: unknown = Reflect.get(target, name, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
/** An admin's edit of the people as the site queues it, handled by the real handler on `on`. */
async function edit(persons: SwapSlot[], on: DatabaseSync): Promise<void> {
  enqueue(db, { kind: 'edit', templateId: TEMPLATE, card: CARD, swap: { persons } } as Edit, TEMPLATE, null, clock.now());
  await swapEditHandler({ db: on, dataDir: dir, clock })(claim(db, 'worker-test', clock.now())!);
}
/** The window: the edit whose COMMIT fails. The file has the new people, the card the ones before. */
async function left(persons: SwapSlot[]): Promise<void> {
  await expect(edit(persons, commitFailsOnce(db))).rejects.toThrow('disk I/O error');
  expect(loadSwap(TEMPLATE)!.persons).toEqual(persons);
  expect(templates.get(db, TEMPLATE)!.card.swap).toEqual(before);
}
/** The pretend provider with the people of every request written down. */
function listened() {
  const real = createFakeSwapper({ log: join(dir, 'fake-swapper.log'), ffmpeg: FFMPEG, ffprobe: FFPROBE });
  const hints: string[][] = [];
  const swapper: PersonSwapper = { ...real, replace(request, to, onSubmitted) { hints.push(request.people.map((person) => person.hint)); return real.replace(request, to, onSubmitted); } };
  return { swapper, hints };
}
const handle = (swapper: PersonSwapper, id: string) => swapHandler({ db, swapper, ...tools(), clock, tiers: TIERS })(getRun(db, id)!);
/** A job as the site queues it from the card it reads: a photograph for each person of the card, approved for the card's estimate. */
const jobOfCard = () => { const row = templates.get(db, TEMPLATE)!; return startSwap(db, clock, before, row.estimate ?? undefined, inputOf({ swap: { people: row.card.swap!.persons.map((person) => ({ slot: person.slot, body: BODY, face: null })) } })); };

describe.skipIf(!hasFfmpeg)('the edit of a person-swap template whose COMMIT failed after swap.json took its place', () => {
  it('the number of people differs (the file has 2, the card 1): a job queued from the card stops before anything is sent or counted, and stays stopped until its template and its photographs agree', async () => {
    await left([WOMAN, MAN]);
    const provider = listened();
    const run = jobOfCard();                                                // the site asked for one photograph: its card says one person
    await handle(provider.swapper, run.id);
    expect(getRun(db, run.id)).toMatchObject({ state: 'stopped', reason: 'engine-error', detail: null, missing: ZERO, result: { kind: 'produce', variants: [] } });
    expect(JSON.parse(readFileSync(abs(`jobs/${run.id}/stop.json`), 'utf8'))).toMatchObject({ detail: 'the template has 2 people, the run has photographs for 1' });
    // free: no request, no row, nothing accepted. All the customer paid is unspent, and the site gives back what it took when a run stops
    expect(provider.hints).toEqual([]);
    expect(operationsOf(db, run.id)).toEqual([]);
    expect(getRun(db, run.id)!.sent ?? ZERO).toEqual(ZERO);
    expect(existsSync(join(dir, 'fake-swapper.log'))).toBe(false);
    expect(existsSync(finalOf(run.id))).toBe(false);

    // nothing puts it right by itself: the admin writes the people again, and the card follows the file
    await edit([WOMAN, MAN], db);
    expect(templates.get(db, TEMPLATE)!.card.swap).toEqual(loadSwap(TEMPLATE));
    db.prepare("UPDATE runs SET state = 'running' WHERE id = ?").run(run.id);   // the old job, continued: its one photograph is still not the two the template needs
    await handle(provider.swapper, run.id);
    expect(getRun(db, run.id)).toMatchObject({ state: 'stopped', reason: 'engine-error' });
    expect(provider.hints).toEqual([]);
    const next = jobOfCard();                                               // a job started now carries two photographs
    await handle(provider.swapper, next.id);
    expect(getRun(db, next.id)!.state).toBe('done');
    expect(provider.hints).toEqual([[WOMAN.hint, MAN.hint], [WOMAN.hint, MAN.hint]]);
  }, SLOW);

  it('the number of people is the same (one, described anew): the job is made whole, with the words of the file, the ones the admin wrote last; the card still shows the ones before', async () => {
    await left([WOMAN]);
    const provider = listened();
    const run = jobOfCard();
    await handle(provider.swapper, run.id);
    expect(getRun(db, run.id)).toMatchObject({ state: 'done', sent: { ...ZERO, clips: 2, clipSeconds: 12 } });
    expect(provider.hints).toEqual([[WOMAN.hint], [WOMAN.hint]]);
    expect(templates.get(db, TEMPLATE)!.card.swap!.persons[0]!.hint).toBe('the person in the middle');
    expect((await containerFacts(FFPROBE, finalOf(run.id), 10_000)).frames).toBe(360);
  }, SLOW);
});
