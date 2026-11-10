// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diskUploads, MAX_UPLOAD_BYTES, UPLOADS_PER_DAY, uploaderOf, videoUploadOf, videoUploadTitle, VIDEO_UPLOADS_PER_DAY } from './uploads';

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const PDF = [...Buffer.from('%PDF-1.7\n%âãÏÓ')];
const file = (bytes: number[], name: string, type = 'image/jpeg') => new File([new Uint8Array(bytes)], name, { type });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vc-uploads-'));
  vi.stubEnv('VC_DATA_DIR', dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('diskUploads', () => {
  it('keeps a JPEG, PNG or WebP under a generated name with its own type, and records who sent it', async () => {
    for (const [bytes, ext] of [[JPEG, 'jpg'], [PNG, 'png'], [WEBP, 'webp']] as const) {
      const stored = await diskUploads.save('usr-demo', file([...bytes], 'photo.heic'));
      expect(stored).toMatch(new RegExp(`^uploads/[0-9a-f-]{36}/1\\.${ext}$`));
      expect([...readFileSync(join(dir, stored))]).toEqual([...bytes]);
      expect(uploaderOf(stored, dir)).toBe('usr-demo');
    }
  });

  it('a PDF named .jpg is refused for its bytes, and nothing is written', async () => {
    await expect(diskUploads.save('usr-demo', file(PDF, 'photo.jpg'))).rejects.toThrow('upload-type');
    await expect(diskUploads.save('usr-demo', file([], 'empty.png'))).rejects.toThrow('upload-type');
    expect(existsSync(join(dir, 'uploads'))).toBe(false);
  });

  it('a file over 10 MB is refused, and nothing is written', async () => {
    const big = new Uint8Array(11 * 1024 * 1024);
    big.set(JPEG);
    await expect(diskUploads.save('usr-demo', new File([big], 'big.jpg'))).rejects.toThrow('upload-size');
    const edge = new Uint8Array(MAX_UPLOAD_BYTES);
    edge.set(JPEG);
    await expect(diskUploads.save('usr-demo', new File([edge], 'edge.jpg'))).resolves.toMatch(/\.jpg$/);
    expect(readdirSync(join(dir, 'uploads'))).toHaveLength(1);
  });

  it('a hostile name ("../../x.jpg") is never used: the photo lands under uploads/ with a generated name', async () => {
    const stored = await diskUploads.save('usr-demo', file(JPEG, '../../x.jpg'));
    expect(stored).toMatch(/^uploads\/[0-9a-f-]{36}\/1\.jpg$/);
    expect(existsSync(join(dir, '..', 'x.jpg'))).toBe(false);
    expect(readdirSync(dir)).toEqual(['uploads']);
  });

  it('a user keeps at most UPLOADS_PER_DAY photos a day; the next one is refused (upload-quota), another user is not affected', async () => {
    for (let n = 0; n < UPLOADS_PER_DAY; n += 1) await diskUploads.save('usr-demo', file(JPEG, `${n}.jpg`));
    await expect(diskUploads.save('usr-demo', file(JPEG, 'one-more.jpg'))).rejects.toThrow('upload-quota');
    await expect(diskUploads.save('usr-paying', file(JPEG, 'theirs.jpg'))).resolves.toMatch(/\.jpg$/);
  });

  it('the photo is written before the uploader marker: a marker alone is not an upload', async () => {
    const stored = await diskUploads.save('usr-demo', file(JPEG, 'a.jpg'));
    rmSync(join(dir, stored));
    expect(uploaderOf(stored, dir)).toBeNull();
  });

  it('uploaderOf: only a stored-photo path has an uploader', () => {
    expect(uploaderOf('uploads/../../etc/passwd', dir)).toBeNull();
    expect(uploaderOf('oil.png', dir)).toBeNull();
    expect(uploaderOf('uploads/00000000-0000-0000-0000-000000000000/1.png', dir)).toBeNull();
  });
});


describe('video upload admission', () => {
  it('keeps the filename as display text without local paths/control characters; unnamed uploads have a neutral filename', () => {
    expect(videoUploadTitle({ name: 'C:\\private\\ürün\u202E\n-denemesi.mp4' })).toBe('ürün-denemesi.mp4');
    expect(videoUploadTitle({})).toBe('video.mp4');
    expect(videoUploadTitle({ name: '   ' })).toBe('video.mp4');
  });
  it('refuses a playlist and an arbitrary upload id before any preparation', async () => {
    await expect(diskUploads.saveVideo!('usr-demo', file([...Buffer.from('#EXTM3U\nhttps://127.0.0.1/x')], 'x.mp4', 'video/mp4'))).rejects.toThrow('upload-type');
    expect(videoUploadOf('../outside', 'usr-demo', dir)).toBeNull();
  });
  it('admits a real vertical local MP4 with opaque identity and checksum; rejects a different owner and a symlink', async () => {
    const { execFileSync } = await import('node:child_process');
    const { symlinkSync, renameSync } = await import('node:fs');
    const source = join(dir, 'input.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=90x160:r=30', '-t', '1', '-c:v', 'libx264', source]);
    const id = await diskUploads.saveVideo!('usr-demo', new File([readFileSync(source)], '../../input.mov', { type: 'video/quicktime' }));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const admitted = videoUploadOf(id, 'usr-demo', dir)!;
    expect(admitted).toMatchObject({ seconds: 1, width: 90, height: 160, name: 'input.mov' });
    expect(admitted.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(videoUploadOf(id, 'other', dir)).toBeNull();
    expect(uploaderOf(`uploads/${id}/source.mp4`, dir)).toBe('usr-demo');
    renameSync(join(dir, admitted.path), join(dir, 'original.mp4'));
    symlinkSync(join(dir, 'original.mp4'), join(dir, admitted.path));
    expect(videoUploadOf(id, 'usr-demo', dir)).toBeNull();
  });
});

it('probes a video without blocking the process', async () => {
  const { execFileSync } = await import('node:child_process');
  const source = join(dir, 'ok.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=90x160:r=30', '-t', '1', '-c:v', 'libx264', source]);
  const blocking = vi.spyOn(process.getBuiltinModule('node:child_process'), 'execFileSync');
  const id = await diskUploads.saveVideo!('usr-demo', new File([readFileSync(source)], 'ok.mp4'));
  expect(blocking).not.toHaveBeenCalled();
  expect(videoUploadOf(id, 'usr-demo', dir)).toMatchObject({ seconds: 1, width: 90, height: 160 });
});

