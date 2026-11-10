import { budgetSchema, refundProvider, releaseTerminal, reserveProvider, providerUnits } from '../../../../viraleditor/src/robust/provider-budget';
import { providerCaps } from '../../../../viraleditor/src/robust/provider-policy';
import { settleUnknown } from '../../../../viraleditor/src/robust/settle-unknown';
import { insertNew as insertNewCandidate } from '../../../../viraleditor/src/db/candidates';
import { sourceLink } from '../source-link';
import { sweepMedia } from './media';
import { assertSiteOwner, takeLock } from './site-lock';
import type * as Fs from 'node:fs';
import type * as Path from 'node:path';
import type * as Sqlite from 'node:sqlite';
import type { DatabaseSync } from 'node:sqlite';
import type { Engine } from '../engine/port';
import { sweepSwapJobs } from '../mock/jobs';
import { dataDir } from '../mock/persist';
import { now } from '../mock/store';
import type { JobRecord } from '../mock/store';
import { isJobFile } from '../job-frames';
import { fileLengthProblem, NotFoundError, rangeProblem, swapPeopleProblem } from '../ports';
import type { JobMade, JobShot, MadeFile, Shot, SourceRange } from '../ports';
import type {
  AdminSettings, Candidate, EngineQueue, Id, JobStep, JobVariant, Paid, SampleState, Scan, StepStatus, StopDetail, StopReason, SwapPhotos, Template, TemplateStatus, TemplateSwap, VariantStatus,
} from '../ports';
import {
  addPaid, PREPARATION_NOTES, regenOf, SCAN_REASONS, STOP_DETAILS, STOP_REASONS, subtractPaid, toCandidateRow, toRunRow, toScanRow, toTemplateRow, ZERO,
} from './rows';
import type { Card, CardShot, Health, Raw, RunInput, RunRow, Settings, Step, TemplateRow, VariantState } from './rows';
import { ownStore, photographsOf, swapFolderKept, sweepSwapPhotos, sweepSwapVideos } from './swap-photos';
import { sweepUploads, UPLOAD_PATH, uploaderOf, videoUploadOf, videoUploadTitle } from './uploads';

// The production system read from, and handed work through, the worker's SQLite database (`<VC_DATA_DIR>/db.sqlite`).
// The worker creates and migrates the database; the site writes only what "Who writes what" in the plan gives it:
// new runs, `runs.approved/state` on a resume, `templates.state/card/times_generated`, `candidates.state` (reject), `settings`.
// Files: the site deletes the folder `jobs/<runId>/` of a run that is finished (done or stopped) when its job is closed (B17) or
// deleted (B18); never the folder of a run that is held, queued or running.

const fs = (): typeof Fs => process.getBuiltinModule('node:fs');
const path = (): typeof Path => process.getBuiltinModule('node:path');
const sqlite = (): typeof Sqlite => process.getBuiltinModule('node:sqlite');

const SWAP_PROVIDER_STATES = ['fake', 'ready', 'not-configured'] as const;
/** A worker that wrote no health for this long is down (it writes every 30 s). */
const HEALTH_FRESH_MS = 90_000;
/**
 * Ruling: a held run is an orphan only when its last hand-over (`updated_at`) is older than this. A live hand-over (start or resume tx
 * -> site.json -> `committed()`) takes milliseconds; five minutes leaves room for a slow disk or a stalled save, and a crash orphan
 * waits at most this long for its settlement (the next opening or, in a running process, the next `refresh` / `health` after it).
 */
export const ORPHAN_AGE_MS = 5 * 60_000;
const LOCK_FILE = 'site.lock';
const STEP_KEYS = ['adaptation', 'images', 'clips', 'music', 'edit', 'render'] as const;
/** The steps of a person swap (`viraleditor/src/swap`): its parts, their join, the sound and the label. */
const SWAP_STEP_KEYS = ['clips', 'edit', 'render'] as const;

/** The engine's defaults (`viraleditor/src/db/settings.ts`): a missing field of the stored JSON reads as these. */
const DEFAULT_SETTINGS: Settings = {
  scanTimes: ['09:00', '15:00', '21:00'], sources: { topads: true, shorts: true }, searches: [], threshold: 70,
  dailyCandidates: 45, dailyTemplates: 10, secondsMin: 6, secondsMax: 35, shortsMinViews: 500000, topAdsCards: 30, topAdsIndustry: 'beauty-personal-care', topAdsCountry: 'US', topAdsPeriod: 7, perScan: 15,
  tiers: { fast: { model: 'seedance-2-mini', resolution: '720p' }, best: { model: 'seedance-2.5-pro', resolution: '1080p' } },
};
const SETTING_KEYS = [
  'scanTimes', 'threshold', 'dailyCandidates', 'dailyTemplates', 'providerAccount',
  'sources', 'searches', 'secondsMin', 'secondsMax', 'shortsMinViews', 'topAdsCards', 'topAdsIndustry', 'topAdsCountry', 'topAdsPeriod', 'perScan',
] as const satisfies readonly (keyof AdminSettings)[];

/** The identity is canonicalised locally; no downloader, scene detector or model is involved. */
function sourceIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (['instagram.com', 'www.instagram.com'].includes(url.hostname)) {
      const match = /^\/reels?\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
      return match ? `https://www.instagram.com/reel/${match[1]}/` : null;
    }
    return value;
  } catch { return null; }
}

/** YYYY-MM-DD in local time: the key of the worker's `usage` (the same day as `viraleditor/src/prepare`'s). */
function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const iso = (): string => now().toISOString();
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** One BEGIN IMMEDIATE transaction: the worker's writes wait for it, and it waits for theirs (busy_timeout). */
function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** A data path as the site links it: every file of the data directory is served by `/media` (which decides who may see it). */
const media = (relative: string | null): string | null => (relative ? `/media/${relative}` : null);

/** The shots without their frames: what the admin's form knows of them, and what tells whether an edit changed them. */
const plainShots = (shots: readonly (Shot | CardShot)[]): Omit<Shot, 'image'>[] => shots.map(({ image: _frame, ...shot }) => shot);

/** The shots as the form sent them, each with the frame (a data path) the stored shot of the same number has, unless it was moved in time. */
const keepFrames = (sent: readonly Shot[], stored: readonly CardShot[]): CardShot[] => plainShots(sent).map((shot) => {
  const was = stored.find((s) => s.n === shot.n);
  return was?.image && was.from === shot.from && was.to === shot.to ? { ...shot, image: was.image } : shot;
});

/**
 * A row that cannot be read is skipped and named in the log, once per row and process: one broken row must not take a page down,
 * nor fill the log on every page view. Only the id is logged: the parser's message would quote the row's text (a user's link).
 */
function reader<T>(what: string, read: (r: Raw) => T, logged: Set<string>): (r: Raw) => T | null {
  return (r) => {
    try {
      return read(r);
    } catch {
      const key = `${what}:${String(r.id)}`;
      if (!logged.has(key)) {
        logged.add(key);
        console.error(`${what}-row-unreadable: ${String(r.id)}`);
      }
      return null;
    }
  };
}

/**
 * What makes a card a person-swap video (the engine's `Card.swap`), or null:
 * a card without it, or with one that has no lists of people and parts.
 */
function swapOf(card: Card): TemplateSwap | null {
  const { swap } = card;
  return swap && typeof swap === 'object' && Array.isArray(swap.persons) && Array.isArray(swap.parts) ? swap : null;
}

/**
 * Row → the site's template. `published` → published; `hidden` → hidden; a catalog row that is `ready` → waiting (for the admin);
 * a row with an owner → private, its state as `preparation`. A catalog row that is being prepared, or failed, waits too, with its
 * `preparation`. `note` is a reason on a `failed` row only (a `preparing` row may carry the worker's mark `unit-taken`);
 * on any other row only `check-failed` (an admin edit that was not taken over) is shown.
 * A person-swap video has no shots: it is whole when it has its people and its parts. `swapPeople`: where the admin's work on its
 * people stands (`Template.swapPeople`), read from its runs by the caller.
 */
export function toTemplate(row: TemplateRow, sample: SampleState, swapPeople?: Template['swapPeople']): Template {
  const own = row.owner !== null;
  const status: TemplateStatus = own ? 'private' : row.state === 'published' ? 'published' : row.state === 'hidden' ? 'hidden' : 'waiting';
  const swap = swapOf(row.card);
  const empty = swap ? swap.persons.length === 0 || swap.parts.length === 0 : row.card.shots.length === 0;
  const incomplete = row.state === 'ready' && (!(row.card.seconds > 0) || empty);
  const preparation = incomplete ? 'failed' : row.state === 'preparing' ? 'preparing' : row.state === 'failed' ? 'failed' : own ? 'ready' : null;
  const known = PREPARATION_NOTES.find((note) => note === row.note) ?? null;
  const card: Card = row.card;
  return {
    id: row.id, title: row.sourceKind === 'upload' && card.title === 'Uploaded video' ? 'video.mp4' : card.title, category: card.category ?? '', format: card.format === 'talking' ? 'talking' : 'no-talking',
    seconds: card.seconds ?? 0, referenceViews: card.referenceViews ?? '', referenceLikes: null, referenceMetric: card.referenceMetric ?? (row.sourceKind === 'topads' ? { kind: 'likes', count: 0 } : undefined), referenceImage: media(card.referenceImage ?? null), referenceVideo: media(card.referenceVideo ?? null), image: media(card.image) ?? '', video: media(card.video),
    products: card.products, shots: card.shots.map((shot) => ({ ...shot, ...(shot.image ? { image: media(shot.image) } : {}) })), status, ownerId: row.owner,
    timesGenerated: row.timesGenerated, editedAt: row.updatedAt,
    source: row.sourceKind === 'topads' || row.sourceKind === 'shorts' ? row.sourceKind : 'link',
    description: card.description ?? '', tags: [...(card.tags ?? [])], preparation,
    preparationNote: incomplete ? 'check-failed' : row.state === 'failed' ? known : known === 'check-failed' ? known : null, sample,
    ...(swap ? { swap } : {}),
    ...(swap && swapPeople ? { swapPeople } : {}),
  };
}

