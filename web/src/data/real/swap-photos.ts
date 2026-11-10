import type * as Fs from 'node:fs';
import type * as Path from 'node:path';
import { dataDir, persistent } from '../mock/persist';
import { getStore, now } from '../mock/store';
import type { JobRecord } from '../mock/store';
import { RULES } from '../ports';
import type { Id, SwapPhotos } from '../ports';
import { photoSize } from './photo-size';
import { UPLOAD_PATH, uploaderOf } from './uploads';

// The photographs of a person swap are personal data: they are kept only as long as the rules say (`RULES.swapPhotosKeptHours`,
// `swapStoppedPhotosKeptDays`), and then DELETED from the disk, never moved aside. They are stored uploads (`uploads/<uuid>/1.<ext>`,
// see uploads.ts), so `/media` shows one to its uploader and the admins only. A job that started marks the folder of each of its
// photographs (`uploads/<uuid>/swap`): a marked folder no job names any more (the account was deleted) is deleted by the sweep.
// In fake mode there are no files: only the job's record forgets its photographs.

const fs = (): typeof Fs => process.getBuiltinModule('node:fs');
const path = (): typeof Path => process.getBuiltinModule('node:path');

const HOUR = 3_600_000, DAY = 86_400_000;
/** In the folder of a photograph a person-swap job started with. */
const MARK = 'swap';
/** The folders the sweep looks through: the uploads, and where an upload whose owner is gone is moved to (`sweepMedia`). */
const ROOTS = [['uploads'], ['retired', 'uploads']];
const FOLDER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every stored photograph of one person: the full-body one, then the face one and the side one when they were given. */
export const photographsOf = (person: SwapPhotos): string[] => [person.body, ...(person.face === null ? [] : [person.face]), ...(person.side == null ? [] : [person.side])];
const pathsOf = (people: readonly SwapPhotos[]): string[] => people.flatMap(photographsOf);
/** The upload folders (uuid names) of these photographs; a path that is not a stored photograph has none. */
const foldersOf = (people: readonly SwapPhotos[]): string[] => [...new Set(pathsOf(people).flatMap((stored) => UPLOAD_PATH.exec(stored)?.[1] ?? []))];
/** Not past `ms` after `iso`? A time that cannot be read is past: what cannot be dated is not kept. */
const within = (iso: string | null, ms: number, at: Date): boolean => Date.parse(iso ?? '') + ms > at.getTime();

/** Has this person swap waited for the admin's look for `RULES.swapReviewHours`? Then it is refused by itself, and never starts. */
export function swapReviewOver(job: JobRecord, at: Date): boolean {
  return job.status === 'queued' && job.swap?.review === 'waiting' && !within(job.startedAt, RULES.swapReviewHours * HOUR, at);
}

/**
 * Are the photographs of this job to be deleted now? Those of a closed job (by its owner, by its time, or refused by the admin) and of a
 * deleted one at once; of a done job `RULES.swapPhotosKeptHours` after it was done; of a stopped job at the latest
 * `RULES.swapStoppedPhotosKeptDays` after it stopped; of a job nobody looked at when its wait is over (`swapReviewOver`), though no
 * read has refused it yet. A job that waits or runs keeps them. False when it has none (any more).
 */
export function swapPhotosDue(job: JobRecord, at: Date): boolean {
  if (!job.swap || job.swap.people.length === 0) return false;
  if (job.status === 'closed' || job.deletedAt || swapReviewOver(job, at)) return true;
  if (job.status === 'done') return !within(job.finishedAt, RULES.swapPhotosKeptHours * HOUR, at);
  if (job.status === 'stopped') return !within(job.stoppedAt, RULES.swapStoppedPhotosKeptDays * DAY, at);
  return false;
}

/** Are the files of this person swap's video to be deleted now: `RULES.swapVideosKeptDays` after it was done, once. */
export function swapVideoDue(job: JobRecord, at: Date): boolean {
  return !!job.swap && job.status === 'done' && !job.deletedAt && !job.swapVideoGoneAt && !within(job.finishedAt, RULES.swapVideosKeptDays * DAY, at);
}

/** Were these photographs uploaded by this user: each a stored photograph with their marker. In fake mode (no files) each is a name. */
export function ownsSwapPhotos(userId: Id, people: readonly SwapPhotos[]): boolean {
  const stored = pathsOf(people);
  if (!persistent()) return stored.every((name) => typeof name === 'string' && name.trim() !== '');
  return stored.every((file) => typeof file === 'string' && UPLOAD_PATH.test(file) && uploaderOf(file) === userId);
}

/**
 * The photographs of these the rules of a person swap do not take, measured on the stored files (what the form checks in the browser,
 * for a request that never passed it): a short side under `RULES.swapPhotoShortSideMin`, or a full-body photograph that is not upright.
 * A file that cannot be measured (its bytes do not say its size, or it cannot be read) is not taken either: the rules cannot be held to
 * it, and it is no picture a model can be given. None in fake mode (no files).
 */
