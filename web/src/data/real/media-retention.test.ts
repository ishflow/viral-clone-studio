// @vitest-environment node
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { getStore, resetStore } from '../mock/store';
import { addDemoCustomers } from '../mock/test-helpers';
import { jobRecord, makeDataDir, putTemplate } from './testing';
import { mediaFile, sweepMedia } from './media';
let world: ReturnType<typeof makeDataDir>;
beforeEach(() => {
  world = makeDataDir(); vi.stubEnv('VC_ENGINE', 'sqlite'); vi.stubEnv('VC_DATA_DIR', world.dir);
  resetStore(); addDemoCustomers();
  getStore().jobs.push(jobRecord({ id: 'expired', userId: 'usr-demo', status: 'done', finishedAt: '2020-01-01T00:00:00Z' }));
  world.db.prepare("INSERT INTO runs (id, kind, ref, state, input, created_at, updated_at) VALUES ('oldrun', 'produce', 'expired', 'done', '{}', 'a', 'a')").run();
  mkdirSync(join(world.dir, 'jobs/oldrun/v1'), { recursive: true });
  writeFileSync(join(world.dir, 'jobs/oldrun/v1/final.mp4'), 'video');
});
afterEach(() => { world.db.close(); vi.unstubAllEnvs(); resetStore(); });
it('expired media is denied to its owner and the administrator', () => {
  for (const id of ['usr-demo', 'usr-admin']) expect(mediaFile(['jobs', 'oldrun', 'v1', 'final.mp4'], getStore().users.find(u => u.id === id)!)).toBeNull();
});
it('closed and deleted jobs are denied immediately', () => {
  const job = getStore().jobs.at(-1)!; job.finishedAt = new Date().toISOString();
  job.closedAt = new Date().toISOString();
  expect(mediaFile(['jobs', 'oldrun', 'v1', 'final.mp4'], getStore().users[0]!)).toBeNull();
  job.closedAt = null; job.deletedAt = new Date().toISOString();
  expect(mediaFile(['jobs', 'oldrun', 'v1', 'final.mp4'], getStore().users[0]!)).toBeNull();
});
it('expired job artifacts leave the served tree, without deletion; a repeat is harmless', () => {
  expect(sweepMedia(world.dir, world.db).moved).toBe(1);
  expect(existsSync(join(world.dir, 'jobs/oldrun'))).toBe(false);
  expect(existsSync(join(world.dir, 'retired/jobs/oldrun/v1/final.mp4'))).toBe(true);
  expect(sweepMedia(world.dir, world.db).moved).toBe(0);
});
it('an active regeneration protects the job artifacts', () => {
  world.db.prepare("INSERT INTO runs (id, kind, ref, state, input, created_at, updated_at) VALUES ('active', 'produce', 'expired/v2/active', 'running', '{}', 'a', 'a')").run();
  expect(sweepMedia(world.dir, world.db).moved).toBe(0);
  expect(existsSync(join(world.dir, 'jobs/oldrun'))).toBe(true);
});
it('deleted-account artifacts are retired even when their video deadline is future', () => {
  getStore().jobs.at(-1)!.finishedAt = new Date().toISOString();
  getStore().users = getStore().users.filter(u => u.id !== 'usr-demo');
  expect(sweepMedia(world.dir, world.db).moved).toBe(1);
});
it('a destination collision preserves source bytes and remains retryable', () => {
  mkdirSync(join(world.dir, 'retired/jobs/oldrun'), { recursive: true });
  const result = sweepMedia(world.dir, world.db);
  expect(result).toEqual({ moved: 0, failed: 1 });
  expect(existsSync(join(world.dir, 'jobs/oldrun/v1/final.mp4'))).toBe(true);
});
it('product photos are denied after their job image deadline, while video is retained', () => {
  const job = getStore().jobs.at(-1)!;
  job.finishedAt = new Date(Date.now() - 31 * 86_400_000).toISOString();
  const stored = 'uploads/11111111-2222-4333-8444-555555555555/1.png';
  job.input.products.push({ name: 'x', description: '', images: [stored] });
  mkdirSync(join(world.dir, 'uploads/11111111-2222-4333-8444-555555555555'), { recursive: true });
  writeFileSync(join(world.dir, stored), 'image');
  writeFileSync(join(world.dir, 'uploads/11111111-2222-4333-8444-555555555555/uploader'), 'usr-demo');
  const owner = getStore().users.find(u => u.id === 'usr-demo')!;
  expect(mediaFile(stored.split('/'), owner)).toBeNull();
  expect(mediaFile(['jobs', 'oldrun', 'v1', 'final.mp4'], owner)).not.toBeNull();
  expect(sweepMedia(world.dir, world.db).moved).toBe(1);
  expect(existsSync(join(world.dir, 'jobs/oldrun/v1/final.mp4'))).toBe(true);
});

