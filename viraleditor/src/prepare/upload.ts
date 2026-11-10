// The upload registry is written by the site. No caller-provided path reaches a decoder.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { SourceRange } from '../contracts.ts';
import type { Media } from '../ports.ts';
import { SOURCE_SECONDS_MAX, VIDEO_SECONDS_MAX } from '../template/limits.ts';
import { cutRange, fitRange, RangeRefused, SourceUnavailable } from './read.ts';
import type { Source } from './read.ts';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_BYTES = 100 * 1024 * 1024;
export interface UploadLease { runId: string; workerId: string | null; takeovers: number }
function regular(root: string, parts: string[]): string {
  let file = root;
  for (const part of parts) {
    file = join(file, part);
    if (lstatSync(file).isSymbolicLink()) throw new SourceUnavailable('upload is not a regular local file');
  }
  if (!lstatSync(file).isFile()) throw new SourceUnavailable('upload is not a regular local file');
  return file;
}

/** Recheck owner and checksum on every retry, copy to an attempt folder, then publish only inside the ownership transaction. */
export async function uploadSource(deps: { dataDir: string; media: Pick<Media, 'probe' | 'trim'>; checkOwnership?: () => void; writeOwned?: <T>(body: () => T) => T }, dir: string,
  owner: string | null, upload: { uploadId: string; sha256?: string }, lease: UploadLease, range?: SourceRange): Promise<Source> {
  try {
    if (!lease?.workerId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(lease.runId) || !Number.isSafeInteger(lease.takeovers) || lease.takeovers < 0) throw new Error('upload lease missing');
    if (!owner || !ID.test(upload.uploadId) || !upload.sha256 || !/^[0-9a-f]{64}$/.test(upload.sha256)) throw new Error('upload identity missing');
    const parts = ['uploads', upload.uploadId];
    const marker = regular(deps.dataDir, [...parts, 'uploader']);
    if (readFileSync(marker, 'utf8') !== owner) throw new Error('upload owner mismatch');
    const registry = JSON.parse(readFileSync(regular(deps.dataDir, [...parts, 'video.json']), 'utf8')) as { sha256?: string; path?: string; bytes?: number; name?: string };
    const file = regular(deps.dataDir, [...parts, 'source.mp4']);
    const size = lstatSync(file).size;
    if (registry.path !== `uploads/${upload.uploadId}/source.mp4` || registry.sha256 !== upload.sha256 || registry.bytes !== size || size <= 0 || size > MAX_BYTES) throw new Error('upload registry mismatch');
    const bytes = readFileSync(file);
    if (bytes.subarray(4, 8).toString('ascii') !== 'ftyp' || createHash('sha256').update(bytes).digest('hex') !== upload.sha256) throw new Error('upload checksum mismatch');
    const guard = deps.checkOwnership ?? (() => {});
    const owned = deps.writeOwned ?? (<T>(body: () => T) => body());
    // One immutable admission copy per run/lease/source. Hash the full identity, not a lossy worker tag.
    // The jobs retirement policy protects active runs and retires terminal prepare trees without deletion.
    const identity = createHash('sha256').update(JSON.stringify([lease.workerId, lease.takeovers, upload.uploadId, upload.sha256])).digest('hex');
    const attempt = join(deps.dataDir, 'jobs', lease.runId, 'upload-attempts', identity);
    guard();
    const copy = join(attempt, 'source.mp4');
    owned(() => {
      guard(); mkdirSync(attempt, { recursive: true });
      if (!existsSync(copy)) copyFileSync(file, copy);
      regular(deps.dataDir, ['jobs', lease.runId, 'upload-attempts', identity, 'source.mp4']);
      writeFileSync(join(attempt, 'lease.json'), JSON.stringify({ ...lease, ownerId: owner, uploadId: upload.uploadId, sha256: upload.sha256 }));
    });
    if (createHash('sha256').update(readFileSync(copy)).digest('hex') !== upload.sha256) throw new Error('upload changed during copy');
    const facts = await deps.media.probe(copy);
    guard();
    if (!(facts.seconds > 0 && facts.seconds <= (range ? SOURCE_SECONDS_MAX : VIDEO_SECONDS_MAX) && facts.width > 0 && facts.height > 0) || Math.abs(facts.width / facts.height - 9 / 16) >= 0.02) throw new Error('upload media admission failed');
    const video = join(dir, 'source.mp4');
    // the part the customer picked is cut straight into the source folder (the guarded media port publishes it inside the ownership transaction)
    const cut = range ? fitRange(range, facts.seconds) : undefined;
    if (cut) { guard(); mkdirSync(dir, { recursive: true }); await cutRange(deps.media, copy, cut, video); guard(); }
    const source: Source = { video, url: '', title: typeof registry.name === 'string' ? registry.name : 'video.mp4', seconds: cut ? cut.to - cut.from : facts.seconds, views: null, likes: null };
    owned(() => {
      mkdirSync(dir, { recursive: true }); if (!cut) copyFileSync(copy, video);
      writeFileSync(join(dir, 'meta.json'), JSON.stringify({ url: '', file: relative(dir, video), title: source.title, seconds: source.seconds, views: null, likes: null, sheet: null, sha256: upload.sha256, ...(cut ? { range: cut } : {}) }));
    });
    return source;
  } catch (error) {
    if (error instanceof SourceUnavailable || error instanceof RangeRefused) throw error;
    throw new SourceUnavailable('upload is unavailable or failed local admission');
  }
}