export function unfitSwapPhotos(people: readonly SwapPhotos[]): string[] {
  if (!persistent()) return [];
  const unfit = (stored: string, upright: boolean): boolean => {
    let size: ReturnType<typeof photoSize>;
    try { size = photoSize(fs().readFileSync(path().join(dataDir(), stored))); } catch { return true; }
    return size === null || Math.min(size.width, size.height) < RULES.swapPhotoShortSideMin || (upright && size.height <= size.width);
  };
  return people.flatMap((person) => photographsOf(person).filter((stored, at) => unfit(stored, at === 0)));   // the first is the full-body one
}

/** Deletes stored photographs a start was refused for, at once: each folder that no job names (a person's photograph, or a product's). */
export function dropRefusedPhotos(refused: readonly string[]): void {
  if (!persistent()) return;
  const named = (stored: string): boolean => getStore().jobs.some((job) =>
    job.input.products.some((product) => product.images.includes(stored)) || (job.swap ? pathsOf(job.swap.people).includes(stored) : false));
  for (const stored of refused) {
    const folder = UPLOAD_PATH.exec(stored)?.[1];
    if (!folder || named(stored)) continue;
    try { remove(dataDir(), folder); } catch { console.error(`swap-photos-not-deleted: folder ${folder}`); }
  }
}

/** Is `dir` the site's own data directory, next to the real engine? Only its engine sweeps the jobs of the store. */
export function ownStore(dir: string): boolean {
  return persistent() && path().resolve(dir) === path().resolve(dataDir());
}

/** Marks the folder of each photograph as one of a person swap. Next to the real engine only. */
export function markSwapPhotos(people: readonly SwapPhotos[]): void {
  if (!persistent()) return;
  for (const folder of foldersOf(people)) fs().writeFileSync(path().join(dataDir(), 'uploads', folder, MARK), '');
}

/**
 * Does a person swap of the store still keep a photograph in this upload folder (`uploads/<uuid>/`)? The sweep of unused uploads asks:
 * a job that waits for the admin's look, or for a place, has no run that names its photographs yet.
 */
export function swapFolderKept(dir: string, folder: string): boolean {
  if (!persistent() || path().resolve(dir) !== path().resolve(dataDir())) return false;
  return getStore().jobs.some((job) => job.swap && !swapPhotosDue(job, now()) && pathsOf(job.swap.people).some((stored) => stored.startsWith(folder)));
}

function remove(dir: string, folder: string): void {
  for (const root of ROOTS) fs().rmSync(path().join(dir, ...root, folder), { recursive: true, force: true });
}

/**
 * Deletes the photographs of a job from the disk and from its record. A photograph another person swap still keeps stays on the disk
 * until that one lets go of it. When a file cannot be deleted the record keeps its photographs, so the next read or sweep tries again.
 */
export function dropSwapPhotos(job: JobRecord): void {
  if (!job.swap || job.swap.people.length === 0) return;
  if (persistent()) {
    const at = now();
    const kept = getStore().jobs.filter((other) => other.id !== job.id && other.swap && !swapPhotosDue(other, at)).flatMap((other) => foldersOf(other.swap!.people));
    try {
      for (const folder of foldersOf(job.swap.people)) if (!kept.includes(folder)) remove(dataDir(), folder);
    } catch {
      console.error(`swap-photos-not-deleted: job ${job.id}`);
      return;
    }
  }
  job.swap.people = [];
}

/**
 * Deletes what should be gone, next to the real engine: the photographs of every job the rules keep no longer (`swapPhotosDue`), and
 * every marked folder that no job names (its account, and its jobs with it, were deleted). Returns how many folders of the second
 * kind it deleted. Called when the engine opens, every few minutes while it works, and right after an account is deleted.
 */
export function sweepSwapPhotos(dir?: string): number {
  if (!persistent()) return 0;
  dir ??= dataDir();
  if (path().resolve(dir) !== path().resolve(dataDir())) return 0;         // the store is the one of the site's own data directory
  const { jobs } = getStore();
  for (const job of jobs) if (swapPhotosDue(job, now())) dropSwapPhotos(job);
  const named = new Set(jobs.flatMap((job) => (job.swap ? foldersOf(job.swap.people) : [])));
  let removed = 0;
  for (const root of ROOTS) {
    let names: string[];
    try { names = fs().readdirSync(path().join(dir, ...root)); } catch { continue; }
    for (const name of names) {
      if (!FOLDER.test(name) || named.has(name) || !fs().existsSync(path().join(dir, ...root, name, MARK))) continue;
      try { remove(dir, name); removed += 1; } catch { console.error(`swap-photos-not-deleted: folder ${name}`); }
    }
  }
  return removed;
}

/**
 * The videos of the person swaps that are past `RULES.swapVideosKeptDays` (`swapVideoDue`): `remove` deletes the files of each, and
 * the job's record says when. One that cannot be deleted now is left for the next sweep or read. Next to the real engine only.
 */
export function sweepSwapVideos(dir: string, remove: (job: JobRecord) => void): void {
  if (!persistent() || path().resolve(dir) !== path().resolve(dataDir())) return;
  for (const job of getStore().jobs) {
    if (!swapVideoDue(job, now())) continue;
    try {
      remove(job);
      job.swapVideoGoneAt = now().toISOString();
    } catch {
      console.error(`swap-video-not-deleted: job ${job.id}`);
    }
  }
}