it('retains candidate-source media referenced by a living catalog template', () => {
  getStore().jobs = [];
  putTemplate(world.db, { id: 'catalog', state: 'published' });
  world.db.prepare("INSERT INTO runs (id, kind, ref, state, input, created_at, updated_at) VALUES ('prep', 'prepare', 'catalog', 'done', ?, 'a', 'a')")
    .run(JSON.stringify({ kind: 'prepare', templateId: 'catalog', from: { kind: 'candidate', candidateId: 'candidate' } }));
  mkdirSync(join(world.dir, 'sources/candidate'), { recursive: true });
  writeFileSync(join(world.dir, 'sources/candidate/source.mp4'), 'source');
  const old = new Date(Date.now() - 3 * 86_400_000);
  utimesSync(join(world.dir, 'sources/candidate'), old, old);
  expect(sweepMedia(world.dir, world.db).moved).toBe(1); // orphan oldrun, not the catalog source
  expect(existsSync(join(world.dir, 'sources/candidate/source.mp4'))).toBe(true);
});
it('retires expired paid intermediates while keeping the delivered video', () => {
  getStore().jobs.at(-1)!.finishedAt = new Date(Date.now() - 31 * 86_400_000).toISOString();
  mkdirSync(join(world.dir, 'jobs/oldrun/paid/v1'), { recursive: true });
  writeFileSync(join(world.dir, 'jobs/oldrun/paid/v1/image.png'), 'paid');
  expect(sweepMedia(world.dir, world.db).moved).toBe(1);
  expect(existsSync(join(world.dir, 'jobs/oldrun/v1/final.mp4'))).toBe(true);
  expect(existsSync(join(world.dir, 'retired/jobs/oldrun/paid/v1/image.png'))).toBe(true);
  getStore().jobs.at(-1)!.finishedAt = '2020-01-01T00:00:00Z';
  expect(sweepMedia(world.dir, world.db).moved).toBe(1);
  expect(existsSync(join(world.dir, 'retired/jobs/oldrun/remaining/v1/final.mp4'))).toBe(true);
});
it('denies a deleted owner source after the private template row has been removed', () => {
  world.db.prepare("INSERT INTO runs (id, kind, ref, state, input, created_at, updated_at) VALUES ('privateprep', 'prepare', 'removed-template', 'done', ?, 'a', 'a')")
    .run(JSON.stringify({ kind: 'prepare', templateId: 'removed-template', ownerId: 'removed-user', from: { kind: 'link', url: 'https://www.tiktok.com/@a/video/1' } }));
  mkdirSync(join(world.dir, 'sources/removed-template'), { recursive: true });
  writeFileSync(join(world.dir, 'sources/removed-template/source.mp4'), 'private source');
  expect(mediaFile(['sources', 'removed-template', 'source.mp4'], getStore().users.find(u => u.id === 'usr-admin')!)).toBeNull();
});

const reservation = (name: string, ageMs: number) => {
  const folder = join(world.dir, 'uploads', name);
  mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, 'video-reservation'), 'usr-demo');
  const at = new Date(Date.now() - ageMs); utimesSync(folder, at, at);
  return folder;
};
it('a refused video upload keeps its quota reservation for 24 hours, then leaves the served tree', () => {
  const young = reservation('11111111-1111-4111-8111-111111111111', 3_600_000);
  const old = reservation('22222222-2222-4222-8222-222222222222', 25 * 3_600_000);
  expect(sweepMedia(world.dir, world.db).moved).toBe(2); // the expired job and the old reservation
  expect(existsSync(young)).toBe(true);
  expect(existsSync(old)).toBe(false);
});

