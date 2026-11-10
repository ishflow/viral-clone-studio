// The worker's handler for a `prepare` run that says `mode: 'swap'`: the video an admin gave (a link, or an uploaded file) becomes
// a person-swap template. fetch → measure → find its cuts → cut it into the parts a swap is asked for in → a still and a sheet of
// its frames → the model says how many people it shows and how each is found → swap.json. Nothing here is paid: the handler is
// given no provider. Every ending is a result `{ kind: 'prepare', state, note }`; the row is the site's, made together with its run.
//
// The template's folder is made whole in a folder of this attempt alone and moved into `templates/<id>/` at the end, in the
// transaction that makes the row ready: a run that fails, or a worker that dies, leaves no part of a template. A run handed to
// the handler again ends as one clean run would: a row that is no longer `preparing` says how it ended, and the day's unit is
// taken once per row (the mark UNIT_TAKEN of prepare/index.ts).
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { MediaError } from '../adapters/media.ts';
import type { Card, CardSwap, PrepareNote, RunInput, SwapPart } from '../contracts.ts';
import { finish, holds } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import { readSettings, takeUsage } from '../db/settings.ts';
import * as templates from '../db/templates.ts';
import type { TemplateRow } from '../db/templates.ts';
import { rel } from '../paths.ts';
import type { Clock, Downloader, Llm, Media, MediaFacts } from '../ports.ts';
import { UNIT_TAKEN } from '../prepare/index.ts';
import { fetchSource, RangeRefused, SHEET_GRID, SourceTooLong, SourceUnavailable } from '../prepare/read.ts';
import type { Source } from '../prepare/read.ts';
import { transaction } from '../prepare/transaction.ts';
import { uploadSource } from '../prepare/upload.ts';
import { countOf } from '../produce/plan.ts';
import { SWAP_PART_SECONDS_MIN, SWAP_SECONDS_MAX, SwapTemplate } from '../template/swap-schema.ts';
import { needsOf, partOf, sourceOf } from './plan.ts';
import { suggestPeople, UNKNOWN_PERSON } from './prepare-people.ts';
import { segmentsOf } from './segments.ts';

export interface SwapPrepareDeps {
  db: DatabaseSync;
  dataDir: string;                        // the data directory: `templates/<id>/` is made in it
  llm: Llm;
  downloader: Downloader;
  media: Media;
  clock: Clock;
}

type PrepareInput = Extract<RunInput, { kind: 'prepare' }>;
interface Outcome { state: 'ready' | 'failed'; note: PrepareNote | null; detail?: string }   // detail: a closed code of why, stored on the run
/** What a run may do only while it is this worker's: `guard` throws when it is not, `owned` is one transaction that begins with the guard. */
interface Hold { guard(): void; owned<T>(body: () => T): T }

/** The poster of the template, and the picture the boxes of its people are drawn on. Under data/. */
const posterOf = (templateId: string): string => rel('templates', templateId, 'poster.jpg');
/** The second of the video the poster is taken at. */
const stillSecond = (seconds: number): number => Math.min(0.5, seconds / 2);
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
/** YYYY-MM-DD in local time: the key of `usage`, the day a product template counts in too (prepare/index.ts). */
function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** The file cannot be read as a video (thrown on: a tool that does not run, which is no fault of the file). */
const unreadable = (error: unknown): boolean => error instanceof MediaError && error.code !== 'tool-failed';

/** How the run of a row ended, when the row is no longer being prepared. */
function ended(row: TemplateRow): Outcome | null {
  if (row.state === 'preparing') return null;
  return row.state === 'failed' ? { state: 'failed', note: (row.note as PrepareNote | null) ?? 'check-failed' } : { state: 'ready', note: null };
}

/** The card of a person-swap video: its own video is what the site shows, and it has no shot. */
function cardOf(templateId: string, row: TemplateRow, source: Source, seconds: number, swap: CardSwap, keepTitle: boolean): Card {
  const image = posterOf(templateId), video = sourceOf(templateId);
  return {
    title: (keepTitle ? '' : oneLine(source.title)) || row.card.title, category: '', format: 'no-talking', seconds, referenceViews: '',
    image, video, referenceImage: image, referenceVideo: video, ...(source.views === null ? {} : { referenceMetric: { kind: 'views' as const, count: source.views } }),
    products: 0, shots: [], description: '', tags: [], swap,
  };
}