/** 1 234 567 → "1.2M": how the site writes view counts. */
function views(count: number | null): string {
  if (count === null) return '';
  const short = (value: number, unit: string) => `${(Math.round(value * 10) / 10).toString()}${unit}`;
  if (count >= 1_000_000) return short(count / 1_000_000, 'M');
  if (count >= 1_000) return short(count / 1_000, 'K');
  return String(count);
}

/** Steps of a job the worker has not begun: everything waits. The totals are the approved requests. A person swap has its own three. */
function waitingSteps(approved: Paid, swap = false): JobStep[] {
  return (swap ? SWAP_STEP_KEYS : STEP_KEYS).map((key) => ({ key, status: 'waiting', done: 0, total: key === 'images' ? approved.images : key === 'clips' ? approved.clips : 1 }));
}

/** The steps of a run as the job shows them. A run that waits (held, queued) after a stop shows its stopped step as waiting. */
function stepsOf(run: RunRow, fallback: JobStep[]): JobStep[] {
  if (run.steps.length === 0) return fallback;
  const waiting = run.state === 'held' || run.state === 'queued';
  return run.steps.map((step: Step) => ({ ...step, status: waiting && step.status !== 'done' ? 'waiting' : step.status }));
}

/** How many videos the worker makes at the same time: `VC_WORKER_PRODUCE` from 1 to 6; anything else (or nothing) is one. */
const produceLanes = (): number => (/^[1-6]$/.test(process.env.VC_WORKER_PRODUCE?.trim() ?? '') ? Number(process.env.VC_WORKER_PRODUCE?.trim()) : 1);
/** Minutes of a video whose template cannot say (the estimate of a video without speech). */
const UNKNOWN_MINUTES = 7;
/** The share of a run's work still to do, as the steps say it (the way the video list reads it). */
const shareLeft = (steps: Step[]): number => steps.length === 0 ? 1 : steps.reduce((sum, step) => sum + (step.total ? 1 - step.done / step.total : 0), 0) / steps.length;

/**
 * The videos in front of a run that waits, and the minutes until it starts: each lane holds the video being made until it is done, and the
 * waiting videos in front take the lane that frees first, in their order. `making` are the minutes left of each video being made, `waiting`
 * the whole minutes of each video in front that has not begun.
 */
function lineOf(making: number[], waiting: number[], lanes: number): EngineQueue {
  const free = [...making, ...Array<number>(Math.max(0, lanes - making.length)).fill(0)];
  for (const minutes of waiting) free[free.indexOf(Math.min(...free))]! += minutes;
  return { ahead: making.length + waiting.length, waitMinutes: Math.ceil(Math.min(...free)) };
}

const reasonOf = (reason: string | null): StopReason => STOP_REASONS.find((code) => code === reason) ?? 'engine-error';
/** Only a code the screens explain; anything else (or none) is `null`. */
const detailOf = (detail: string | null): StopDetail | null => STOP_DETAILS.find((code) => code === detail) ?? null;

/** The worker's word for a variant that is being made is `running`; the site's is `generating`. */
const VARIANT_STATUS: Record<StepStatus, VariantStatus> = { waiting: 'waiting', running: 'generating', done: 'done', stopped: 'stopped' };

/**
 * Variant `n` of a run as the site shows it (B2): delivered (the worker's finished variant, else the run's result) → done with its
 * files; a run that waits (held, queued) → `waiting`; a run that ended → `stopped` with the variant's reason (else the run's);
 * else the worker's status. A regeneration (`regen`) that has not ended is `generating` all the time, also while the worker has
 * not written its variant yet (run `running`, variants empty or `waiting`): the customer paid for it, and the site follows only
 * what it sees as `generating`.
 */
function variantOf(id: Id, run: RunRow, n: number, regen: boolean): JobVariant {
  const state: VariantState | undefined = run.variants.find((variant) => variant.n === n);
  const result = run.state === 'done' && run.result?.kind === 'produce' ? run.result.variants[n - 1] : undefined;
  const delivered = state?.status === 'done' && state.video ? { video: state.video, image: state.image } : result;
  if (delivered) return { id, image: media(delivered.image) ?? '', video: media(delivered.video), status: 'done', reason: null };
  const pending = { id, image: '', video: null };
  if (run.state === 'held' || run.state === 'queued') return { ...pending, status: regen ? 'generating' : 'waiting', reason: null };
  if (run.state === 'done' || run.state === 'stopped' || state?.status === 'stopped') {
    return { ...pending, status: 'stopped', reason: reasonOf(state?.reason ?? run.reason) };
  }
  const status = VARIANT_STATUS[state?.status ?? 'waiting'];
  return { ...pending, status: status === 'done' || (regen && status === 'waiting') ? 'generating' : status, reason: null };   // done without a file yet: still being made
}

/** Every variant of a job's own run. */
const variantsOf = (job: JobRecord, run: RunRow): JobVariant[] =>
  Array.from({ length: job.input.variants }, (_, index) => variantOf(`${job.id}-v${index + 1}`, run, index + 1, false));

/**
 * A regeneration (B2) is a produce run of ONE variant whose `ref` is `<jobId>/<variantId>/<runId>`: `runs_once` makes a job's own
 * run unique on its id, and a variant may be generated again more than once. Its files are the run's `v1`.
 */
const regenRef = (jobId: Id, variantId: Id, runId: string): string => `${jobId}/${variantId}/${runId}`;

const ACTIVE = new Set(['held', 'queued', 'running']);
/** A run's own folder (`jobs/<runId>/`); a run id is the site's or the worker's UUID. */
const RUN_ID = /^[A-Za-z0-9-]+$/;

/** The engine of one data directory: one connection, and the runs this process has handed over and not released yet. */
interface Instance { engine: Engine; close(): void }

/**
 * A job as `site.json` holds it: its status, the mark (`resumedAt`) the engine put on it when it last resumed the job, and the marks
 * (`variantRuns`: variant id → time) it put on it when it generated a variant again.
 */
interface SavedJob { status: string; resumedAt: string | null; variantRuns: Record<string, unknown> }

/**
 * The jobs of the site's store as it is on disk (`site.json`): id -> what is saved. Empty when there is no file yet; null when it
 * cannot be read (then nothing is settled: the site will not start on a broken store anyway, see mock/persist.ts).
 */
function savedJobs(dir: string): Map<string, SavedJob> | null {
  let text: string;
  try {
    text = fs().readFileSync(path().join(dir, 'site.json'), 'utf8');   // the store of this data directory (mock/persist.ts siteFile)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? new Map() : null;
  }
  try {
    const jobs = (JSON.parse(text) as { jobs?: { id?: unknown; status?: unknown; resumedAt?: unknown; variantRuns?: unknown }[] }).jobs ?? [];
    return new Map(jobs.map((job) => [String(job.id), {
      status: String(job.status), resumedAt: typeof job.resumedAt === 'string' ? job.resumedAt : null,
      variantRuns: typeof job.variantRuns === 'object' && job.variantRuns !== null ? job.variantRuns as Record<string, unknown> : {},
    }]));
  } catch {
    return null;
  }
}

/** Whether a process of this pid exists (a process of another user answers EPERM: it exists). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * One site process per data directory settles and sweeps: `<dir>/site.lock` holds its pid. A lock of a process that is gone is taken
 * over. Another live holder prevents this site from starting or writing its store.
 */

function giveLock(dir: string): void {
  const file = path().join(dir, LOCK_FILE);
  try {
    if (fs().readFileSync(file, 'utf8') === String(process.pid)) fs().unlinkSync(file);
  } catch { /* not there */ }
}

/** `site.json.<pid>.tmp` of a process that died in the middle of a save. */
function cleanTemps(dir: string): void {
  try {
    for (const name of fs().readdirSync(dir)) {
      const pid = /^site\.json\.(\d+)\.tmp$/.exec(name)?.[1];
      if (pid !== undefined && !alive(Number(pid))) fs().unlinkSync(path().join(dir, name));
    }
  } catch { /* a leftover that stays is harmless */ }
}

