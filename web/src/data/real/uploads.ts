import type * as ChildProcess from 'node:child_process';
import type * as Crypto from 'node:crypto';
import type * as Fs from 'node:fs';
import type * as Path from 'node:path';
import { dataDir } from '../mock/persist';
import { RULES, type Id, type Uploads } from '../ports';
import { photoSize } from './photo-size';

// The Node modules are looked up when they are needed (see mock/persist.ts: `@/data` also reaches a browser bundle).
const fs = (): typeof Fs => process.getBuiltinModule('node:fs');
const path = (): typeof Path => process.getBuiltinModule('node:path');
const crypto = (): typeof Crypto => process.getBuiltinModule('node:crypto');

/** The largest product photo, in bytes (spec §7.1: "up to 10 MB each"). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** How many photos one user may upload in 24 hours (a day of forms: 3 jobs of 4 products × 8 photos, and more). */
export const UPLOADS_PER_DAY = 100;
/** An upload folder that no run names is removed this long after it was written (an abandoned or changed form). */
export const UNUSED_UPLOAD_MS = 2 * 86_400_000;
/** At most this many folders are removed per sweep: a sweep never holds the site's start for long. */
const SWEEP_LIMIT = 1000;
const DAY_MS = 86_400_000;

/** Machine codes of a refused photo; the generate form shows each as a field error. */
export type UploadRefusal = 'upload-type' | 'upload-size' | 'upload-quota' | 'upload-unreadable';

/** The file's own first bytes decide its type: a PDF named `x.jpg` is a PDF. */
function typeOf(head: Uint8Array): 'jpg' | 'png' | 'webp' | null {
  const at = (offset: number, bytes: number[]) => bytes.every((byte, index) => head[offset + index] === byte);
  if (at(0, [0xff, 0xd8, 0xff])) return 'jpg';
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'webp';   // RIFF····WEBP
  return null;
}

/** `uploads/<uuid>/<n>.<ext>`: the only shape of a stored photo. The name the customer gave is never used. */
export const VIDEO_UPLOAD_PATH = /^uploads\/([0-9a-f-]{36})\/source\.mp4$/;
export const UPLOAD_PATH = /^uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([1-9][0-9]*)\.(jpg|png|webp)$/;
/** Next to each stored photo: the id of the user who sent it (read by `/media` and by a job start). */
const UPLOADER = 'uploader';

/** The user who uploaded this stored photo, or null when the path is not one, the photo is not there, or nobody is recorded. */
export function uploaderOf(stored: string, dir: string = dataDir()): Id | null {
  const match = UPLOAD_PATH.exec(stored) ?? VIDEO_UPLOAD_PATH.exec(stored);
  if (!match) return null;
  try {
    if (!safeFile(dir, stored)) return null;
    if (VIDEO_UPLOAD_PATH.test(stored) && !safeFile(dir, `uploads/${match[1]}/video.json`)) return null;
    return fs().readFileSync(path().join(dir, 'uploads', match[1]!, UPLOADER), 'utf8');
  } catch {
    return null;
  }
}

/** The upload folders (uuid names) with the time each was last written. */
function folders(dir: string): { name: string; at: number }[] {
  const root = path().join(dir, 'uploads');
  let names: string[];
  try {
    names = fs().readdirSync(root);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    try {
      return [{ name, at: fs().statSync(path().join(root, name)).mtimeMs }];
    } catch {
      return [];
    }
  });
}

/** How many photos this user stored in the last 24 hours (their uploader markers). */
function uploadsToday(dir: string, userId: Id): number {
  const since = Date.now() - DAY_MS;
  return folders(dir).filter(({ name, at }) => {
    if (at < since) return false;
    try {
      return fs().readFileSync(path().join(dir, 'uploads', name, UPLOADER), 'utf8') === userId;
    } catch {
      return false;
    }
  }).length;
}

/**
 * Removes the upload folders older than two days that no run names (`used('uploads/<uuid>/')` says whether one does): photos of a
 * form that was never sent, or a photo that was taken out again. A photo a job uses stays. At most 1000 removals per call.
 */
