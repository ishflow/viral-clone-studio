// @vitest-environment node
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStore, resetStore } from '../mock/store';
import { addDemoCustomers } from '../mock/test-helpers';
import { mediaFile } from './media';
import { jobRecord, makeDataDir } from './testing';

// What a job's run folder (`jobs/<runId>/paid/v<k>/…`) serves: only a file the job's own `operations` row names as its finished output,
// whatever the file is called. A picture or a clip is the job's owner's and the admins', the music too, while the job's pictures are
// kept; the spoken voice, a file nobody recorded and an unfinished request are nobody's.

let world: ReturnType<typeof makeDataDir>;
const viewer = (id: string | null) => (id ? getStore().users.find((u) => u.id === id) ?? null : null);
const open = (run: string, name: string[], who: string | null) => mediaFile(['jobs', run, ...name], viewer(who)) !== null;
const path = (name: string, v = 1) => ['paid', `v${v}`, name];

/** The recorded outputs of every run: [key, kind, state, file name]. Files have their bytes whatever their record says. */
const RECORDED: [string, string, string, string][] = [
  ['v1:image:s1', 'image', 'done', 'image-s1.png'],
  ['v1:image:hook', 'image', 'done', 'image-hook.jpg'],
  ['v1:image:woman', 'image', 'done', 'image-woman.png'],
  ['v1:clip:s1', 'clip', 'done', 'clip-s1.mp4'],
  ['v1:clip:hook', 'clip', 'done', 'clip-hook.mp4'],
  ['v1:music', 'music', 'done', 'music.mp3'],
  ['v2:music', 'music', 'done', 'music.m4a'],
  ['v1:voice', 'voice', 'done', 'voice.mp3'],
  ['v1:clip:s2', 'clip', 'pending', 'clip-s2.mp4'],
  ['v1:clip:s3', 'clip', 'failed', 'clip-s3.mp4'],
];
const UNRECORDED = ['image-s9.png', 'clip-s9.mp4', 'music.wav', 'normalized-s1.mp4', 'response.json'];