const attempt = (run: string, ageMs: number) => {
  const folder = join(world.dir, 'prepare-attempts', run);
  mkdirSync(join(folder, 'u1'), { recursive: true }); writeFileSync(join(folder, 'u1', 'source.mp4'), 'downloaded');
  const at = new Date(Date.now() - ageMs); utimesSync(folder, at, at);
  return folder;
};
it('prepare attempts of a finished run leave the served tree after two days; a young or a live run keeps them', () => {
  world.db.prepare("INSERT INTO runs (id, kind, ref, state, input, created_at, updated_at) VALUES ('prep-live', 'prepare', 'tpl-a', 'running', '{}', 'a', 'a'), ('prep-done', 'prepare', 'tpl-b', 'done', '{}', 'a', 'a')").run();
  const live = attempt('prep-live', 3 * 86_400_000), young = attempt('prep-done', 3_600_000);
  const old = attempt('prep-gone', 3 * 86_400_000);
  sweepMedia(world.dir, world.db);
  expect(existsSync(live)).toBe(true); expect(existsSync(young)).toBe(true);
  expect(existsSync(old)).toBe(false);
  expect(existsSync(join(world.dir, 'retired', 'prepare-attempts', 'prep-gone', 'u1', 'source.mp4'))).toBe(true);
  const done = join(world.dir, 'prepare-attempts', 'prep-done');
  const past = new Date(Date.now() - 3 * 86_400_000); utimesSync(done, past, past);
  sweepMedia(world.dir, world.db);
  expect(existsSync(done)).toBe(false);
});

const HELD_DAY = 86_400_000;
const doneFor = (ms: number, swap: boolean) => {
  const job = getStore().jobs.at(-1)!;
  job.finishedAt = new Date(Date.now() - ms).toISOString();
  if (swap) job.swap = { people: [], review: null }; else delete job.swap;
  return ['usr-demo', 'usr-admin'].map(id => mediaFile(['jobs', 'oldrun', 'v1', 'final.mp4'], getStore().users.find(u => u.id === id)!));
};
it('the video of a person swap is served for 30 days, to its owner and the administrator, and to nobody after', () => {
  expect(doneFor(30 * HELD_DAY - 60_000, true)).not.toContain(null);
  expect(doneFor(30 * HELD_DAY, true)).toEqual([null, null]);
});
it('the video of a product job is served for 12 months as before, not for the 30 days of a person swap', () => {
  expect(doneFor(30 * HELD_DAY, false)).not.toContain(null);
  expect(doneFor(364 * HELD_DAY, false)).not.toContain(null);
  expect(doneFor(367 * HELD_DAY, false)).toEqual([null, null]);
});
it('a person-swap video past its 30 days is not moved aside: it stays where the deletion finds it', () => {
  doneFor(31 * HELD_DAY, true);
  expect(sweepMedia(world.dir, world.db).moved).toBe(0);
  expect(existsSync(join(world.dir, 'jobs/oldrun/v1/final.mp4'))).toBe(true);
  expect(existsSync(join(world.dir, 'retired/jobs/oldrun'))).toBe(false);
});
it('the parts a person swap was made of are not moved aside past the 30 days either; those of a product job are, as before', () => {
  mkdirSync(join(world.dir, 'jobs/oldrun/paid/v1'), { recursive: true });
  writeFileSync(join(world.dir, 'jobs/oldrun/paid/v1/clip-p01.mp4'), 'part');
  doneFor(31 * HELD_DAY, true);
  expect(sweepMedia(world.dir, world.db)).toEqual({ moved: 0, failed: 0 });
  expect(existsSync(join(world.dir, 'jobs/oldrun/paid/v1/clip-p01.mp4'))).toBe(true);
  expect(existsSync(join(world.dir, 'retired/jobs/oldrun'))).toBe(false);
  doneFor(31 * HELD_DAY, false);
  expect(sweepMedia(world.dir, world.db).moved).toBe(1);
  expect(existsSync(join(world.dir, 'retired/jobs/oldrun/paid/v1/clip-p01.mp4'))).toBe(true);
});
it('a stopped person swap nobody looked at is not moved aside (its close deletes its files); a stopped product job is, as before', () => {
  const job = getStore().jobs.at(-1)!;
  Object.assign(job, { status: 'stopped', finishedAt: null, stoppedAt: new Date(Date.now() - 31 * HELD_DAY).toISOString(), swap: { people: [], review: null } });
  expect(sweepMedia(world.dir, world.db).moved).toBe(0);
  expect(existsSync(join(world.dir, 'jobs/oldrun/v1/final.mp4'))).toBe(true);
  delete job.swap;
  expect(sweepMedia(world.dir, world.db).moved).toBe(1);
});