/** Why the video is no person-swap video by what it measures, or null: a picture of 3 to 30 seconds, counted in frames as `segmentsOf` counts them. */
function unfit(facts: MediaFacts): { note: PrepareNote; detail?: string } | null {
  if (!(facts.width > 0 && facts.height > 0 && facts.fps > 0 && facts.frames > 0)) return { note: 'source-unavailable' };
  if (facts.frames > Math.floor(SWAP_SECONDS_MAX * facts.fps)) return { note: 'too-long' };
  if (facts.frames < Math.ceil(SWAP_PART_SECONDS_MIN * facts.fps)) return { note: 'unsupported', detail: 'too-short' };
  return null;
}

/** Cuts every part out of the video into its file. The frames of all parts together, or null when a part could not be cut. */
async function cutParts(media: Media, video: string, parts: SwapPart[], fileOf: (part: SwapPart) => string): Promise<number | null> {
  let frames = 0;
  try {
    for (const part of parts) frames += (await media.trim(video, part.from, part.to, fileOf(part))).frames;
  } catch (error) {
    if (!unreadable(error)) throw error;
    return null;
  }
  return frames;
}

/**
 * One unit of the day's templates for this row, as a product template takes one: true when the row has it. A row of a run that
 * was taken over has it already; false when the day has none left, or the row is no longer being prepared.
 */
function takeUnit({ db, clock }: SwapPrepareDeps, templateId: string): boolean {
  const row = templates.get(db, templateId);
  if (row === null || row.state !== 'preparing') return false;
  if (row.note === UNIT_TAKEN) return true;
  if (!takeUsage(db, 'prepare', localDay(clock.now()), readSettings(db).dailyTemplates)) return false;
  templates.setState(db, templateId, 'preparing', UNIT_TAKEN, clock.now());
  return true;
}