describe('a refused video upload', () => {
  const ftypJunk = () => new File([new Uint8Array([0, 0, 0, 12, ...Buffer.from('ftyp'), 0, 0, 0, 0, 1, 2, 3, 4])], 'x.mp4', { type: 'video/mp4' });
  it('keeps no source bytes on disk but keeps the quota reservation', async () => {
    await expect(diskUploads.saveVideo!('usr-demo', ftypJunk())).rejects.toThrow('upload-type');
    const [id] = readdirSync(join(dir, 'uploads'));
    expect(readdirSync(join(dir, 'uploads', id!))).toEqual(['video-reservation']);
  });
  it('a wrong-ratio video is dropped as well, and ten refusals still use up the day', async () => {
    const { execFileSync } = await import('node:child_process');
    const wide = join(dir, 'wide.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=30', '-t', '1', '-c:v', 'libx264', wide]);
    await expect(diskUploads.saveVideo!('usr-demo', new File([readFileSync(wide)], 'w.mp4'))).rejects.toThrow('upload-ratio');
    expect(readdirSync(join(dir, 'uploads', readdirSync(join(dir, 'uploads'))[0]!))).toEqual(['video-reservation']);
    for (let i = 1; i < VIDEO_UPLOADS_PER_DAY; i++) await expect(diskUploads.saveVideo!('usr-demo', ftypJunk())).rejects.toThrow('upload-type');
    await expect(diskUploads.saveVideo!('usr-demo', ftypJunk())).rejects.toThrow('upload-quota');
  });
});

it('a video file of a size that is never taken (empty, or over the limit) uses one of the day too', async () => {
  const empty = new File([], 'empty.mp4', { type: 'video/mp4' });
  for (let i = 0; i < VIDEO_UPLOADS_PER_DAY; i++) await expect(diskUploads.saveVideo!('usr-demo', empty)).rejects.toThrow('upload-size');
  await expect(diskUploads.saveVideo!('usr-demo', empty)).rejects.toThrow('upload-quota');
  await expect(diskUploads.saveVideo!('usr-paying', empty)).rejects.toThrow('upload-size');
});

it('bounds video quota across overlapping requests before reading their buffers', async () => {
  let reads = 0;
  const pending: (() => void)[] = [];
  const file = { size: 12, arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { reads++; pending.push(() => resolve(new Uint8Array(12).buffer)); }) } as File;
  const requests = Array.from({ length: VIDEO_UPLOADS_PER_DAY }, () => diskUploads.saveVideo!('usr-demo', file).catch(error => error));
  await expect(diskUploads.saveVideo!('usr-demo', file)).rejects.toThrow('upload-quota');
  expect(reads).toBe(VIDEO_UPLOADS_PER_DAY);
  for (const resolve of pending) resolve();
  expect((await Promise.all(requests)).every(error => error.message === 'upload-type')).toBe(true);
});