function open(dir: string): Instance {
  assertSiteOwner(dir);
  const file = path().join(dir, 'db.sqlite');
  // The worker makes and migrates the database. The site does not create an empty one in a folder that may be the wrong one.
  if (!fs().existsSync(file)) throw new Error(`engine-db-missing: ${file} (start the worker once: it creates the database)`);
  const db = new (sqlite().DatabaseSync)(file);
  db.exec('PRAGMA busy_timeout = 5000');
  if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'runs'`).get()) {
    db.close();
    throw new Error(`engine-db-not-migrated: ${file} (start the worker once: it creates the tables)`);
  }
  const logged = new Set<string>();
  const guard = { locked: true };
  cleanTemps(dir);
  if (guard.locked) {
    settleSaved(db, dir, logged, new Set());
    try {
      const retired = sweepMedia(dir, db);
      if (retired.failed) console.error(`media-retirement-pending: ${retired.failed}`);
      sweepUploads(dir, (folder) => swapFolderKept(dir, folder) || db.prepare("SELECT 1 FROM runs WHERE instr(input, ?) > 0 OR (json_valid(input) AND json_extract(input, '$.from.uploadId') = ?) LIMIT 1").get(folder, folder.split('/')[1] ?? '') !== undefined);
    } catch (error) {
      console.error(`uploads-sweep-failed: ${messageOf(error)}`);
    }
  } else {
    console.error(`engine-settlement-skipped: another site process holds ${LOCK_FILE} in ${dir}`);
  }
  return { engine: makeEngine(db, dir, logged, guard), close: () => { db.close(); if (guard.locked) giveLock(dir); } };
}

/** Only a durable own-template record with its exact charge authorises preparation. */
function savedOwnTemplates(dir: string): Map<string, string> {
  const own = new Map<string, string>();
  try {
    const site = JSON.parse(fs().readFileSync(path().join(dir, 'site.json'), 'utf8')) as { ownTemplates?: { templateId: string; userId: string; chargeEntryId: string }[]; ledger?: { id: string; userId: string; change: number }[] };
    for (const record of site.ownTemplates ?? []) if (site.ledger?.some(entry => entry.id === record.chargeEntryId && entry.userId === record.userId && entry.change < 0)) own.set(record.templateId, record.userId);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return own;
}

/** `settleOrphans` with the store on disk (nothing is settled when it cannot be read). */
function settleSaved(db: DatabaseSync, dir: string, logged: Set<string>, skip: ReadonlySet<string>): void {
  const saved = savedJobs(dir);
  if (saved) {
    let own: Map<string, string>;
    try { own = savedOwnTemplates(dir); } catch { return; }
    settleOrphans(db, saved, logged, skip, own);
  }
  else console.error('engine-orphans-not-settled: site.json cannot be read');
}

/**
 * A `held` run older than `ORPHAN_AGE_MS` was handed over by a process that did not get to `committed()`. (A younger one may be a
 * live hand-over of another process; `skip` holds the runs this very process has handed over and not released yet.)
 * The site's saved store (`site.json`) says which side of the commit point it was on:
 * - its job is in the saved store, and the run is a start: the save happened (only `committed()` failed or never ran): `queued`.
 * - the run is a resume (the worker stopped it before: `reason` or `missing` is set): it is released only when the saved job is
 *   `running` and carries the mark of THIS resume (`resumedAt` = the run's `updated_at`, written together by `resume`). A status
 *   alone can be a stale save of an earlier run. Otherwise it goes back to `stopped` with what it approved taken off again.
 * - the run is a regeneration of a variant (B2): it is released only when the saved job carries ITS mark
 *   (`variantRuns[variant]` = the run's `updated_at`, written together by `regenerateVariant`); otherwise it is deleted, as a start.
 * - its job is not in the saved store: the site died before saving. A start that never ran (no operation) is deleted, and the job
 *   it counted on its template is taken off again (a regeneration counted nothing); a run with operations is stopped with `engine-error`.
 * A row that cannot be read is left as it is and logged.
 */
export function settleOrphans(db: DatabaseSync, saved: Map<string, SavedJob>, logged: Set<string> = new Set(), skip: ReadonlySet<string> = new Set(), savedOwn: ReadonlyMap<string, string> = new Map()): void {
  const read = reader('run', toRunRow, logged);
  tx(db, () => {
    for (const raw of db.prepare(`SELECT * FROM runs WHERE state = 'held'`).all()) {
      const run = read(raw);
      if (!run || skip.has(run.id) || now().getTime() - Date.parse(run.updatedAt) < ORPHAN_AGE_MS) continue;   // an unreadable time is "old"
      const t = iso();
      if (run.input.kind === 'prepare') {
        if (run.input.ownerId !== null && savedOwn.get(run.input.templateId) === run.input.ownerId) {
          db.prepare("UPDATE runs SET state = 'queued', updated_at = ? WHERE id = ? AND state = 'held'").run(t, run.id);
        } else {
          db.prepare("UPDATE runs SET state = 'stopped', reason = 'engine-error', updated_at = ? WHERE id = ? AND state = 'held'").run(t, run.id);
          db.prepare("UPDATE templates SET state = 'failed', note = 'check-failed', updated_at = ? WHERE id = ? AND state = 'preparing'").run(t, run.input.templateId);
        }
        continue;
      }
      const regen = run.kind === 'produce' ? regenOf(run.ref) : null;
      const job = run.kind === 'produce' ? saved.get(regen?.jobId ?? run.ref) : undefined;
      const resumed = regen === null && (run.reason !== null || run.missing !== null);
      const back = () => db.prepare(`UPDATE runs SET state = 'stopped', approved = ?, updated_at = ? WHERE id = ? AND state = 'held'`)
        .run(JSON.stringify(subtractPaid(run.approved, run.missing)), t, run.id);
      const released = job !== undefined && (regen !== null
        ? job.variantRuns[regen.variantId] === run.updatedAt
        : !resumed || (job.status === 'running' && job.resumedAt === run.updatedAt));
      if (released) {
        db.prepare(`UPDATE runs SET state = 'queued', updated_at = ? WHERE id = ? AND state = 'held'`).run(t, run.id);
      } else if (resumed) {
        back();
      } else if (db.prepare('SELECT 1 FROM operations WHERE run_id = ? LIMIT 1').get(run.id) !== undefined) {
        db.prepare(`UPDATE runs SET state = 'stopped', reason = 'engine-error', updated_at = ? WHERE id = ? AND state = 'held'`).run(t, run.id);
      } else {
        db.prepare(`DELETE FROM runs WHERE id = ? AND state = 'held'`).run(run.id);
        if (run.input.kind === 'produce' && !run.input.sample && regen === null) {
          db.prepare('UPDATE templates SET times_generated = MAX(0, times_generated - 1) WHERE id = ?').run(run.input.templateId);
        }
      }
      console.error(`engine-orphan-settled: run ${run.id}`);
    }
  });
}

function makeEngine(db: DatabaseSync, dir: string, logged: Set<string>, guard: { locked: boolean }): Engine & { freeShareOpen(approved: Paid): boolean } {
  /** Handed over by `start` / `resume` of this process, waiting for `committed()`. */
  const handedOver = new Set<string>();
  /** A process that stays up for weeks settles again after each window (a crash orphan may be younger than the window at opening). */
  let settledAt = now().getTime();
  const settleLater = (): void => {
    if (now().getTime() - settledAt < ORPHAN_AGE_MS) return;
    settledAt = now().getTime();
    guard.locked ||= takeLock(dir);
    if (guard.locked) {
      settleSaved(db, dir, logged, handedOver);
      sweepSwap();                                                         // before the retirement: what must be deleted is not moved aside first
      try {
        const retired = sweepMedia(dir, db);
        if (retired.failed) console.error(`media-retirement-pending: ${retired.failed}`);
      } catch { console.error('media-retirement-failed'); }
    }
  };
  const readTemplate = reader('template', toTemplateRow, logged);
  const readRun = reader('run', toRunRow, logged);

  const templateRow = (id: Id): TemplateRow | null => {
    const raw = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
    return raw ? readTemplate(raw) : null;
  };
  const mustTemplate = (id: Id): TemplateRow => {
    const row = templateRow(id);
    if (!row) throw new NotFoundError('template');
    return row;
  };
  /**
   * The ids of the shots of a template, in the order of its card (the card has no ids; the worker's requests are named by them). Undefined
   * when the template's own file cannot say it: missing, broken, not as many shots as the card, or a shot that continues another (it has no
   * box of its own, so which box a shot is cannot be told).
   */
  const shotIdsOf = (templateId: Id, count: number): string[] | undefined => {
    try {
      if (!/^[a-zA-Z0-9_-]+$/.test(templateId)) return undefined;
      const root = fs().realpathSync(path().join(dir, 'templates'));
      const file = fs().realpathSync(path().join(root, templateId, 'template.json'));
      if (!file.startsWith(root + path().sep) || fs().statSync(file).size > 2 * 1024 * 1024) return undefined;
      const shots: unknown = JSON.parse(fs().readFileSync(file, 'utf8'))?.shots;
      if (!Array.isArray(shots) || shots.length !== count) return undefined;
      const ids = shots.map((shot) => (shot && typeof shot === 'object' && typeof shot.id === 'string' && shot.continues === undefined ? shot.id : null));
      return ids.every((id): id is string => id !== null) && new Set(ids).size === count ? ids : undefined;
    } catch { return undefined; }
  };
  /** The `/media` path of a finished request's file, when the request recorded one in this run's own folder of this variant; else null (the file is not shown, whatever it is called). */
  const madeFile = (runId: string, variant: number, output: string | null): string | null =>
    isJobFile(runId, output) && output.includes(`/paid/v${variant}/`) ? media(output) : null;
  /**
   * What the worker has made of the run `runId`, from its finished requests (`v<k>:image:<shot id>`, `v<k>:clip:<shot id>`, `v<k>:music`; a
   * resend is `…#2`). The files are the ones the requests recorded: a name decides nothing. The boxes of the page are the run's clips; they
   * are the template's shots only when every shot owns a clip, so for any other template (or one that is gone) it cannot be told which box
   * a shot is, nor which picture is a shot's: `shots` is undefined and no picture is called shared. A shot is the box of its place in the
   * template, whatever its id is called. A shared picture (a still, the presenter) is no shot.
   */
  const madeOf = (job: JobRecord, runId: string): { shots: JobShot[] | undefined; made: JobMade } => {
    const boxes = job.steps.find((step) => step.key === 'clips')?.total ?? 0;
    const shotCount = templateRow(job.templateId)?.card.shots.length ?? 0;
    const ids = shotCount > 0 && shotCount * job.input.variants === boxes ? shotIdsOf(job.templateId, shotCount) : undefined;
    const found = new Map<string, JobShot>();
    const made: JobMade = { music: [], shared: [] };
    const rows = db.prepare(`SELECT key, kind, output FROM operations WHERE run_id = ? AND state = 'done' AND kind IN ('image', 'clip', 'music') ORDER BY key`).all(runId) as { key: string; kind: string; output: string | null }[];
    for (const row of rows) {
      const match = /^v([1-9]):(image|clip|music)(?::([a-z][a-z0-9-]{0,23}))?(?:#\d+)?$/.exec(row.key);
      if (!match) continue;
      const [variant, id] = [Number(match[1]), match[3]];
      if (variant > job.input.variants) continue;
      const url = madeFile(runId, variant, row.output);
      if (row.kind === 'music') { if (id === undefined && url) made.music.push({ variant, url }); continue; }
      if (id === undefined || !ids) continue;
      const n = ids.indexOf(id) + 1;
      if (n === 0) { if (row.kind === 'image' && url) made.shared.push({ variant, url }); continue; }
      const key = `v${variant}:${n}`;
      const shot = found.get(key) ?? { variant, n, image: null, clip: false, clipUrl: null };
      if (row.kind === 'clip') { shot.clip = true; shot.clipUrl = url; } else shot.image = url;
      found.set(key, shot);
    }
    const byVariant = (a: MadeFile, b: MadeFile) => a.variant - b.variant;
    made.music.sort(byVariant); made.shared.sort(byVariant);
    return { shots: ids && [...found.values()].filter((shot) => shot.image !== null || shot.clip).toSorted((a, b) => a.variant - b.variant || a.n - b.n), made };
  };
  const madeUnreadable = new Set<Id>();                                    // logged once for each job, the page refreshes every few seconds
  const produceRun = (jobId: Id): RunRow | null => {
    const raw = db.prepare(`SELECT * FROM runs WHERE kind = 'produce' AND ref = ?`).get(jobId);
    return raw ? readRun(raw) : null;
  };
  /** The line of a run that has not begun (held, queued); null for a run the worker has taken, finished or stopped. */
  const lineBehind = (run: RunRow): EngineQueue | null => {
    if (run.state !== 'held' && run.state !== 'queued') return null;
    const raws = db.prepare(
      `SELECT * FROM runs WHERE kind = 'produce' AND id <> ? AND (state = 'running' OR (state IN ('held', 'queued')
         AND (created_at < ? OR (created_at = ? AND rowid < (SELECT rowid FROM runs WHERE id = ?))))) ORDER BY created_at, rowid`,
    ).all(run.id, run.createdAt, run.createdAt, run.id);
    const ahead = raws.map((raw) => readRun(raw)).filter((row): row is RunRow => row !== null && row.input.kind === 'produce');
    const wholeMinutes = (row: RunRow) => {
      const input = row.input;
      return input.kind === 'produce' ? (templateRow(input.templateId)?.minutes ?? UNKNOWN_MINUTES) * input.variants : 0;
    };
    return lineOf(
      ahead.filter((row) => row.state === 'running').map((row) => wholeMinutes(row) * shareLeft(row.steps)),
      ahead.filter((row) => row.state !== 'running').map(wholeMinutes),
      produceLanes(),
    );
  };
  budgetSchema(db);
  // K2: the budget keys (job ids) of the jobs started on the free video. The site's own table: the worker does not read it.
  db.exec('CREATE TABLE IF NOT EXISTS free_budget (run_id TEXT PRIMARY KEY)');
  /** No spending cap: the worker would stop the job, so refuse it before any credit is taken. Null when the provider needs no caps. */
  const capsOrRefuse = () => {
    if (process.env.VC_PROVIDER !== 'magnific') return null;
    let caps;
    try { caps = providerCaps(process.env); } catch (error) {
      console.error('provider-caps-invalid: VC_PROVIDER_DAILY_CAP, VC_PROVIDER_JOB_CAP');
      throw error;
    }
    if (!caps) {
      console.error('provider-caps-missing: VC_PROVIDER_DAILY_CAP, VC_PROVIDER_JOB_CAP');
      throw new Error('provider-cap');
    }
    return caps;
  };
  /**
   * Do `units` more fit the quarter of the daily cap the free jobs of the UTC day may hold? A finished job counts for what it consumed,
   * also before `releaseTerminal` wrote that. Reads only (B1: the estimate asks too).
   */
  const freeShareFits = (daily: number, units: number, at: Date): boolean => {
    const held = (db.prepare(`SELECT COALESCE(SUM(CASE WHEN run_id IN (SELECT ref FROM runs WHERE kind = 'produce' AND state IN ('done', 'closed'))
      THEN MIN(reserved, consumed) ELSE reserved END), 0) AS n FROM provider_budget WHERE day = ? AND run_id IN (SELECT run_id FROM free_budget)`)
      .get(at.toISOString().slice(0, 10)) as { n: number }).n;
    return (held + units) * 4 <= daily;
  };
  /**
   * K2: what the jobs started on the free video reserve in a UTC day (the day of the cap) stays within a quarter of the provider's
   * daily cap; a start that would pass it is refused (`free-video-cap`) before anything is reserved. The caller owns the transaction.
   */
  const freeShareOrRefuse = (daily: number, id: string, units: number, at: Date): void => {
    releaseTerminal(db);                                                   // as `reserveProvider` does: a finished job counts for what it consumed
    if (!freeShareFits(daily, units, at)) throw new Error('free-video-cap');
    db.prepare('INSERT OR IGNORE INTO free_budget (run_id) VALUES (?)').run(id);
  };
  const reserve = (id: string, paid: Paid | null, free = false): void => {
    const caps = capsOrRefuse();
    if (!caps) return;
    const units = paid ? providerUnits(paid) : 1, at = now();
    if (free) freeShareOrRefuse(caps.daily, id, units, at);
    reserveProvider(db, caps, id, units, at);
  };
  const insertRun = (
    input: RunInput, ref: string, state: 'held' | 'queued', approved: Paid | null, t = iso(), id: string = crypto.randomUUID(), free = false,
  ): { id: string; inserted: boolean } => {
    const inserted = db.prepare(
      `INSERT OR IGNORE INTO runs (id, kind, ref, state, input, approved, steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
    ).run(id, input.kind, ref, state, JSON.stringify(input), approved ? JSON.stringify(approved) : null, t, t).changes > 0;
    if (inserted && (input.kind === 'produce' || input.kind === 'prepare')) {
      const budgetId = input.kind === 'produce' ? ref : id;
      if (!db.prepare('SELECT 1 FROM provider_budget WHERE run_id = ? LIMIT 1').get(budgetId)) reserve(budgetId, approved, free);
    }
    return { id, inserted };
  };
  /**
   * B11: no sample video → `none`. Otherwise the sample is `outdated` when an edit changed the shots (`shotsChanged`, the site's mark
   * on its edit run) and the latest sample that finished does not show it: the edit is still to be taken over, or it was taken over
   * after that sample run was handed over (the worker takes no edit while a produce run waits), or there is no finished sample run (a
   * seeded sample). An edit the worker refused (`ok: false`, the card went back) changed nothing.
   */
  const sampleOf = (row: TemplateRow): SampleState => {
    if (!row.card.video) return 'none';
    const made = db.prepare(
      `SELECT created_at FROM runs WHERE kind = 'produce' AND state = 'done' AND json_extract(input, '$.templateId') = ?
         AND json_extract(input, '$.sample') = 1 ORDER BY created_at DESC LIMIT 1`,
    ).get(row.id) as { created_at: string } | undefined;
    const edits = db.prepare(`SELECT state, result, updated_at, created_at FROM runs WHERE kind = 'edit' AND ref = ? AND json_extract(input, '$.shotsChanged') = 1`)
      .all(row.id) as { state: string; result: string | null; updated_at: string; created_at: string }[];
    const outdated = edits.some((edit) => {
      let refused = false;
      try { refused = edit.result !== null && (JSON.parse(edit.result) as { ok?: unknown }).ok === false; } catch { /* unreadable: counts */ }
      const settled = edit.state === 'done' || edit.state === 'stopped';
      return !refused && !(settled && made !== undefined && edit.updated_at <= made.created_at);
    });
    const dirty = db.prepare('SELECT sample_changed_at FROM templates WHERE id = ?').get(row.id) as { sample_changed_at: string | null };
    const changedAt = dirty?.sample_changed_at;
    const refused = changedAt && edits.some(edit => edit.created_at === changedAt && edit.result !== null && (() => { try { return JSON.parse(edit.result).ok === false; } catch { return false; } })());
    const stale = outdated || Boolean(changedAt && !refused && (!made || changedAt > made.created_at || edits.some(edit => edit.state !== 'done' && edit.state !== 'stopped')));
    if (!stale && changedAt) db.prepare('UPDATE templates SET sample_changed_at = NULL WHERE id = ? AND sample_changed_at = ?').run(row.id, changedAt);
    return stale ? 'outdated' : 'current';
  };
  /**
   * Where the people of a person-swap video stand (`Template.swapPeople`), from its runs: an edit that carries people and waits for
   * the worker → `pending`; else, a preparation that suggested none (the `detail` of its run) and no such edit the worker took →
   * `unset`. A product template: nothing.
   */
  const swapPeopleOf = (row: TemplateRow): Template['swapPeople'] => {
    if (!swapOf(row.card)) return undefined;
    const edits = db.prepare(`SELECT state, result FROM runs WHERE kind = 'edit' AND ref = ? AND json_extract(input, '$.swap') IS NOT NULL`)
      .all(row.id) as { state: string; result: string | null }[];
    if (edits.some((edit) => edit.state === 'queued' || edit.state === 'running')) return 'pending';
    const taken = edits.some((edit) => {
      try { return edit.result !== null && (JSON.parse(edit.result) as { ok?: unknown }).ok === true; } catch { return false; }
    });
    if (taken) return undefined;
    const prepared = db.prepare(`SELECT detail FROM runs WHERE kind = 'prepare' AND ref = ? ORDER BY created_at DESC, id DESC LIMIT 1`).get(row.id) as { detail: string | null } | undefined;
    return prepared?.detail?.startsWith('no-suggestion:') ? 'unset' : undefined;
  };
  const show = (row: TemplateRow): Template => {
    const shown = toTemplate(row, sampleOf(row), swapPeopleOf(row));
    // Prepared source metrics, never model/card guesses. Confine both the id and resolved file to this data directory.
    try {
      if (!/^[a-zA-Z0-9_-]+$/.test(row.id)) return shown;
      const dataRoot = fs().realpathSync(dir);
      const root = fs().realpathSync(path().join(dir, 'templates'));
      if (!root.startsWith(dataRoot + path().sep)) return shown;
      const file = fs().realpathSync(path().join(root, row.id, 'template.json'));
      if (!file.startsWith(root + path().sep) || fs().statSync(file).size > 2 * 1024 * 1024) return shown;
      const metrics = JSON.parse(fs().readFileSync(file, 'utf8'))?.source?.metrics;
      const { views: sourceViews, likes } = metrics ?? {};
      const views = sourceViews;
      const kind = shown.source === 'topads' ? 'likes' : 'views';
      const count = metrics?.[kind];
      if (typeof count === 'number' && Number.isFinite(count)) shown.referenceMetric = { kind, count };
      if (typeof views === 'number' && Number.isFinite(views) && views > 0 && typeof likes === 'number' && Number.isFinite(likes) && likes >= 0 && likes <= views)
        shown.referenceLikes = `${Math.round(likes / views * 1000) / 10}%`;
    } catch { /* Missing/old/broken metrics remain unknown. */ }
    return shown;
  };
  /**
   * What a produce run of this job gets: the template must be ready or published, every photo an upload of the job's owner.
   * `variants`: the job's, or 1 for a regeneration. `ownerId`: the job's owner, for the order of the worker's produce lane.
   */
  const produceInput = (job: JobRecord, sample: boolean, variants: 1 | 2 | 3): RunInput => {
    const row = mustTemplate(job.templateId);
    const swap = swapOf(row.card);
    // A person swap runs on a person-swap video only, and such a video makes nothing else.
    const fits = job.swap ? swap !== null && swap.parts.length > 0 : swap === null && row.card.shots.length > 0;
    if (!['ready', 'published'].includes(row.state) || !row.estimate || !(row.card.seconds > 0) || !fits) throw new Error('template-not-ready');
    if (job.swap && swap) {
      // One entry for each slot of the video, every photograph a stored upload of the job's owner: the worker is handed nobody else's picture.
      const people = job.swap.people.map(({ slot, body, face, side }): SwapPhotos => ({ slot, body, face, ...(side == null ? {} : { side }) }));
      const slots = swap.persons.map((person) => person.slot);
      const photos = people.flatMap(photographsOf);
      const onePerSlot = people.length === slots.length && slots.every((slot) => people.filter((person) => person.slot === slot).length === 1);
      if (!onePerSlot || photos.some((photo) => typeof photo !== 'string' || !UPLOAD_PATH.test(photo) || uploaderOf(photo, dir) !== job.userId)) throw new Error('swap-people');
      return {
        kind: 'produce', templateId: job.templateId, ownerId: job.userId, quality: job.input.quality, variants: 1, language: job.input.language, products: [], sample: false, swap: { people, ...(job.swap.outfit ? { outfit: job.swap.outfit } : {}) },
      };
    }
    const products = job.input.products.map(({ name, description, images }) => ({ name, description, images: [...images] }));
    for (const image of products.flatMap((product) => product.images)) {
      if (uploaderOf(image, dir) !== job.userId) throw new Error('upload-not-found');
    }
    const { quality, language } = job.input;
    return { kind: 'produce', templateId: job.templateId, ownerId: job.userId, quality, variants, language, products, sample };
  };
  /** A job's own run and its regenerations: id and state only (a row whose JSON is broken still has those). */
  const runsOfJob = (jobId: Id): { id: string; state: string }[] => db.prepare(
    `SELECT id, state FROM runs WHERE kind = 'produce' AND (ref = ? OR substr(ref, 1, length(?)) = ?)`,
  ).all(jobId, `${jobId}/`, `${jobId}/`) as { id: string; state: string }[];
  /** The folder of a run. Of a person swap (`swap`) also where an earlier retirement moved it or its parts (`sweepMedia`): its files are deleted, never kept aside. */
  const removeFiles = (runId: string, swap: boolean): void => {
    if (!RUN_ID.test(runId)) return;
    fs().rmSync(path().join(dir, 'jobs', runId), { recursive: true, force: true });
    if (swap) fs().rmSync(path().join(dir, 'retired', 'jobs', runId), { recursive: true, force: true });
  };
  /** The files of every run of a job; refused (`engine-run-active`), with nothing deleted, while one of them is held, queued or running. */
  const removeMedia = (job: JobRecord): void => tx(db, () => {
    const all = runsOfJob(job.id);
    if (all.some((run) => ACTIVE.has(run.state))) throw new Error('engine-run-active');
    for (const run of all) removeFiles(run.id, job.swap !== undefined);
  });
  /** B17: the saved parts of a job's finished runs are deleted and those runs closed; one that is held, queued or running is not touched. Never throws. */
  const closeRuns = (job: JobRecord): void => {
    try {
      tx(db, () => {
        for (const run of runsOfJob(job.id)) if (!ACTIVE.has(run.state)) {
          removeFiles(run.id, false);
          db.prepare("UPDATE runs SET state = 'closed', updated_at = ? WHERE id = ? AND state NOT IN ('held','queued','running')").run(iso(), run.id);
        }
      });
    } catch (error) {
      console.error(`engine-close-failed: job ${job.id}: ${messageOf(error)}`);   // never throws: a failed close must not take the customer's job list down
    }
  };
  /**
   * Person swap: the photographs the rules keep no longer are deleted from the disk, and the videos past their days; then the jobs
   * whose time ran out are refused or closed (`sweepSwapJobs`), though nobody reads them. Never throws.
   */
  const sweepSwap = (): void => {
    try {
      sweepSwapPhotos(dir);
      sweepSwapVideos(dir, removeMedia);
      if (ownStore(dir)) sweepSwapJobs(closeRuns);                           // last: what must be deleted is, whatever the records say
    } catch (error) {
      console.error(`swap-sweep-failed: ${messageOf(error)}`);
    }
  };
  /** The regenerations of a done job, oldest first: the newest one of a variant is what that variant shows. */
  const regenerated = (job: JobRecord): void => {
    const prefix = `${job.id}/`;
    const rows = db.prepare(`SELECT * FROM runs WHERE kind = 'produce' AND substr(ref, 1, length(?)) = ? ORDER BY created_at, id`).all(prefix, prefix);
    const all = rows.map(readRun).filter((run): run is RunRow => run !== null);
    for (const run of all) {
      const variantId = regenOf(run.ref)?.variantId;
      job.variants = job.variants.map((variant) => (variant.id === variantId ? variantOf(variant.id, run, 1, true) : variant));
    }
    // A variant the site holds as generating while the engine has no run for it will never move: it stops with `engine-error`, as a job without its run does.
    const known = new Set(rows.map((row) => regenOf(String(row.ref))?.variantId));   // a row that cannot be read is still a run
    job.variants = job.variants.map((variant) => (variant.status === 'generating' && !known.has(variant.id)
      ? { id: variant.id, image: '', video: null, status: 'stopped', reason: 'engine-error' } : variant));
  };
  const readSettings = (): Settings => {
    const raw = db.prepare('SELECT value FROM settings WHERE id = 1').get() as { value: string } | undefined;
    let stored: Partial<Settings> = {};
    try {
      const value: unknown = raw ? JSON.parse(raw.value) : {};
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) stored = value as Partial<Settings>;
    } catch { /* a broken row reads as the defaults, as the worker reads it */ }
    return { ...DEFAULT_SETTINGS, ...stored, sources: { ...DEFAULT_SETTINGS.sources, ...stored.sources }, tiers: { ...DEFAULT_SETTINGS.tiers, ...stored.tiers } };
  };
  const toAdmin = (settings: Settings): AdminSettings => ({
    scanTimes: [...settings.scanTimes], threshold: settings.threshold, dailyCandidates: settings.dailyCandidates, dailyTemplates: settings.dailyTemplates,
    providerAccount: settings.providerAccount ?? '', sources: { ...settings.sources }, searches: [...settings.searches],
    secondsMin: settings.secondsMin, secondsMax: settings.secondsMax, shortsMinViews: settings.shortsMinViews, topAdsCards: settings.topAdsCards, topAdsIndustry: settings.topAdsIndustry, topAdsCountry: settings.topAdsCountry, topAdsPeriod: settings.topAdsPeriod, perScan: settings.perScan,
  });
  /** A pending scan run the worker has not begun yet (it writes the `scans` row, id = the run's ref, when it begins). */
  const pendingScans = (): Scan[] => db.prepare(
    `SELECT * FROM runs WHERE kind = 'scan' AND state IN ('held', 'queued', 'running') AND NOT EXISTS (SELECT 1 FROM scans WHERE scans.id = runs.ref)`,
  ).all().map(readRun).filter((run): run is RunRow => run !== null).map((run) => {
    const source = run.input.kind === 'scan' ? run.input.source : 'topads';
    return { id: run.ref, startedAt: run.createdAt, source, checked: 0, queued: 0, aboveThreshold: 0, prepared: 0, status: 'running', reason: null };
  });
  const scanOf = (raw: Raw): Scan => {
    const row = toScanRow(raw);
    return { ...row, reason: row.reason === 'engine-error' ? 'scan-failed' : SCAN_REASONS.find((code) => code === row.reason) ?? null };
  };
  /** The candidates in the inbox: found or scored, and no preparation of them pending. */
  const inbox = (): Raw[] => db.prepare(
    `SELECT * FROM candidates c WHERE c.state IN ('found', 'scored') AND NOT EXISTS (
       SELECT 1 FROM runs r WHERE r.kind = 'prepare' AND r.state IN ('held', 'queued', 'running')
         AND json_extract(r.input, '$.from.candidateId') = c.id)
     ORDER BY c.found_at DESC, c.id`,
  ).all();

  /** The part its prepare run was given, as JSON text; '' when it was given none. */
  const partOf = (templateId: unknown): string => {
    const run = db.prepare("SELECT json_extract(input, '$.from.range') AS range FROM runs WHERE kind = 'prepare' AND ref = ? ORDER BY created_at DESC LIMIT 1").get(String(templateId));
    return typeof run?.range === 'string' ? run.range : '';
  };

  if (guard.locked) sweepSwap();                                           // when the engine opens, whoever reads which job afterwards

  return {
    sourcePart(templateId) {
      const part = partOf(templateId);
      if (part === '') return null;
      const { from, to } = JSON.parse(part) as SourceRange;
      return { from, to };
    },
    sourceInfo(ownerId, url, range) {
      const identity = sourceIdentity(url);
      if (identity === null) return null;
      // The same link with another part (or with none) is another video: the template's part is the one its prepare run was given.
      const wanted = range ? JSON.stringify({ from: range.from, to: range.to }) : '';
      const raw = db.prepare("SELECT * FROM templates WHERE source_url IS NOT NULL AND state IN ('ready','published','hidden') AND (owner = ? OR (owner IS NULL AND state = 'published')) ORDER BY created_at DESC").all(ownerId)
        .find(raw => typeof raw.source_url === 'string' && sourceIdentity(raw.source_url) === identity && partOf(raw.id) === wanted);
      const row = raw ? readTemplate(raw) : null;
      return row ? { ok: true, seconds: row.card.seconds, format: row.card.format, shots: row.card.shots.length } : null;
    },
    templates() {
      return db.prepare('SELECT * FROM templates ORDER BY created_at, id').all()
        .map(readTemplate).filter((row): row is TemplateRow => row !== null).map(show);
    },

    template(id) {
      const row = templateRow(id);
      return row ? show(row) : null;
    },

    /**
     * The status is the row's state (published, hidden, waiting = ready); only a template that is ready may change it.
     * Card fields are written at once (the admin sees them) and an `edit` run takes them over into the template's own file.
     * New shots make the sample `outdated` (B11); publishing a template whose sample is (or becomes) outdated is refused, nothing written.
     * The people of a person-swap video (`patch.swap`) are NOT written here: they go to the worker in an `edit` run of their own, and
     * the worker writes them into swap.json and the card together. Such a video is not published while its people are unset or pending.
     */
    updateTemplate(id, patch) {
      return tx(db, () => {
        const row = mustTemplate(id);
        const t = iso();
        const previousFreshness = (db.prepare('SELECT sample_changed_at FROM templates WHERE id = ?').get(id) as { sample_changed_at: string | null }).sample_changed_at;
        const shotsChanged = patch.shots !== undefined && JSON.stringify(plainShots(patch.shots)) !== JSON.stringify(plainShots(row.card.shots));
        const sample = shotsChanged && row.card.video ? 'outdated' : sampleOf(row);
        if (patch.status !== undefined && patch.status !== 'private') {
          if (!['ready', 'published', 'hidden'].includes(row.state)) throw new Error('template-not-ready');
          if (patch.status === 'published' && !row.card.image) throw new Error('template-no-sample');   // a gallery card needs its poster
          if (patch.status === 'published' && row.state !== 'published' && sample === 'outdated') throw new Error('sample-outdated');
          if (patch.status === 'published' && row.state !== 'published' && swapPeopleOf(row)) throw new Error('swap-people-unset');
          const state = patch.status === 'waiting' ? 'ready' : patch.status;
          db.prepare('UPDATE templates SET state = ?, updated_at = ? WHERE id = ?').run(state, t, id);
        }
        const fields = (['title', 'category', 'products', 'shots', 'description', 'tags'] as const).filter((key) => patch[key] !== undefined);
        if (fields.length > 0) {
          const card: Card = { ...row.card, ...Object.fromEntries(fields.map((key) => [key, structuredClone(patch[key])])), ...(patch.shots === undefined ? {} : { shots: keepFrames(patch.shots, row.card.shots) }) };
          db.prepare('UPDATE templates SET card = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(card), t, id);
          if (shotsChanged) db.prepare('UPDATE templates SET sample_changed_at = ? WHERE id = ?').run(t, id);
          const { title, category, products, shots, description, tags } = card;
          const edit = { title, category, products, shots, description, tags };
          insertRun({ kind: 'edit', templateId: id, card: edit, ...(shotsChanged ? { shotsChanged: true, sampleChangedBefore: previousFreshness } : {}) }, id, 'queued', null, t);
        }
        if (patch.swap !== undefined) {
          if (!swapOf(row.card)) throw new NotFoundError('template');
          if (!['ready', 'published', 'hidden'].includes(row.state)) throw new Error('template-not-ready');
          if (swapPeopleProblem(patch.swap.persons)) throw new Error('swap-people-invalid');
          const { title, category, products, shots, description, tags } = mustTemplate(id).card;
          insertRun({ kind: 'edit', templateId: id, card: { title, category, products, shots, description, tags }, swap: { persons: patch.swap.persons } }, id, 'queued', null, t);
        }
        return show(mustTemplate(id));
      });
    },

    removeTemplate(id) {
      if (db.prepare('DELETE FROM templates WHERE id = ?').run(id).changes === 0) throw new NotFoundError('template');
    },

    /** The row (private, preparing, the link as its title) and its `prepare` run, together. */
    addFromLink(ownerId, url, range, mode) {
      const identity = sourceIdentity(url);
      if (identity === null) throw new Error('source-rejected:unsupported-site');
      if (range && rangeProblem(range)) throw new Error('source-rejected:range');
      url = identity;
      return tx(db, () => {
        const id = crypto.randomUUID();
        const t = iso();
        const card: Card = {
          title: url, category: '', format: 'no-talking', seconds: 0, referenceViews: '', image: null, video: null,
          products: 1, shots: [], description: '', tags: [],
        };
        db.prepare(
          `INSERT INTO templates (id, state, owner, source_kind, source_url, note, card, estimate, minutes, times_generated, created_at, updated_at)
           VALUES (?, 'preparing', ?, 'link', ?, NULL, ?, NULL, NULL, 0, ?, ?)`,
        ).run(id, mode ? null : ownerId, url, JSON.stringify(card), t, t);
        const run = insertRun({ kind: 'prepare', templateId: id, ownerId: mode ? null : ownerId, ...(mode && { mode }), from: { kind: 'link', url, ...(range ? { range: { from: range.from, to: range.to } } : {}) } }, id, mode ? 'queued' : 'held', null);
        if (!mode) handedOver.add(run.id);                                 // nothing is charged for a person-swap video: its run waits for no charge to be saved, like a candidate's
        return show(mustTemplate(id));
      });
    },

    /** Ownership and immutable registry admission happen before the site charge; prepare is held until that charge is durable. */
    addFromUpload(ownerId, uploadId, range, mode) {
      const upload = videoUploadOf(uploadId, ownerId, dir);
      if (!upload) throw new Error('upload-not-found');
      const refused = (range && rangeProblem(range)) || fileLengthProblem(upload.seconds, range);
      if (refused) throw new Error(`source-rejected:${refused}`);
      return tx(db, () => {
        const id = crypto.randomUUID(), t = iso();
        const card: Card = { title: videoUploadTitle(upload), category: '', format: 'no-talking', seconds: range ? range.to - range.from : upload.seconds,
          referenceViews: '', image: null, video: null, products: 1, shots: [], description: '', tags: [] };
        db.prepare(`INSERT INTO templates (id, state, owner, source_kind, source_url, card, times_generated, created_at, updated_at)
          VALUES (?, 'preparing', ?, 'upload', NULL, ?, 0, ?, ?)`).run(id, mode ? null : ownerId, JSON.stringify(card), t, t);
        // A person-swap video is the catalog's, and its run still names who uploaded the file: the worker checks the file is theirs
        const run = insertRun({ kind: 'prepare', templateId: id, ownerId, ...(mode && { mode }), from: { kind: 'upload', uploadId, sha256: upload.sha256, ...(range ? { range: { from: range.from, to: range.to } } : {}) } }, id, mode ? 'queued' : 'held', null);
        if (!mode) handedOver.add(run.id);                                 // nothing is charged for a person-swap video: its run waits for no charge to be saved, like a candidate's
        return show(mustTemplate(id));
      });
    },

    /** The template's estimate (the worker's `paidFor(template, 1)`) times the variants: `paidFor` is linear in them. */
    paid(templateId, variants) {
      if (!Number.isInteger(variants) || variants < 1) throw new RangeError(`variants must be a whole number from 1 on, got ${variants}`);
      const { estimate } = mustTemplate(templateId);
      if (!estimate) throw new Error('template-not-ready');
      return {
        images: estimate.images * variants, clips: estimate.clips * variants, clipSeconds: estimate.clipSeconds * variants,
        music: estimate.music * variants, voice: estimate.voice * variants,
      };
    },

    minutes(templateId, variants) {
      const { minutes } = mustTemplate(templateId);
      if (minutes === null) throw new Error('template-not-ready');
      return minutes * variants;
    },

    /** B1: would a job on the free video with these requests start now, as far as the free share (K2) goes? Nothing is reserved or marked. */
    freeShareOpen(approved) {
      if (process.env.VC_PROVIDER !== 'magnific') return true;
      let caps;
      try { caps = providerCaps(process.env); } catch { return true; }     // no valid caps: the start refuses (`capsOrRefuse`)
      return !caps || freeShareFits(caps.daily, providerUnits(approved), now());
    },

    /**
     * One `produce` run, held, with what was approved; the job id is its `ref`, so a second start of the same job makes no second
     * run (the unique index `runs_once`). The job's photos must be stored uploads of the job's owner.
     * A sample is refused (`sample-running`) while another sample run of the template is held, queued or running (S11 review I1).
     */
    reserveQueued(job, approved) { tx(db, () => reserve(job.id, approved, job.freeVideo)); },
    start(job, approved, sample) {
      tx(db, () => {
        const input = produceInput(job, sample, job.input.variants);
        const twin = sample && db.prepare(
          `SELECT 1 FROM runs WHERE kind = 'produce' AND ref <> ? AND state IN ('held', 'queued', 'running')
             AND json_extract(input, '$.templateId') = ? AND json_extract(input, '$.sample') = 1 LIMIT 1`,
        ).get(job.id, job.templateId) !== undefined;
        if (twin) throw new Error('sample-running');
        const { id, inserted } = insertRun(input, job.id, 'held', approved, undefined, undefined, job.freeVideo);
        if (!inserted) return;
        handedOver.add(id);
        if (!sample) db.prepare('UPDATE templates SET times_generated = times_generated + 1, updated_at = ? WHERE id = ?').run(iso(), job.templateId);
      });
      job.steps = waitingSteps(approved, job.swap !== undefined);
    },

    /** Stopped → held, with `approved` (what was missing) added to what the run had approved. `missing` stays as the worker wrote it. */
    resume(job, approved) {
      const t = iso();
      const run = tx(db, () => {
        const found = produceRun(job.id);
        if (!found || found.state !== 'stopped') throw new Error('engine-not-stopped');
        reserve(found.ref, approved);
        if (!job.freeVideo) db.prepare('DELETE FROM free_budget WHERE run_id = ?').run(found.ref); // Ö2: it goes on as a paid job, which the free share does not count
        db.prepare(`UPDATE runs SET state = 'held', approved = ?, updated_at = ? WHERE id = ? AND state = 'stopped'`)
          .run(JSON.stringify(addPaid(found.approved, approved)), t, found.id);
        return { ...found, state: 'held' as const };
      });
      handedOver.add(run.id);
      job.resumedAt = t;                                                   // the mark `settleOrphans` looks for in the saved job
      job.status = 'running';
      job.stoppedReason = null;
      job.stoppedDetail = null;
      job.finishedAt = null;
      job.steps = stepsOf(run, job.steps);
    },

    /**
     * R3: an admin has looked at the provider's task list and found no task for the request that made the run stop with
     * `submission-unknown`: every unknown request of that run becomes failed (who and when are written into it), and the job reads as an
     * ordinary stop that a resume continues. Throws `not-settleable` when no run of the job is stopped for that reason.
     */
    settleUnknown(job, by) {
      const raw = db.prepare(`SELECT id FROM runs WHERE kind = 'produce' AND ref = ? AND state = 'stopped' AND reason = 'submission-unknown' ORDER BY updated_at DESC LIMIT 1`).get(job.id) as { id: string } | undefined;
      if (!raw) throw new Error('not-settleable');
      const caps = process.env.VC_PROVIDER === 'magnific' ? providerCaps(process.env) : null;
      settleUnknown(db, caps ? (key, units, at) => refundProvider(db, caps, key, units, at) : null, { runId: raw.id, by, at: now() });
      job.stoppedReason = 'engine-error';
      job.stoppedDetail = null;
    },

    /** Every run handed over since the last call may start: held → queued. A run that is no longer held is left as it is. */
    committed() {
      if (handedOver.size === 0) return;
      const own = savedOwnTemplates(dir);
      tx(db, () => {
        for (const id of handedOver) {
          const run = db.prepare("SELECT kind, ref, input FROM runs WHERE id = ? AND state = 'held'").get(id) as { kind: string; ref: string; input: string } | undefined;
          if (!run) continue;
          const input = JSON.parse(run.input) as RunInput;
          if (input.kind === 'prepare' && (input.ownerId === null || own.get(input.templateId) !== input.ownerId)) {
            db.prepare("UPDATE runs SET state = 'stopped', reason = 'engine-error', updated_at = ? WHERE id = ? AND state = 'held'").run(iso(), id);
            db.prepare("UPDATE templates SET state = 'failed', note = 'check-failed', updated_at = ? WHERE id = ? AND state = 'preparing'").run(iso(), input.templateId);
          } else db.prepare("UPDATE runs SET state = 'queued', updated_at = ? WHERE id = ? AND state = 'held'").run(iso(), id);
        }
      });
      handedOver.clear();
    },

    /**
     * The run's state, steps, variants and output, as the worker last wrote them (B2). A run that stopped after delivering some
     * variants is a `done` job with the others `stopped`; one that delivered none is a `stopped` job, stopped at the run's last write.
     * A done job with a variant being generated again follows that regeneration; any other done job, and a stopped one, stays as it is.
     */
    refresh(job) {
      settleLater();                                                       // first: a done job with an orphaned regeneration is watched by no other path
      if (job.status === 'done' && job.variants.some((variant) => variant.status === 'generating')) regenerated(job);
      if (job.status !== 'running') return job;
      const raw = db.prepare(`SELECT * FROM runs WHERE kind = 'produce' AND ref = ?`).get(job.id);
      if (!raw) {
        // The engine has no run for a job the site holds as running: it will never move. Say so, once.
        job.status = 'stopped';
        job.stoppedReason = 'engine-error';
        job.stoppedAt = iso();
        return job;
      }
      const run = readRun(raw);
      if (!run) return job;                                                // a row that cannot be read (logged once) is not "no run": the job stays as it is
      job.steps = stepsOf(run, job.steps);
      job.engineQueue = lineBehind(run);
      // What the job made is only shown: when it cannot be read, the job is refreshed without it, never left unfinished or unrefunded for it.
      try { ({ shots: job.shots, made: job.made } = madeOf(job, run.id)); } catch { if (!madeUnreadable.has(job.id)) { madeUnreadable.add(job.id); console.error(`job-made-unreadable: ${job.id}`); } }
      job.variants = variantsOf(job, run);
      if (run.state === 'done' || (run.state === 'stopped' && job.variants.some((variant) => variant.status === 'done'))) {
        job.status = 'done';
        job.finishedAt = run.updatedAt;
      } else if (run.state === 'stopped') {
        job.status = 'stopped';
        job.stoppedReason = reasonOf(run.reason);
        job.stoppedDetail = detailOf(run.detail);
        job.stoppedAt = run.updatedAt;
      }
      return job;
    },

    /**
     * B2: a `stopped` variant of a done job is made again by a produce run of ONE variant, held until `committed()`, with what the
     * site approved (the price of one variant): the same path, the same owner check and the same kind of mark as a resume
     * (`variantRuns[variant]` = the run's `updated_at`), and it is not counted on the template. While a regeneration of that
     * variant is unfinished, or when the variant is not stopped, it is refused (`not-stopped`) and nothing is held.
     */
    regenerateVariant(job, variantId, approved) {
      if (!job.variants.some((variant) => variant.id === variantId)) throw new NotFoundError('variant');
      const t = iso();
      const runId = tx(db, () => {
        const prefix = `${job.id}/${variantId}/`;
        const pending = db.prepare(
          `SELECT 1 FROM runs WHERE kind = 'produce' AND substr(ref, 1, length(?)) = ? AND state IN ('held', 'queued', 'running') LIMIT 1`,
        ).get(prefix, prefix) !== undefined;
        const variant = job.variants.find((item) => item.id === variantId);
        if (variant?.status === 'stopped' && variant.reason === 'content-rule') throw new Error('not-resumable');   // B12: it would be stopped again
        if (job.status !== 'done' || variant?.status !== 'stopped' || pending) throw new Error('not-stopped');
        const id = crypto.randomUUID();
        insertRun(produceInput(job, false, 1), regenRef(job.id, variantId, id), 'held', approved, t, id);
        return id;
      });
      handedOver.add(runId);
      job.variantRuns = { ...job.variantRuns, [variantId]: t };            // the mark `settleOrphans` looks for in the saved job
      job.variants = job.variants.map((variant) => (variant.id === variantId ? { id: variantId, image: '', video: null, status: 'generating', reason: null } : variant));
      return runId;
    },

    /**
     * B17: the saved parts of the job's finished runs (`jobs/<runId>/`) are deleted; the rows stay (a closed job is never resumed:
     * the site refuses it). A run that is held, queued or running is not touched. No run: nothing to do.
     */
    close(job) {
      closeRuns(job);
    },

    /**
     * B18: the videos and images of the job's runs and of its regenerations are deleted. While any of them is held, queued or
     * running it refuses (`engine-run-active`) and deletes nothing.
     */
    deleteMedia(job) {
      removeMedia(job);
    },

    missing(job) {
      if (job.status !== 'stopped') return { ...ZERO };
      const run = produceRun(job.id);
      return run?.state === 'stopped' && run.missing ? { ...run.missing } : { ...ZERO };
    },

    candidates() {
      return inbox().map((raw): Candidate => {
        const row = toCandidateRow(raw);
        const notes = (row.scoreNotes ?? '').split('\n').filter((note) => note.trim() !== '');
        return {
          id: row.id, title: row.title, source: row.source === 'shorts' ? 'shorts' : 'topads', referenceMetric: { kind: row.source === 'topads' ? 'likes' : 'views', count: (row.source === 'topads' ? row.likes : row.views) ?? 0 }, views: views(row.views), seconds: row.seconds,
          score: row.score ?? 0, image: row.image ? (/^https?:\/\//.test(row.image) ? row.image : `/media/${row.image}`) : '', foundAt: row.foundAt,
          ...(notes.length > 0 ? { scoreNotes: notes } : {}),
        };
      });
    },

    /**
     * A link of an admin becomes a manual candidate in the inbox; `prepareCandidate` then takes it. Nothing is prepared or spent here.
     * The video is `exists` when a candidate (in any state) or a catalog template (owner none, any state) is the same video: a customer's
     * private template is not. The day's limits are read as the worker keeps them (`usage`, by local day): the templates the worker took
     * (`prepare`) and those waiting for it (a catalog `prepare` run whose template has not taken its unit yet), the candidates the scans
     * sent to scoring (`score`) and the manual ones of today.
     */
    addLinkCandidate(url) {
      const link = sourceLink(url);
      if (link === null) throw new Error('source-rejected:unsupported-site');
      return tx(db, (): { status: 'added'; id: Id } | { status: 'exists' | 'limit' } => {
        const keyOf = (value: unknown): string | null => (typeof value === 'string' ? sourceLink(value)?.key ?? value : null);
        const same = (rows: Raw[], column: string): boolean => rows.some((row) => keyOf(row[column]) === link.key);
        if (same(db.prepare('SELECT url FROM candidates').all(), 'url') || same(db.prepare('SELECT source_url FROM templates WHERE owner IS NULL AND source_url IS NOT NULL').all(), 'source_url')) return { status: 'exists' };
        const settings = readSettings();
        const day = localDay(now());
        const used = (kind: string): number => Number((db.prepare('SELECT count FROM usage WHERE day = ? AND kind = ?').get(day, kind) as { count: number } | undefined)?.count ?? 0);
        const waiting = Number((db.prepare(
          `SELECT COUNT(*) AS n FROM runs r LEFT JOIN templates t ON t.id = r.ref
            WHERE r.kind = 'prepare' AND r.state IN ('held', 'queued', 'running') AND json_extract(r.input, '$.ownerId') IS NULL
              AND (t.id IS NULL OR t.note IS NOT 'unit-taken')`,
        ).get() as { n: number }).n);
        const manualToday = (db.prepare("SELECT found_at FROM candidates WHERE source = 'manual'").all() as { found_at: string }[])
          .filter((row) => localDay(new Date(row.found_at)) === day).length;
        if (used('prepare') + waiting >= settings.dailyTemplates || used('score') + manualToday >= settings.dailyCandidates) return { status: 'limit' };
        const id = crypto.randomUUID();
        const added = insertNewCandidate(db, { id, scanId: null, source: 'manual', url: link.url, title: link.url, views: null, likes: null, seconds: 0, state: 'found', score: null, scoreNotes: null, image: null, video: null }, now());
        return added ? { status: 'added', id } : { status: 'exists' };
      });
    },

    /**
     * The admin asks for this candidate: a `prepare` run with `force: true`. The row is made here as `preparing` (so the admin sees
     * it at once); the worker takes it over. The candidate leaves the inbox while its preparation is pending.
     */
    prepareCandidate(id) {
      return tx(db, () => {
        const raw = inbox().find((row) => row.id === id);
        if (!raw) throw new NotFoundError('candidate');
        const candidate = toCandidateRow(raw);
        const templateId = crypto.randomUUID();
        const t = iso();
        const card: Card = {
          title: candidate.title, category: '', format: 'no-talking', seconds: candidate.seconds, referenceViews: views(candidate.views),
          image: null, video: null, products: 1, shots: [], description: '', tags: [],
        };
        db.prepare(
          `INSERT INTO templates (id, state, owner, source_kind, source_url, note, card, estimate, minutes, times_generated, created_at, updated_at)
           VALUES (?, 'preparing', NULL, ?, (SELECT url FROM candidates WHERE id = ?), NULL, ?, NULL, NULL, 0, ?, ?)`,
        ).run(templateId, candidate.source === 'manual' ? 'link' : candidate.source, id, JSON.stringify(card), t, t);
        insertRun({ kind: 'prepare', templateId, ownerId: null, from: { kind: 'candidate', candidateId: id, force: true } }, templateId, 'queued', null);
        return show(mustTemplate(templateId));
      });
    },

    rejectCandidate(id) {
      const changed = db.prepare(`UPDATE candidates SET state = 'rejected', updated_at = ? WHERE id = ? AND state IN ('found', 'scored')`).run(iso(), id).changes;
      if (changed === 0) throw new NotFoundError('candidate');
    },

    /** Newest first; a scan the worker has not begun yet reads as running. */
    scans() {
      const all = [...pendingScans(), ...db.prepare('SELECT * FROM scans').all().map(scanOf)];
      return all.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    },

    /**
     * Queues a manual scan of Top Ads (Shorts when only Shorts is on), with a `ref` of its own: `runs_once` is unique on kind + ref.
     * While one runs or waits, that one is returned.
     */
    runScan() {
      return tx(db, () => {
        const running = [...pendingScans(), ...db.prepare(`SELECT * FROM scans WHERE status = 'running'`).all().map(scanOf)][0];
        if (running) return running;
        const { sources } = readSettings();
        const source = !sources.topads && sources.shorts ? 'shorts' : 'topads';
        const ref = `scan-manual-${crypto.randomUUID()}`;
        const startedAt = iso();                                           // one time: the answer and the queued row agree
        insertRun({ kind: 'scan', source, trigger: 'manual' }, ref, 'queued', null, startedAt);
        return { id: ref, startedAt, source, checked: 0, queued: 0, aboveThreshold: 0, prepared: 0, status: 'running', reason: null };
      });
    },

    settings() {
      return toAdmin(readSettings());
    },

    /** Only the fields of the settings change; a field that is undefined is left as it is. The worker's `tiers` stay. */
    saveSettings(patch) {
      return tx(db, () => {
        const given = Object.fromEntries(SETTING_KEYS.filter((key) => patch[key] !== undefined).map((key) => [key, structuredClone(patch[key])]));
        const next: Settings = { ...readSettings(), ...given };
        db.prepare('INSERT INTO settings (id, value) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value').run(JSON.stringify(next));
        return toAdmin(next);
      });
    },

    health() {
      settleLater();
      const raw = db.prepare('SELECT value FROM health WHERE id = 1').get() as { value: string } | undefined;
      // `noCredits`: the worker holds the provider for its credits, in a field of its own (not a note: the key is set, the account is empty). A row of an older worker has none.
      let health: Health | null = null;
      try { health = raw ? (JSON.parse(raw.value) as Health) : null; } catch { /* unreadable: as if never written */ }
      if (!health) return { worker: 'down', lastSeen: null, provider: 'not-configured' };
      const fresh = now().getTime() - Date.parse(health.workerAt) <= HEALTH_FRESH_MS;
      const provider = health.provider === 'fake' ? 'fake' : health.note === null ? 'ready' : 'not-configured';
      const held = typeof health.noCredits === 'string' && health.noCredits !== '';
      // `outOfCredits` is there only when it is true: the settings page reads it (features/admin-settings/health.ts)
      // person swap has a provider of its own: it is passed on as the worker wrote it and takes no part in `provider`
      const swap = SWAP_PROVIDER_STATES.find((state) => state === health.swap);
      return { worker: fresh ? 'running' : 'down', lastSeen: health.workerAt, provider, ...(held ? { outOfCredits: true } : {}), ...(swap ? { swap } : {}) };
    },
  };
}

// Kept on globalThis, like the store: a Next dev hot reload must not open a second connection or forget the runs handed over.
const holder = globalThis as typeof globalThis & { __vcSqliteEngines?: Map<string, Instance>; __vcLockExit?: boolean };

/**
 * The production system of the data directory (`VC_DATA_DIR`). One connection per directory and process; the first one settles the
 * orphan held runs of an earlier process.
 */
export function sqliteEngine(dir: string = dataDir()): Engine {
  holder.__vcSqliteEngines ??= new Map();
  let instance = holder.__vcSqliteEngines.get(dir);
  if (!instance) {
    instance = open(dir);
    holder.__vcSqliteEngines.set(dir, instance);
    if (!holder.__vcLockExit) {
      holder.__vcLockExit = true;
      process.on('exit', () => holder.__vcSqliteEngines?.forEach((one) => one.close()));   // gives the locks back; a crash leaves a stale one (taken over)
    }
  }
  return instance.engine;
}

/** For tests: closes every connection; the next `sqliteEngine()` opens (and settles) again, as a new process would. */
export function closeSqliteEngines(): void {
  for (const instance of holder.__vcSqliteEngines?.values() ?? []) instance.close();
  holder.__vcSqliteEngines?.clear();
}
