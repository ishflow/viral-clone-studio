// @vitest-environment node
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStore, resetStore } from '@/data/mock/store';
import { addDemoCustomers } from '@/data/mock/test-helpers';
import { closeSqliteEngines } from '@/data/real/sqlite-engine';
import { jobRecord, makeDataDir } from '@/data/real/testing';

// Here the session is the real one (the signed cookie → `getSessionUser`), not a stand-in: a blocked account is told apart from an
// active one by the session layer alone, and `/media` must not open a file of a job to it.
const jar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.value === undefined ? undefined : { name, value: jar.value }) }),
  headers: async () => new Headers(),
}));

import { GET } from './route';

let dir: string;
let db: DatabaseSync;
const FRAME = ['jobs', 'run-1', 'paid', 'v1', 'image-s1.png'];
const get = (path: string[]) => GET(new Request(`http://site/media/${path.join('/')}`), { params: Promise.resolve({ path }) });

beforeEach(() => {
  ({ dir, db } = makeDataDir());
  vi.stubEnv('VC_ENGINE', 'sqlite');
  vi.stubEnv('VC_DATA_DIR', dir);
  resetStore();
  addDemoCustomers();
  getStore().jobs.push(jobRecord({ id: 'job-1', userId: 'usr-demo' }));
  db.prepare(`INSERT INTO runs (id, kind, ref, state, input, steps, created_at, updated_at) VALUES ('run-1', 'produce', 'job-1', 'running', '{}', '[]', 'a', 'a')`).run();
  mkdirSync(dirname(join(dir, ...FRAME)), { recursive: true });
  writeFileSync(join(dir, ...FRAME), 'png');
  db.prepare(`INSERT INTO operations (run_id, key, kind, state, output, created_at, updated_at) VALUES ('run-1', 'v1:image:s1', 'image', 'done', ?, 'a', 'a')`).run(FRAME.join('/'));
  jar.value = 'usr-demo';
});
afterEach(() => {
  closeSqliteEngines();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  resetStore();
});

describe('/media with the session layer', () => {
  it('the owner\'s session opens the frame of their job; once the account is blocked the same cookie opens nothing', async () => {
    expect((await get(FRAME)).status).toBe(200);
    getStore().users.find((user) => user.id === 'usr-demo')!.blocked = true;
    expect((await get(FRAME)).status).toBe(404);
  });

  it('the same goes for the clip and the music of the job', async () => {
    for (const [key, kind, name] of [['v1:clip:s1', 'clip', 'clip-s1.mp4'], ['v1:music', 'music', 'music.mp3']] as const) {
      writeFileSync(join(dir, 'jobs/run-1/paid/v1', name), 'bytes');
      db.prepare(`INSERT INTO operations (run_id, key, kind, state, output, created_at, updated_at) VALUES ('run-1', ?, ?, 'done', ?, 'a', 'a')`).run(key, kind, `jobs/run-1/paid/v1/${name}`);
    }
    const files = [['jobs', 'run-1', 'paid', 'v1', 'clip-s1.mp4'], ['jobs', 'run-1', 'paid', 'v1', 'music.mp3']];
    expect((await Promise.all(files.map(get))).map((response) => response.status)).toEqual([200, 200]);
    getStore().users.find((user) => user.id === 'usr-demo')!.blocked = true;
    expect((await Promise.all(files.map(get))).map((response) => response.status)).toEqual([404, 404]);
  });

  it('a cookie of nobody the store knows opens nothing', async () => {
    jar.value = 'usr-nobody';
    expect((await get(FRAME)).status).toBe(404);
  });
});
