// @vitest-environment node
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStore, resetStore } from '../mock/store';
import { addDemoCustomers } from '../mock/test-helpers';
import { mediaFile } from './media';
import { jobRecord, makeDataDir } from './testing';

// The first frame the site makes of a shot (`jobs/<runId>/paid/v<k>/image-s<n>.png`, as the job's `operations` row records it) is made of
// the customer's own photographs: only the job's owner and the admins open it, and only while the job's pictures are kept. The other
// kinds of file of a run (clips, music, a shared picture) are in media.job-files.test.ts.

let world: ReturnType<typeof makeDataDir>;
const viewer = (id: string | null) => (id ? getStore().users.find((u) => u.id === id) ?? null : null);
const FRAME = ['paid', 'v1', 'image-s1.png'];
const open = (run: string, name: string[], who: string | null) => mediaFile(['jobs', run, ...name], viewer(who)) !== null;

function putRun(id: string, ref: string, kind = 'produce'): void {
  world.db.prepare("INSERT INTO runs (id, kind, ref, state, input, created_at, updated_at) VALUES (?, ?, ?, 'running', '{}', 'a', 'a')").run(id, kind, ref);
  mkdirSync(join(world.dir, 'jobs', id, 'paid', 'v1'), { recursive: true });
  for (const file of ['image-s1.png', 'image-s12.jpg', 'image-woman.png', 'clip-s1.mp4', 'music.mp3']) writeFileSync(join(world.dir, 'jobs', id, 'paid', 'v1', file), 'bytes');
  for (const [key, kind, file] of [['v1:image:s1', 'image', 'image-s1.png'], ['v1:image:s12', 'image', 'image-s12.jpg']] as const) {
    world.db.prepare("INSERT INTO operations (run_id, key, kind, state, output, created_at, updated_at) VALUES (?, ?, ?, 'done', ?, 'a', 'a')").run(id, key, kind, `jobs/${id}/paid/v1/${file}`);
  }
}

beforeEach(() => {
  world = makeDataDir();
  vi.stubEnv('VC_ENGINE', 'sqlite'); vi.stubEnv('VC_DATA_DIR', world.dir);
  resetStore(); addDemoCustomers();
  getStore().jobs.push(jobRecord({ id: 'job-mine', userId: 'usr-demo' }), jobRecord({ id: 'job-other', userId: 'usr-new' }));
  putRun('run-mine', 'job-mine'); putRun('run-other', 'job-other');
  putRun('run-regen', 'job-mine/job-mine-v1/run-regen');
  putRun('run-prepare', 'job-mine', 'prepare');
});
afterEach(() => { world.db.close(); vi.unstubAllEnvs(); resetStore(); });