export function sweepUploads(dir: string, used: (folder: string) => boolean): number {
  const before = Date.now() - UNUSED_UPLOAD_MS;
  let removed = 0;
  for (const { name, at } of folders(dir)) {
    if (removed >= SWEEP_LIMIT) break;
    if (at >= before || used(`uploads/${name}/`)) continue;
    fs().rmSync(path().join(dir, 'uploads', name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/**
 * Product photos kept on disk, under the data directory: JPEG, PNG or WebP by their first bytes, at most 10 MB.
 * Each photo gets a folder of its own, `uploads/<uuid>/1.<ext>`, with the uploader's id beside it; the returned path is what
 * `ProductInput.images` holds and what the engine hands to the worker. Refused: `Error('upload-type')`, `Error('upload-size')`,
 * `Error('upload-quota')` (more than `UPLOADS_PER_DAY` in 24 hours). Unused photos are swept when the engine opens (`sweepUploads`).
 * The photograph of a person (`kind`) is read further than its first bytes: one whose bytes do not say its size is not a picture a
 * person swap can be made with, and is not stored (`Error('upload-unreadable')`).
 */
export const diskUploads: Uploads = {
  saveVideo,
  async save(userId, file, kind) {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('upload-size' satisfies UploadRefusal);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error('upload-size' satisfies UploadRefusal);
    const ext = typeOf(bytes.subarray(0, 12));
    if (!ext) throw new Error('upload-type' satisfies UploadRefusal);
    if (kind === 'person' && photoSize(bytes) === null) throw new Error('upload-unreadable' satisfies UploadRefusal);
    if (uploadsToday(dataDir(), userId) >= UPLOADS_PER_DAY) throw new Error('upload-quota' satisfies UploadRefusal);
    const id = crypto().randomUUID();
    const folder = path().join(dataDir(), 'uploads', id);
    fs().mkdirSync(folder, { recursive: true });
    const name = `1.${ext}`;
    // The photo under a temp name and renamed, then the marker: a reader never finds half a photo, nor a marker without one.
    fs().writeFileSync(path().join(folder, `${name}.tmp`), bytes);
    fs().renameSync(path().join(folder, `${name}.tmp`), path().join(folder, name));
    fs().writeFileSync(path().join(folder, UPLOADER), userId);
    return `uploads/${id}/${name}`;
  },
};


export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const VIDEO_UPLOADS_PER_DAY = 10;
const VIDEO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface VideoUpload { path: string; sha256: string; seconds: number; width: number; height: number; bytes: number; name?: string }

/** Display metadata only: strip local path/control characters; unnamed legacy uploads use a neutral filename. */
export function videoUploadTitle(upload: Pick<VideoUpload, 'name'>): string {
  return (typeof upload.name === 'string' ? upload.name.split(/[\\/]/).at(-1)!.replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, '').trim().slice(0, 200) : '') || 'video.mp4';
}

/** Every component must remain under the data root and must be a real file/directory, never a symlink. */
function safeFile(dir: string, stored: string): boolean {
  try {
    let current = path().resolve(dir);
    for (const segment of stored.split('/')) {
      if (!segment || segment === '.' || segment === '..') return false;
      current = path().join(current, segment);
      if (fs().lstatSync(current).isSymbolicLink()) return false;
    }
    return fs().lstatSync(current).isFile();
  } catch { return false; }
}

/** Immutable server registry, scoped again at prepare admission; the caller supplies only an opaque UUID. */
export function videoUploadOf(id: string, ownerId: Id, dir?: string): VideoUpload | null {
  if (!VIDEO_ID.test(id)) return null;
  try { dir ??= dataDir(); } catch { return null; }
  const stored = `uploads/${id}/source.mp4`;
  if (uploaderOf(stored, dir) !== ownerId || !safeFile(dir, `uploads/${id}/video.json`)) return null;
  try {
    const record = JSON.parse(fs().readFileSync(path().join(dir, 'uploads', id, 'video.json'), 'utf8')) as VideoUpload;
    const size = fs().statSync(path().join(dir, stored)).size;
    if (record.path !== stored || !/^[0-9a-f]{64}$/.test(record.sha256) || record.bytes !== size || size > MAX_VIDEO_BYTES || size <= 0) return null;
    if (!(record.seconds > 0) || !(record.width > 0 && record.height > 0) || Math.abs(record.width / record.height - 9 / 16) >= 0.02) return null;
    return record;
  } catch { return null; }
}

/** How many video reservations this user holds from the last 24 hours (refused attempts count too). */
function videoUploadsToday(dir: string, userId: Id): number {
  return folders(dir).filter(({ name, at }) => {
    if (at < Date.now() - DAY_MS) return false;
    try { return fs().readFileSync(path().join(dir, 'uploads', name, 'video-reservation'), 'utf8') === userId; } catch { return false; }
  }).length;
}

/** True when this user has no video uploads left today: the route asks before it reads a byte of the body. */
export function videoQuotaFull(userId: Id): boolean {
  try { return videoUploadsToday(dataDir(), userId) >= VIDEO_UPLOADS_PER_DAY; } catch { return false; }
}

/** At most this many video bodies are held in memory at once, and one per user: the body is buffered whole. */
const MAX_VIDEO_UPLOADS_RUNNING = 4;
const running = new Set<Id>();

/** A place for one upload of this user, or null when they already have one running or the site is full. Call the returned function to give it back. */
export function claimVideoSlot(userId: Id): (() => void) | null {
  if (running.has(userId) || running.size >= MAX_VIDEO_UPLOADS_RUNNING) return null;
  running.add(userId);
  return () => { running.delete(userId); };
}

/** A new upload folder that holds only the user's reservation: one of the day's video uploads, whatever becomes of it. */
function reserveVideo(dir: string, userId: Id): { id: string; folder: string } {
  const id = crypto().randomUUID(), folder = path().join(dir, 'uploads', id);
  fs().mkdirSync(folder, { recursive: true });
  fs().writeFileSync(path().join(folder, 'video-reservation'), userId, { flag: 'wx' });
  return { id, folder };
}

/** A try that never became a file (the body did not arrive in time, or was no form with a file) uses one of the day's uploads too. */
export function countVideoAttempt(userId: Id): void {
  try { reserveVideo(dataDir(), userId); } catch { /* no data directory: there is no quota to count against */ }
}

/** Reserve quota before awaiting bytes. Rejected attempts count too, a file of a wrong size as well; an unadmitted folder is never served. */
async function saveVideo(userId: Id, file: File): Promise<string> {
  const dir = dataDir();
  const used = videoUploadsToday(dir, userId);
  if (used >= VIDEO_UPLOADS_PER_DAY) throw new Error('upload-quota');
  const { id, folder } = reserveVideo(dir, userId);
  try {
    if (file.size <= 0 || file.size > MAX_VIDEO_BYTES) throw new Error('upload-size');
    return await admitVideo(userId, file, id, folder);
  } catch (error) {
    // A refused file leaves no bytes behind; the reservation stays, so a refusal still counts against the day.
    fs().rmSync(path().join(folder, 'source.mp4'), { force: true });
    throw error;
  }
}

async function admitVideo(userId: Id, file: File, id: string, folder: string): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || bytes.byteLength > MAX_VIDEO_BYTES) throw new Error('upload-size');
  // MP4 and MOV ISO base-media containers only. A playlist renamed .mp4 never reaches ffprobe/transcription.
  if (bytes.length < 12 || Buffer.from(bytes.subarray(4, 8)).toString('ascii') !== 'ftyp') throw new Error('upload-type');
  const video = path().join(folder, 'source.mp4');
  fs().writeFileSync(video, bytes, { flag: 'wx' });
  let facts: { streams?: { codec_type?: string; width?: number; height?: number; side_data_list?: { rotation?: number }[] }[]; format?: { duration?: string } };
  try {
    const child: typeof ChildProcess = process.getBuiltinModule('node:child_process');
    facts = JSON.parse((await process.getBuiltinModule('node:util').promisify(child.execFile)('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'stream=codec_type,width,height:stream_side_data=rotation:format=duration', '-of', 'json', video], {
      encoding: 'utf8', timeout: 15_000, maxBuffer: 256 * 1024, env: { PATH: process.env.PATH, LANG: 'C', NODE_ENV: process.env.NODE_ENV },
    })).stdout);
  } catch { throw new Error('upload-type'); }
  const stream = facts.streams?.find(stream => stream.codec_type === 'video');
  const seconds = Number(facts.format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('upload-type');
  if (seconds > RULES.sourceSecondsMax) throw new Error('upload-length');
  let width = stream?.width ?? 0, height = stream?.height ?? 0;
  if (Math.abs(stream?.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? 0) % 180 === 90) [width, height] = [height, width];
  if (!(width > 0 && height > 0) || Math.abs(width / height - 9 / 16) >= 0.02) throw new Error('upload-ratio');
  const record: VideoUpload = { path: `uploads/${id}/source.mp4`, sha256: crypto().createHash('sha256').update(bytes).digest('hex'), seconds, width, height, bytes: bytes.length, name: videoUploadTitle({ name: file.name }) };
  fs().writeFileSync(path().join(folder, 'video.json'), JSON.stringify(record), { flag: 'wx' });
  fs().writeFileSync(path().join(folder, UPLOADER), userId, { flag: 'wx' });
  return id;
}