function putRun(id: string, ref: string, kind = 'produce'): void {
  world.db.prepare("INSERT INTO runs (id, kind, ref, state, input, created_at, updated_at) VALUES (?, ?, ?, 'running', '{}', 'a', 'a')").run(id, kind, ref);
  for (const v of [1, 2]) mkdirSync(join(world.dir, 'jobs', id, 'paid', `v${v}`), { recursive: true });
  for (const [key, opKind, state, name] of RECORDED) {
    const v = Number(key[1]);
    world.db.prepare("INSERT INTO operations (run_id, key, kind, state, output, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'a', 'a')").run(id, key, opKind, state, `jobs/${id}/paid/v${v}/${name}`);
    writeFileSync(join(world.dir, 'jobs', id, 'paid', `v${v}`, name), 'bytes');
  }
  for (const name of UNRECORDED) writeFileSync(join(world.dir, 'jobs', id, 'paid', 'v1', name), 'bytes');
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

const WHO: [string, string | null, boolean][] = [['anonymous', null, false], ['another customer', 'usr-new', false], ['the owner', 'usr-demo', true], ['an admin', 'usr-admin', true]];
const SERVED: [string, string[]][] = [
  ['the first frame of a shot', path('image-s1.png')],
  ['a frame of a shot whose id is not s<n>', path('image-hook.jpg')],
  ['a picture every shot shares', path('image-woman.png')],
  ['the clip of a shot', path('clip-s1.mp4')],
  ['the clip of a shot whose id is not s<n>', path('clip-hook.mp4')],
  ['the music', path('music.mp3')],
  ['the music of the second variant, kept as M4A', path('music.m4a', 2)],
];
const CLOSED: [string, string[]][] = [
  ['the spoken voice', path('voice.mp3')],
  ['a file nobody recorded (a picture)', path('image-s9.png')],
  ['a file nobody recorded (a clip)', path('clip-s9.mp4')],
  ['a file nobody recorded (music)', path('music.wav')],
  ['an intermediate copy', path('normalized-s1.mp4')],
  ['a provider\'s answer', path('response.json')],
  ['a clip whose request has not finished', path('clip-s2.mp4')],
  ['a clip whose request failed', path('clip-s3.mp4')],
];

describe('/media: a recorded output of a job\'s run', () => {
  for (const [what, name] of SERVED) for (const [who, id, may] of WHO) {
    it(`${who} ${may ? 'opens' : 'does not open'} ${what}`, () => {
      expect(open('run-mine', name, id)).toBe(may);
    });
  }

  for (const [what, name] of CLOSED) for (const [who, id] of WHO) {
    it(`${who} does not open ${what}`, () => {
      expect(open('run-mine', name, id)).toBe(false);
    });
  }

  it('a file is served for what the record says it is, the file name has no say: a clip recorded under a name no rule knows is served', () => {
    world.db.prepare("INSERT INTO operations (run_id, key, kind, state, output, created_at, updated_at) VALUES ('run-mine', 'v1:clip:odd', 'clip', 'done', 'jobs/run-mine/paid/v1/anything.mp4', 'a', 'a')").run();
    writeFileSync(join(world.dir, 'jobs/run-mine/paid/v1/anything.mp4'), 'bytes');
    expect(open('run-mine', path('anything.mp4'), 'usr-demo')).toBe(true);
    expect(open('run-mine', path('anything.mp4'), 'usr-new')).toBe(false);
  });

  it('a record of another run does not open this run\'s file of the same name, and a record that names another run\'s file opens nothing', () => {
    world.db.prepare("DELETE FROM operations WHERE run_id = 'run-mine' AND key = 'v1:clip:s1'").run();
    expect(open('run-mine', path('clip-s1.mp4'), 'usr-demo')).toBe(false);
    world.db.prepare("INSERT INTO operations (run_id, key, kind, state, output, created_at, updated_at) VALUES ('run-mine', 'v1:clip:s1', 'clip', 'done', 'jobs/run-other/paid/v1/clip-s1.mp4', 'a', 'a')").run();
    expect(open('run-mine', path('clip-s1.mp4'), 'usr-demo')).toBe(false);
    expect(open('run-other', path('clip-s1.mp4'), 'usr-demo')).toBe(false);
    expect(open('run-other', path('clip-s1.mp4'), 'usr-new')).toBe(true);
  });

  it('a file of another customer\'s job is closed to the owner of this one, and the other way round', () => {
    for (const [, name] of SERVED) {
      expect(open('run-other', name, 'usr-demo')).toBe(false);
      expect(open('run-other', name, 'usr-new')).toBe(true);
    }
  });

  it('a regeneration of the job is the job\'s: its owner and the admin open its files, another customer does not', () => {
    for (const [, name] of SERVED) expect([null, 'usr-new', 'usr-demo', 'usr-admin'].map((id) => open('run-regen', name, id))).toEqual([false, false, true, true]);
  });

  it('a run that is not a produce run opens nothing', () => {
    for (const who of ['usr-demo', 'usr-admin']) for (const [, name] of SERVED) expect(open('run-prepare', name, who)).toBe(false);
  });

  it('a recorded output outside the run\'s paid/v<k>/ folder is never served: another folder, the run\'s own root, a variant 0 or 10, a nested folder', () => {
    const odd = ['paid/image-s1.png', 'v1/image-s1.png', 'paid/v0/clip-x.mp4', 'paid/v10/clip-x.mp4', 'paid/v1/deeper/clip-x.mp4', 'fill.json'];
    for (const [index, name] of odd.entries()) {
      mkdirSync(join(world.dir, 'jobs/run-mine', name, '..'), { recursive: true });
      writeFileSync(join(world.dir, 'jobs/run-mine', name), 'bytes');
      world.db.prepare("INSERT INTO operations (run_id, key, kind, state, output, created_at, updated_at) VALUES ('run-mine', ?, 'image', 'done', ?, 'a', 'a')").run(`v1:image:odd${index}`, `jobs/run-mine/${name}`);
    }
    for (const who of ['usr-demo', 'usr-admin']) for (const name of odd) expect(open('run-mine', name.split('/'), who)).toBe(false);
  });

  it('a path that leaves the file (`..`, another run\'s id, a separator inside a segment, an encoded dot, a NUL) is refused for the owner and the admin too', () => {
    for (const who of ['usr-demo', 'usr-admin']) {
      expect(mediaFile(['jobs', 'run-mine', 'paid', 'v1', '..', 'v1', 'clip-s1.mp4'], viewer(who))).toBeNull();
      expect(mediaFile(['jobs', 'run-mine', '..', 'run-other', 'paid', 'v1', 'clip-s1.mp4'], viewer(who))).toBeNull();
      expect(mediaFile(['jobs', 'run-mine', 'paid/v1/clip-s1.mp4'], viewer(who))).toBeNull();
      expect(mediaFile(['jobs', 'run-mine', 'paid', 'v1\\clip-s1.mp4'], viewer(who))).toBeNull();
      expect(mediaFile(['jobs', 'run-mine', 'paid', '%2e%2e', 'v1', 'clip-s1.mp4'], viewer(who))).toBeNull();
      expect(mediaFile(['jobs', 'run-mine', 'paid', 'v1', 'clip-s1.mp4%00.mp4'], viewer(who))).toBeNull();
    }
  });

  it('a file that is a link to a file outside the data directory is refused for everyone, though it is recorded', () => {
    symlinkSync('/etc/hosts', join(world.dir, 'jobs/run-mine/paid/v1/clip-link.mp4'));
    world.db.prepare("INSERT INTO operations (run_id, key, kind, state, output, created_at, updated_at) VALUES ('run-mine', 'v1:clip:link', 'clip', 'done', 'jobs/run-mine/paid/v1/clip-link.mp4', 'a', 'a')").run();
    for (const who of ['usr-demo', 'usr-admin']) expect(open('run-mine', path('clip-link.mp4'), who)).toBe(false);
  });

  it('a recorded file that is a link to another file of the data directory (another job\'s clip, the database) is refused: its real place must be this run\'s own folder', () => {
    symlinkSync(join(world.dir, 'jobs/run-other/paid/v1/clip-s1.mp4'), join(world.dir, 'jobs/run-mine/paid/v1/clip-other.mp4'));
    symlinkSync(join(world.dir, 'db.sqlite'), join(world.dir, 'jobs/run-mine/paid/v1/clip-db.mp4'));
    for (const name of ['clip-other', 'clip-db']) {
      world.db.prepare("INSERT INTO operations (run_id, key, kind, state, output, created_at, updated_at) VALUES ('run-mine', ?, 'clip', 'done', ?, 'a', 'a')").run(`v1:clip:${name.slice(5)}`, `jobs/run-mine/paid/v1/${name}.mp4`);
    }
    for (const who of ['usr-demo', 'usr-admin']) for (const name of ['clip-other.mp4', 'clip-db.mp4']) expect(open('run-mine', path(name), who)).toBe(false);
    expect(open('run-mine', path('clip-s1.mp4'), 'usr-demo')).toBe(true);
  });

  it('after the pictures of the job are no longer kept the owner and the admin lose every file; a closed or deleted job loses them at once', () => {
    const job = getStore().jobs.find((item) => item.id === 'job-mine')!;
    const all = (who: string) => SERVED.map(([, name]) => open('run-mine', name, who));
    job.status = 'done'; job.finishedAt = new Date(Date.now() - 31 * 86_400_000).toISOString();
    for (const who of ['usr-demo', 'usr-admin']) expect(all(who).some(Boolean)).toBe(false);
    job.finishedAt = new Date().toISOString();
    expect(all('usr-demo').every(Boolean)).toBe(true);
    job.deletedAt = new Date().toISOString();
    for (const who of ['usr-demo', 'usr-admin']) expect(all(who).some(Boolean)).toBe(false);
    job.deletedAt = null; job.closedAt = new Date().toISOString();
    for (const who of ['usr-demo', 'usr-admin']) expect(all(who).some(Boolean)).toBe(false);
  });

  it('a job whose owner has deleted their account opens nothing', () => {
    getStore().users = getStore().users.filter((u) => u.id !== 'usr-demo');
    for (const [, name] of SERVED) expect(open('run-mine', name, 'usr-admin')).toBe(false);
  });

  it('a clip and the music are told apart by their types: video and audio', () => {
    expect(mediaFile(['jobs', 'run-mine', ...path('clip-s1.mp4')], viewer('usr-demo'))?.type).toBe('video/mp4');
    expect(mediaFile(['jobs', 'run-mine', ...path('music.mp3')], viewer('usr-demo'))?.type).toBe('audio/mpeg');
    expect(mediaFile(['jobs', 'run-mine', ...path('music.m4a', 2)], viewer('usr-demo'))?.type).toBe('audio/mp4');
  });
});