async function prepare(deps: SwapPrepareDeps, input: PrepareInput, run: RunRow, work: string, { guard, owned }: Hold): Promise<Outcome> {
  const { db, clock, dataDir, media } = deps;
  const { templateId, from } = input;
  const GONE: Outcome = { state: 'failed', note: 'unsupported' };          // the row was deleted: nobody is left to read a note

  /** An ending without a template. A row that is still being prepared says why; any other row stays as the site has it. */
  const failed = (note: PrepareNote, detail?: string): Outcome => {
    owned(() => { if (templates.get(db, templateId)?.state === 'preparing') templates.setState(db, templateId, 'failed', note, clock.now()); });
    return detail === undefined ? { state: 'failed', note } : { state: 'failed', note, detail };
  };

  // 0. handled before, or not to be handled at all
  const before = templates.get(db, templateId);
  if (before === null) return GONE;
  const end = ended(before);
  if (end !== null) return end;
  if (from.kind === 'candidate') return failed('unsupported');               // a scan finds references for product videos; an admin gives this one

  // 1. the video, into this attempt's own folder, and what it measures
  let source: Source, facts: MediaFacts;
  try {
    source = from.kind === 'upload'
      ? await uploadSource({ dataDir, media, checkOwnership: guard, writeOwned: owned }, join(work, 'source'), input.ownerId, from, { runId: run.id, workerId: run.claimedBy, takeovers: run.takeovers }, from.range)
      : await fetchSource(deps, join(work, 'source'), from.url, 0, from.range);
    guard();
    facts = await media.probe(source.video);
  } catch (error) {
    if (error instanceof SourceTooLong) return failed('too-long');
    if (error instanceof RangeRefused) return failed('bad-range');
    if (error instanceof SourceUnavailable || unreadable(error)) return failed('source-unavailable');
    throw error;
  }
  const fault = unfit(facts);
  if (fault !== null) return failed(fault.note, fault.detail);
  const seconds = facts.frames / facts.fps;

  // 2. the template's folder as it will stand in the data dir, made here: the video as it is, and each part cut out of it.
  //    Together the parts are every frame of the video: a run of the template is held to that after it has paid, so parts that
  //    do not add up are no template
  const staged = (file: string): string => join(work, 'staged', file);
  const parts = segmentsOf(seconds, (await media.cuts(source.video)).seconds, facts.fps);
  mkdirSync(dirname(staged(partOf(templateId, 1))), { recursive: true });
  copyFileSync(source.video, staged(sourceOf(templateId)));
  const cut = await cutParts(media, source.video, parts, (part) => staged(partOf(templateId, part.n)));
  guard();
  if (cut !== facts.frames) return failed('check-failed', 'parts-frames');

  // 3. what the model is shown, in a folder of its own (it may open the folder of a file it is given): the still and a sheet of the frames
  const still = join(work, 'look', 'still.jpg'), sheet = join(work, 'look', 'sheet.jpg');
  mkdirSync(dirname(still), { recursive: true });
  await media.still(source.video, stillSecond(seconds), still);
  await media.sheet(source.video, sheet, SHEET_GRID);
  copyFileSync(still, staged(posterOf(templateId)));
  guard();

  // 4. the people: what the model suggests, within the templates of the day. Without a suggestion the template is ready all the
  //    same, with one person the admin has to describe
  const asked = owned(() => takeUnit(deps, templateId)) ? await suggestPeople(deps.llm, still, sheet) : { none: 'daily-cap' as const };
  guard();
  if ('persons' in asked && asked.persons.length === 0) return failed('unsupported', 'no-person');
  const persons = 'persons' in asked ? asked.persons : [UNKNOWN_PERSON];
  const swap = SwapTemplate.safeParse({ people: persons.length, persons, parts, sound: facts.audio });
  if (!swap.success) return failed('check-failed');
  writeFileSync(staged(rel('templates', templateId, 'swap.json')), `${JSON.stringify(swap.data, null, 2)}\n`);

  // 5. the end, in one transaction: the row ready, and the folder moved into place whole (what stood there belonged to a row
  //    that was still being prepared: it was no template)
  return owned((): Outcome => {
    const now = clock.now();
    const row = templates.get(db, templateId);
    if (row === null) return GONE;                                         // deleted meanwhile: not brought back
    const changed = ended(row);
    if (changed !== null) return changed;                                  // hidden, published, failed meanwhile: left as it is
    templates.setState(db, templateId, 'ready', null, now);
    // an uploaded file keeps the name the site gave it, as a product template does
    templates.setCard(db, templateId, { card: cardOf(templateId, row, source, seconds, swap.data, from.kind === 'upload'), estimate: countOf(needsOf(swap.data, templateId)), minutes: null, note: null }, now);
    const dir = join(dataDir, 'templates', templateId);
    mkdirSync(dirname(dir), { recursive: true });
    rmSync(dir, { recursive: true, force: true });
    renameSync(staged(rel('templates', templateId)), dir);
    return 'none' in asked ? { state: 'ready', note: null, detail: `no-suggestion:${asked.none}` } : { state: 'ready', note: null };
  });
}

export function swapPrepareHandler(deps: SwapPrepareDeps): (run: RunRow) => Promise<void> {
  const { db, clock } = deps;
  return async (run) => {
    const input = run.input;
    if (input.kind !== 'prepare' || input.mode !== 'swap') throw new Error(`the person-swap preparation got a ${input.kind} run that is not one`);
    const guard = (): void => {
      if (!holds(db, run.id, run.claimedBy)) throw new Error('prepare-owner-lost');
    };
    const owned = <T>(body: () => T): T => transaction(db, () => { guard(); return body(); });
    const work = join(deps.dataDir, 'prepare-attempts', run.id, randomUUID());
    let outcome: Outcome;
    try {
      guard();
      outcome = await prepare(deps, input, run, work, { guard, owned });
      guard();
    } catch (error) {
      if (!holds(db, run.id, run.claimedBy)) return;                       // another worker has the run: it writes how it ends
      owned(() => { if (templates.get(db, input.templateId)?.state === 'preparing') templates.setState(db, input.templateId, 'failed', 'engine-error', clock.now()); });
      throw error;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    owned(() => { finish(db, run.id, { kind: 'prepare', state: outcome.state, note: outcome.note }, clock.now(), outcome.detail ?? null); });
  };
}
