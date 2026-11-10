import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Media } from '../ports.ts';
import { uploadSource } from './upload.ts';

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'upload-lease-'));
  const uploadId = '12345678-1234-1234-1234-123456789abc';
  const folder = join(dataDir, 'uploads', uploadId);
  mkdirSync(folder, { recursive: true });
  const bytes = Buffer.from('\0\0\0\x20ftypisom-local-fixture');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(folder, 'source.mp4'), bytes);
  writeFileSync(join(folder, 'uploader'), 'owner');
  writeFileSync(join(folder, 'video.json'), JSON.stringify({ path: `uploads/${uploadId}/source.mp4`, bytes: bytes.length, sha256 }));
  const trims: { from: number; to: number; out: string }[] = [];
  const media: Pick<Media, 'probe' | 'trim'> = {
    trim: async (_file, from, to, out) => { trims.push({ from, to, out }); writeFileSync(out, 'cut'); return { seconds: to - from, width: 90, height: 160, fps: 30, frames: Math.round((to - from) * 30), audio: false }; },
    probe: async () => ({ seconds: 5, width: 90, height: 160, fps: 30, frames: 150, audio: false }) };
  const deps = { dataDir, media };
  const upload = { uploadId, sha256 };
  const lease = { runId: 'run-test', workerId: 'worker/a', takeovers: 0 };
  const destination = join(dataDir, 'sources', 'template');
  return { dataDir, bytes, deps, upload, lease, destination, trims };
}

describe('upload admission copy lifetime', () => {
  it('reuses one immutable copy for retries of the same lease and records its custody', async () => {
    const w = fixture();
    await uploadSource(w.deps, w.destination, 'owner', w.upload, w.lease);
    await uploadSource(w.deps, w.destination, 'owner', w.upload, w.lease);
    const root = join(w.dataDir, 'jobs', w.lease.runId, 'upload-attempts');
    const attempts = readdirSync(root);
    expect(attempts).toHaveLength(1);
    expect(readFileSync(join(root, attempts[0]!, 'source.mp4'))).toEqual(w.bytes);
    expect(JSON.parse(readFileSync(join(root, attempts[0]!, 'lease.json'), 'utf8'))).toMatchObject({ ...w.lease, ownerId: 'owner', uploadId: w.upload.uploadId });
    expect(existsSync(join(w.dataDir, 'upload-attempts'))).toBe(false);
  });

  it('isolates takeover generations even when sanitized worker names collide', async () => {
    const w = fixture();
    await uploadSource(w.deps, w.destination, 'owner', w.upload, w.lease);
    await uploadSource(w.deps, w.destination, 'owner', w.upload, { ...w.lease, workerId: 'worker_a', takeovers: 1 });
    expect(readdirSync(join(w.dataDir, 'jobs', w.lease.runId, 'upload-attempts'))).toHaveLength(2);
  });

  it('keeps a refused copy bound to its run, reuses it, and never publishes after lease loss', async () => {
    const w = fixture();
    w.deps.media.probe = async () => { throw new Error('probe refused'); };
    for (let i = 0; i < 2; i++) await expect(uploadSource(w.deps, w.destination, 'owner', w.upload, w.lease)).rejects.toThrow('upload is unavailable');
    expect(readdirSync(join(w.dataDir, 'jobs', w.lease.runId, 'upload-attempts'))).toHaveLength(1);
    let active = true;
    w.deps.media.probe = async () => { active = false; return { seconds: 5, width: 90, height: 160, fps: 30, frames: 150, audio: false }; };
    await expect(uploadSource({ ...w.deps, checkOwnership: () => { if (!active) throw new Error('lost'); } }, w.destination, 'owner', w.upload, w.lease)).rejects.toThrow('upload is unavailable');
    expect(existsSync(join(w.destination, 'source.mp4'))).toBe(false);
  });
});

describe('upload with a range', () => {
  const long = { seconds: 150, width: 90, height: 160, fps: 30, frames: 4500, audio: false };
  it('a 150 s upload with a range is cut and admitted as the cut part; without a range it is refused', async () => {
    const w = fixture();
    w.deps.media.probe = async () => long;
    await expect(uploadSource(w.deps, w.destination, 'owner', w.upload, w.lease)).rejects.toThrow('upload is unavailable');
    const source = await uploadSource(w.deps, w.destination, 'owner', w.upload, w.lease, { from: 30, to: 80 });
    expect(source).toMatchObject({ video: join(w.destination, 'source.mp4'), seconds: 50 });
    expect(w.trims).toEqual([{ from: 30, to: 80, out: join(w.destination, 'source.mp4') }]);
    expect(JSON.parse(readFileSync(join(w.destination, 'meta.json'), 'utf8'))).toMatchObject({ seconds: 50, range: { from: 30, to: 80 }, file: 'source.mp4' });
  });

  it('a range that is not one of this video is refused as a bad range, and nothing is published', async () => {
    const w = fixture();
    w.deps.media.probe = async () => long;
    for (const range of [{ from: 0, to: 61 }, { from: 140, to: 160 }, { from: 5, to: 6 }]) {
      await expect(uploadSource(w.deps, w.destination, 'owner', w.upload, w.lease, range)).rejects.toMatchObject({ name: 'RangeRefused' });
    }
    expect(w.trims).toEqual([]);
    expect(existsSync(join(w.destination, 'source.mp4'))).toBe(false);
  });

  it('a video over five minutes is refused even with a range', async () => {
    const w = fixture();
    w.deps.media.probe = async () => ({ ...long, seconds: 301, frames: 9030 });
    await expect(uploadSource(w.deps, w.destination, 'owner', w.upload, w.lease, { from: 0, to: 30 })).rejects.toThrow('upload is unavailable');
  });
});
