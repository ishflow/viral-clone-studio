import type * as Fs from 'node:fs';
import type * as Path from 'node:path';
import type * as Sqlite from 'node:sqlite';
import { dataDir, persistent } from '../mock/persist';
import { jobImagesKept, jobMediaKept, jobVideoServed } from './media-retention';
import { getStore, now } from '../mock/store';
import type { User } from '../ports';
import { SERVED_KINDS, isJobFile, seesJobFrames } from '../job-frames';
import { isSourceFrame, seesSourceFrames } from '../source-frames';
import { regenOf } from './rows';
import { photographsOf } from './swap-photos';
import { UPLOAD_PATH, VIDEO_UPLOAD_PATH, uploaderOf } from './uploads';

// Who may see which file of the data directory (`/media/<path>`). Anything not named here is not served.
//   templates/<id>/poster.jpg, sample.mp4, reference.*   a published catalog template: everyone · any other: its owner and the admins
//   templates/<id>/shots/<n>.jpg, a customer's poster.jpg   frames of the source video: the template's owner and the admins, never a catalog template's visitors
//   templates/<id>/… of a person-swap video (its card has `swap`)   the admins only, while person swap is switched off
//   jobs/<runId>/v<k>/final.mp4, poster.jpg the job's owner and the admins
//   jobs/<runId>/paid/v<k>/<file>           an output the job's own `operations` row records as a finished image, clip or music (a shot's first frame, its clip,
//                                           a shared picture, the music): the job's owner and the admins, while the job's pictures are kept. The voice, and any file no row names, never
//                                           of a person swap (its parts, unlabelled): the admins only
//   uploads/<uuid>/<n>.<ext>                the uploader and the admins
//                                           a photograph of a person swap an admin said yes to: the uploader only
//   sources/<id>/source.mp4                 the admins, and the owner of the private template made from it (spec §3.8)

const fs = (): typeof Fs => process.getBuiltinModule('node:fs');
const path = (): typeof Path => process.getBuiltinModule('node:path');
const sqlite = (): typeof Sqlite => process.getBuiltinModule('node:sqlite');