describe('/media: the first frame of a shot of a job', () => {
  const WHO: [string, string | null, boolean][] = [['anonymous', null, false], ['another customer', 'usr-new', false], ['the owner', 'usr-demo', true], ['an admin', 'usr-admin', true]];
  for (const [who, id, may] of WHO) {
    it(`${who} ${may ? 'opens' : 'does not open'} the frame of a running job`, () => {
      expect(open('run-mine', FRAME, id)).toBe(may);
    });
  }

  it('a regeneration of the job is the job\'s: its owner and the admin open its frames, another customer does not', () => {
    expect([null, 'usr-new', 'usr-demo', 'usr-admin'].map((id) => open('run-regen', FRAME, id))).toEqual([false, false, true, true]);
  });

  it('a frame of another customer\'s job is closed to the owner of this one, and the other way round', () => {
    expect(open('run-other', FRAME, 'usr-demo')).toBe(false);
    expect(open('run-other', FRAME, 'usr-new')).toBe(true);
  });

  it('a frame that was kept as a JPEG or WebP is served; a file no request recorded is not, whatever its name (a shot number with a leading zero, 0, 1000)', () => {
    expect(open('run-mine', ['paid', 'v1', 'image-s12.jpg'], 'usr-demo')).toBe(true);
    for (const name of ['image-s007.png', 'image-s0.png', 'image-s1000.png']) {
      writeFileSync(join(world.dir, 'jobs/run-mine/paid/v1', name), 'bytes');
      expect(open('run-mine', ['paid', 'v1', name], 'usr-admin')).toBe(false);
    }
  });

  it('a variant 0 or 10, or a file straight under paid/, is served to nobody, recorded or not', () => {
    mkdirSync(join(world.dir, 'jobs/run-mine/paid/v0'), { recursive: true });
    mkdirSync(join(world.dir, 'jobs/run-mine/paid/v10'), { recursive: true });
    writeFileSync(join(world.dir, 'jobs/run-mine/paid/v0/image-s1.png'), 'bytes');
    writeFileSync(join(world.dir, 'jobs/run-mine/paid/v10/image-s1.png'), 'bytes');
    world.db.prepare("INSERT INTO operations (run_id, key, kind, state, output, created_at, updated_at) VALUES ('run-mine', 'v1:image:s5', 'image', 'done', 'jobs/run-mine/paid/v10/image-s1.png', 'a', 'a')").run();
    for (const who of ['usr-demo', 'usr-admin']) for (const name of [['paid', 'v0', 'image-s1.png'], ['paid', 'v10', 'image-s1.png'], ['paid', 'image-s1.png']]) expect(open('run-mine', name, who)).toBe(false);
  });

  it('a run that is not a produce run opens nothing', () => {
    for (const who of ['usr-demo', 'usr-admin']) expect(open('run-prepare', FRAME, who)).toBe(false);
  });

  it('a path that leaves the frame (`..`, another run\'s id, a separator inside a segment, an encoded dot) is refused for the owner and the admin too', () => {
    for (const who of ['usr-demo', 'usr-admin']) {
      expect(mediaFile(['jobs', 'run-mine', 'paid', 'v1', '..', 'v1', 'image-s1.png'], viewer(who))).toBeNull();
      expect(mediaFile(['jobs', 'run-mine', '..', 'run-other', 'paid', 'v1', 'image-s1.png'], viewer(who))).toBeNull();
      expect(mediaFile(['jobs', 'run-mine', 'paid/v1/image-s1.png'], viewer(who))).toBeNull();
      expect(mediaFile(['jobs', 'run-mine', 'paid', 'v1\\image-s1.png'], viewer(who))).toBeNull();
      expect(mediaFile(['jobs', 'run-mine', 'paid', '%2e%2e', 'v1', 'image-s1.png'], viewer(who))).toBeNull();
      expect(mediaFile(['jobs', 'run-mine', 'paid', 'v1', 'image-s1.png%00.png'], viewer(who))).toBeNull();
    }
  });

  it('a frame that is a link to a file outside the data directory is refused for everyone', () => {
    symlinkSync('/etc/hosts', join(world.dir, 'jobs/run-mine/paid/v1/image-s2.png'));
    for (const who of ['usr-demo', 'usr-admin']) expect(open('run-mine', ['paid', 'v1', 'image-s2.png'], who)).toBe(false);
  });

  it('after the pictures of the job are no longer kept the owner and the admin lose the frame; a closed or deleted job loses it at once', () => {
    const job = getStore().jobs.find((item) => item.id === 'job-mine')!;
    job.status = 'done'; job.finishedAt = new Date(Date.now() - 31 * 86_400_000).toISOString();
    for (const who of ['usr-demo', 'usr-admin']) expect(open('run-mine', FRAME, who)).toBe(false);
    job.finishedAt = new Date().toISOString();
    expect(open('run-mine', FRAME, 'usr-demo')).toBe(true);
    job.deletedAt = new Date().toISOString();
    for (const who of ['usr-demo', 'usr-admin']) expect(open('run-mine', FRAME, who)).toBe(false);
    job.deletedAt = null; job.closedAt = new Date().toISOString();
    for (const who of ['usr-demo', 'usr-admin']) expect(open('run-mine', FRAME, who)).toBe(false);
  });

  it('a job whose owner has deleted their account opens nothing', () => {
    getStore().users = getStore().users.filter((u) => u.id !== 'usr-demo');
    expect(open('run-mine', FRAME, 'usr-admin')).toBe(false);
  });
});
