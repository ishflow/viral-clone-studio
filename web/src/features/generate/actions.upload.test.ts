// @vitest-environment node
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/session/session', async () => {
  const { data } = await import('@/data');
  const readUser = async () => data.auth.getUser('usr-demo');
  return { getSessionUser: readUser, getSessionState: async () => {
    const user = await readUser();
    return user ? { kind: user.blocked ? 'blocked' : 'active', user } : { kind: 'anonymous' };
  } };
});
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));

import { resetStore } from '@/data/mock/store';
import { addDemoCustomers } from '@/data/mock/test-helpers';
import { closeSqliteEngines } from '@/data/real/sqlite-engine';
import { makeDataDir } from '@/data/real/testing';
import { uploadProductImage } from './actions';

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1];
const send = (file: File) => {
  const form = new FormData();
  form.set('file', file);
  return uploadProductImage(form);
};

let dir: string;
let db: DatabaseSync;
beforeEach(() => {
  ({ dir, db } = makeDataDir());
  vi.stubEnv('VC_ENGINE', 'sqlite');
  vi.stubEnv('VC_DATA_DIR', dir);
  resetStore();
  addDemoCustomers();   // the real engine's store seeds the administrator only
});
afterEach(() => {
  closeSqliteEngines();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  resetStore();
});

describe('uploadProductImage, next to the real engine', () => {
  it('a JPEG is stored under a generated name; the answer is the path the form sends', async () => {
    const outcome = await send(new File([new Uint8Array(JPEG)], '../../x.jpg', { type: 'image/jpeg' }));
    expect(outcome).toMatchObject({ status: 'saved' });
    const path = (outcome as { path: string }).path;
    expect(path).toMatch(/^uploads\/[0-9a-f-]{36}\/1\.jpg$/);
    expect(existsSync(join(dir, path))).toBe(true);
  });

  it('a PDF renamed .jpg is a field error (type); nothing is stored', async () => {
    const pdf = new File([new TextEncoder().encode('%PDF-1.7\n')], 'photo.jpg', { type: 'image/jpeg' });
    expect(await send(pdf)).toEqual({ status: 'refused', code: 'type' });
    expect(existsSync(join(dir, 'uploads'))).toBe(false);
  });

  it('11 MB is a field error (size); nothing is stored', async () => {
    const big = new Uint8Array(11 * 1024 * 1024);
    big.set(JPEG);
    expect(await send(new File([big], 'big.jpg', { type: 'image/jpeg' }))).toEqual({ status: 'refused', code: 'size' });
    expect(existsSync(join(dir, 'uploads')) ? readdirSync(join(dir, 'uploads')) : []).toEqual([]);
  });

  it('over the daily number of photos is a field error (quota)', async () => {
    const { UPLOADS_PER_DAY } = await import('@/data/real/uploads');
    for (let n = 0; n < UPLOADS_PER_DAY; n += 1) await send(new File([new Uint8Array(JPEG)], `${n}.jpg`));
    expect(await send(new File([new Uint8Array(JPEG)], 'more.jpg'))).toEqual({ status: 'refused', code: 'quota' });
  });

  it('no file at all: unreadable', async () => {
    expect(await uploadProductImage(new FormData())).toEqual({ status: 'refused', code: 'unreadable' });
  });
});

describe('uploadProductImage, next to the demo engine', () => {
  beforeEach(() => vi.stubEnv('VC_ENGINE', 'mock'));   // the demo engine refuses with UploadRejectedError, not with a message

  it('a refusal thrown as UploadRejectedError(\'type\') answers type, not unreadable', async () => {
    expect(await send(new File(['hello'], 'notes.txt', { type: 'text/plain' }))).toEqual({ status: 'refused', code: 'type' });
  });

  it('an empty file is unreadable', async () => {
    expect(await send(new File([], 'empty.jpg', { type: 'image/jpeg' }))).toEqual({ status: 'refused', code: 'unreadable' });
  });
});