const TYPES: Record<string, string> = { mp4: 'video/mp4', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4' };
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface MediaFile { file: string; type: string; size: number }

/** One read of the database, on a connection of its own that is closed again: `/media` never writes. */
function query<T>(dir: string, sql: string, ...args: string[]): T | undefined {
  const file = path().join(dir, 'db.sqlite');
  if (!fs().existsSync(file)) return undefined;
  const db = new (sqlite().DatabaseSync)(file, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    return db.prepare(sql).get(...args) as T | undefined;
  } finally {
    db.close();
  }
}

/** May this viewer see the file at these path segments? Each rule above, nothing else. */
function allowed(segments: string[], viewer: User | null, dir: string): boolean {
  const admin = viewer?.role === 'admin';
  const [area, id, ...rest] = segments;
  if (!id || !ID.test(id)) return false;
  const name = rest.join('/');
  if (area === 'templates') {
    if (!['poster.jpg', 'sample.mp4', 'reference.jpg', 'reference.mp4'].includes(name) && !/^shots\/[1-9]\d{0,2}\.jpg$/.test(name)) return false;
    const row = query<{ state: string; owner: string | null; swap: number | null }>(dir,
      "SELECT state, owner, json_valid(card) AND json_type(card, '$.swap') = 'object' AS swap FROM templates WHERE id = ?", id);
    if (!row || (row.owner !== null && !getStore().users.some(user => user.id === row.owner))) return false;
    if (row.swap && getStore().limits.personSwap !== true && !admin) return false;   // while person swap is switched off nothing of it is shown, on no way
    if (isSourceFrame(name, row.owner !== null)) return seesSourceFrames(row.owner, viewer);
    return (row.state === 'published' && row.owner === null) || admin || (viewer !== null && row.owner === viewer.id);
  }
  if (area === 'jobs') {
    const made = isJobFile(id, `jobs/${id}/${name}`);
    if (!made && !/^v[1-9]\/(final\.mp4|poster\.jpg)$/.test(name)) return false;
    const run = query<{ ref: string }>(dir, `SELECT ref FROM runs WHERE id = ? AND kind = 'produce'`, id);
    if (!run) return false;
    // A made file is the job's own only when a finished request of this run recorded exactly this path: the asked name is matched to that list, never trusted as a path
    if (made && !query(dir, `SELECT 1 FROM operations WHERE run_id = ? AND state = 'done' AND kind IN (${SERVED_KINDS.map(() => '?').join(', ')}) AND output = ?`, id, ...SERVED_KINDS, `jobs/${id}/${name}`)) return false;
    const jobId = regenOf(run.ref)?.jobId ?? run.ref;                       // a regeneration's ref is `<jobId>/<variantId>/<runId>`
    const job = getStore().jobs.find((item) => item.id === jobId);
    if (job === undefined) return false;
    // The parts of a person swap carry no label that an AI made them (and no sound): the customer's video is the finished one, only an admin sees a part
    if (made) return (!job.swap || admin) && jobImagesKept(job) && seesJobFrames(job.userId, viewer);
    return jobVideoServed(job) && (admin || (viewer !== null && job.userId === viewer.id));
  }
  if (area === 'uploads') {
    const stored = segments.join('/');
    if (!UPLOAD_PATH.test(stored) && !VIDEO_UPLOAD_PATH.test(stored)) return false;
    const uploader = uploaderOf(stored, dir);
    if (!getStore().users.some(user => user.id === uploader)) return false;
    const jobs = getStore().jobs.filter(job => job.input.products.some(product => product.images.includes(stored)));
    if (jobs.length > 0 && !jobs.some(jobImagesKept)) return false;
    // The photograph of a person swap is an admin's for the look only: when every person swap that names it has its yes, only its uploader sees it
    const swaps = getStore().jobs.filter(job => job.swap?.people.some(person => photographsOf(person).includes(stored)));
    const looked = swaps.length > 0 && swaps.every(job => job.swap!.review === 'approved');
    return (admin && !looked) || (viewer !== null && uploader === viewer.id);
  }
  if (area === 'sources') {
    if (name !== 'source.mp4') return false;
    const record = query<{ owner: string | null }>(dir, 'SELECT owner FROM templates WHERE id = ?', id);
    // Account deletion removes the template row; the durable prepare input still records its former owner.
    const prepared = record ? undefined : query<{ owner: string | null }>(dir,
      "SELECT json_extract(input, '$.ownerId') AS owner FROM runs WHERE kind = 'prepare' AND ref = ? AND json_valid(input) ORDER BY created_at DESC LIMIT 1", id);
    const owner = record?.owner ?? prepared?.owner;
    if (owner && !getStore().users.some(user => user.id === owner)) return false;
    if (admin) return true;
    const own = viewer && query<{ id: string }>(dir, 'SELECT id FROM templates WHERE id = ? AND owner = ?', id, viewer.id);
    return Boolean(own);
  }
  return false;
}

/**
 * The file `/media/<segments>` serves to this viewer, or null (the route answers 404, whatever the reason). Only next to the real
 * engine (`VC_ENGINE=sqlite`). A segment that is empty, `.` / `..`, or holds a separator never reaches the disk, and the
 * resolved file must lie inside the data directory, symlinks followed.
 */
export function mediaFile(segments: string[], viewer: User | null): MediaFile | null {
  if (!persistent()) return null;
  if (segments.length < 3 || segments.some((part) => !part || part === '.' || part === '..' || /[\\/\0]/.test(part))) return null;
  const type = TYPES[segments.at(-1)!.split('.').at(-1) ?? ''];
  if (!type) return null;
  const dir = dataDir();
  try {
    if (!allowed(segments, viewer, dir)) return null;               // inside the try: a database that cannot be read is a 404 too
    const root = fs().realpathSync(dir);
    const file = fs().realpathSync(path().join(dir, ...segments));
    if (!file.startsWith(root + path().sep)) return null;
    if (segments[0] === 'jobs' && !file.startsWith(path().join(root, 'jobs', segments[1]!) + path().sep)) return null;   // a job's file is really in its own run's folder, not a link to another file of the data directory
    const stat = fs().statSync(file);
    return stat.isFile() ? { file, type, size: stat.size } : null;
  } catch {
    return null;
  }
}


/**
 * Retryable, bounded retirement into an unserved tree. No deletion (the brief forbids it), no backup claim.
 * Run on the site owner only. A live run protects all artifacts of its job; symlinks are never followed.
 * A collision or rename failure leaves the source intact and retries on the next sweep.
 */
export function sweepMedia(dir: string, db: Sqlite.DatabaseSync): { moved: number; failed: number } {
  if (!persistent() || path().resolve(dir) !== path().resolve(dataDir())) return { moved: 0, failed: 0 };
  const store = getStore();
  const runs = db.prepare("SELECT id, kind, ref, state, input FROM runs").all() as { id: string; kind: string; ref: string; state: string; input: string }[];
  const active = runs.filter(run => ['held', 'queued', 'running'].includes(run.state));
  const jobOf = (ref: string) => regenOf(ref)?.jobId ?? ref;
  const protectedJobs = new Set(active.map(run => jobOf(run.ref)));
  const templates = db.prepare('SELECT id, owner FROM templates').all() as { id: string; owner: string | null }[];
  let moved = 0, failed = 0;
  const retire = (area: string, id: string) => {
    if (moved + failed >= 1000) return;
    const source = path().join(dir, area, id);
    let dest = path().join(dir, 'retired', area, id);
    try {
      const checked = [path().join(dir, 'retired')];
      for (const base of [dir, path().join(dir, 'retired')]) {
        let parent = base;
        for (const part of area.split('/')) { parent = path().join(parent, part); checked.push(parent); }
      }
      for (const folder of checked) {
        if (fs().existsSync(folder) && (!fs().lstatSync(folder).isDirectory() || fs().lstatSync(folder).isSymbolicLink())) { failed++; return; }
      }
      // Paid intermediates may already occupy retired/jobs/<run>/paid. Move the later-expired remainder alongside them.
      if (area === 'jobs' && fs().existsSync(path().join(dest, 'paid')) && !fs().existsSync(path().join(source, 'paid')) && !fs().lstatSync(dest).isSymbolicLink()) dest = path().join(dest, 'remaining');
      if (!fs().lstatSync(source).isDirectory() || fs().existsSync(dest)) { failed++; return; }
      fs().mkdirSync(path().dirname(dest), { recursive: true });
      fs().renameSync(source, dest); moved++;
    } catch { failed++; }
  };
  const folders = (area: string): string[] => {
    try {
      const root = path().join(dir, area);
      if (!fs().lstatSync(root).isDirectory() || fs().lstatSync(root).isSymbolicLink()) return [];
      return fs().readdirSync(root).filter(id => ID.test(id));
    } catch { return []; }
  };
  for (const id of folders('jobs')) {
    const run = runs.find(run => run.id === id);
    if (!run || active.some(a => a.id === id) || protectedJobs.has(jobOf(run.ref))) continue;
    const job = store.jobs.find(job => job.id === jobOf(run.ref));
    // The files of a person swap show a person: they are deleted by the job's own deadlines (its close, `sweepSwapVideos`), never moved aside.
    if (job?.swap) continue;
    if (!job || !jobMediaKept(job)) retire('jobs', id);
    else if (!jobImagesKept(job) && fs().existsSync(path().join(dir, 'jobs', id, 'paid'))) retire(`jobs/${id}`, 'paid');
  }
  for (const id of folders('uploads')) {
    const prefix = `uploads/${id}/`;
    // A refused video keeps its quota reservation for the 24 hours the quota counts `uploads/`; retiring it earlier would hand the hits back.
    try { if (fs().existsSync(path().join(dir, prefix, 'video-reservation')) && now().getTime() - fs().lstatSync(path().join(dir, 'uploads', id)).mtimeMs < 86_400_000) continue; } catch { continue; }
    if (active.some(run => run.input.includes(prefix) || run.input.includes(`"${id}"`))) continue;
    const uploader = ['1.png', '1.jpg', '1.webp', 'source.mp4'].map(name => uploaderOf(prefix + name, dir)).find(Boolean);
    const jobs = store.jobs.filter(job => job.input.products.some(product => product.images.some(image => image.startsWith(prefix))));
    if (!store.users.some(user => user.id === uploader) || (jobs.length > 0 && !jobs.some(jobImagesKept))) retire('uploads', id);
  }
  // Older upload copies lacked a run mapping. Protect them conservatively while any upload prepare is active.
  const uploading = active.some(run => {
    try { return run.kind === 'prepare' && JSON.parse(run.input).from?.kind === 'upload'; } catch { return true; }
  });
  if (!uploading) for (const id of folders('upload-attempts')) {
    try { if (now().getTime() - fs().lstatSync(path().join(dir, 'upload-attempts', id)).mtimeMs < 2 * 86_400_000) continue; } catch { continue; }
    retire('upload-attempts', id);
  }
  // Downloads of a prepare run (`prepare-attempts/<runId>/…`): kept for two days after the last write, never while that run is live.
  for (const id of folders('prepare-attempts')) {
    if (active.some(run => run.id === id)) continue;
    try { if (now().getTime() - fs().lstatSync(path().join(dir, 'prepare-attempts', id)).mtimeMs < 2 * 86_400_000) continue; } catch { continue; }
    retire('prepare-attempts', id);
  }
  for (const area of ['sources', 'templates']) for (const id of folders(area)) {
    if (active.some(run => run.ref === id || run.input.includes(`"${id}"`))) continue;
    const references = area === 'sources' ? templates.filter(template => template.id === id || runs.some(run => {
      if (run.kind !== 'prepare' || run.ref !== template.id) return false;
      try { const input = JSON.parse(run.input); return input.from?.kind === 'candidate' && input.from.candidateId === id; } catch { return true; }
    })) : templates.filter(template => template.id === id);
    if (references.some(template => template.owner === null || store.users.some(user => user.id === template.owner))) continue;
    // Unknown source folders may belong to a freshly discovered candidate. Allow two days before retirement.
    try { if (now().getTime() - fs().lstatSync(path().join(dir, area, id)).mtimeMs < 2 * 86_400_000) continue; } catch { continue; }
    retire(area, id);
  }
  return { moved, failed };
}
