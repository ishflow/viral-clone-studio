// @vitest-environment node
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStore, resetStore } from '@/data/mock/store';
import { addDemoCustomers } from '@/data/mock/test-helpers';
import type { User } from '@/data/ports';
import { closeSqliteEngines } from '@/data/real/sqlite-engine';
import { jobRecord, makeDataDir, putTemplate } from '@/data/real/testing';

const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/session/session', () => ({
  getSessionUser: async () => session.user,
  getSessionState: async () => (session.user ? { kind: session.user.blocked ? 'blocked' : 'active', user: session.user } : { kind: 'anonymous' }),
}));

import { GET } from './route';

let dir: string;
let db: DatabaseSync;
const SAMPLE = 'a sample video, 32 bytes long...';

function put(relative: string, content = SAMPLE): void {
  mkdirSync(dirname(join(dir, relative)), { recursive: true });
  writeFileSync(join(dir, relative), content);
}
const as = (id: string | null) => {
  session.user = id ? getStore().users.find((user) => user.id === id)! : null;
};
const get = (path: string[], headers: Record<string, string> = {}) =>
  GET(new Request(`http://site/media/${path.join('/')}`, { headers }), { params: Promise.resolve({ path }) });

beforeEach(() => {
  ({ dir, db } = makeDataDir());
  vi.stubEnv('VC_ENGINE', 'sqlite');
  vi.stubEnv('VC_DATA_DIR', dir);
  resetStore();
  addDemoCustomers();   // the real engine's store seeds the administrator only
  session.user = null;
  putTemplate(db, { id: 'pub', state: 'published' });
  putTemplate(db, { id: 'wait', state: 'ready' });
  putTemplate(db, { id: 'mine', state: 'ready', owner: 'usr-demo' });
  for (const id of ['pub', 'wait', 'mine']) put(`templates/${id}/sample.mp4`);
  put('templates/pub/template.json', '{}');
  put('sources/mine/source.mp4');
  put('sources/cand-1/source.mp4');
  getStore().jobs.push(jobRecord({ id: 'job-1', userId: 'usr-demo' }));
  db.prepare(`INSERT INTO runs (id, kind, ref, state, input, steps, created_at, updated_at) VALUES ('run-1', 'produce', 'job-1', 'done', '{}', '[]', 'a', 'a')`).run();
  put('jobs/run-1/v1/final.mp4');
  put('jobs/run-1/fill.json', '{}');
  put('uploads/11111111-2222-4333-8444-555555555555/1.png', 'png');
  put('uploads/11111111-2222-4333-8444-555555555555/uploader', 'usr-demo');
  put('site.json.extra.mp4');
});
afterEach(() => {
  closeSqliteEngines();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  resetStore();
});

describe('/media', () => {
  it('a published sample without a session: 200 with Accept-Ranges, the whole file', async () => {
    const response = await get(['templates', 'pub', 'sample.mp4']);
    expect(response.status).toBe(200);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(await response.text()).toBe(SAMPLE);
  });

  it('a range of a video: 206 with Content-Range; a range past the end: 416', async () => {
    const part = await get(['templates', 'pub', 'sample.mp4'], { range: 'bytes=2-7' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 2-7/${SAMPLE.length}`);
    expect(await part.text()).toBe(SAMPLE.slice(2, 8));
    const tail = await get(['templates', 'pub', 'sample.mp4'], { range: 'bytes=-5' });
    expect(await tail.text()).toBe(SAMPLE.slice(-5));
    expect((await get(['templates', 'pub', 'sample.mp4'], { range: 'bytes=999-' })).status).toBe(416);
  });

  it('a job\'s video: its owner and the admins; another user and nobody get 404', async () => {
    as('usr-demo');
    expect((await get(['jobs', 'run-1', 'v1', 'final.mp4'])).status).toBe(200);
    as('usr-admin');
    expect((await get(['jobs', 'run-1', 'v1', 'final.mp4'])).status).toBe(200);
    as('usr-paying');
    expect((await get(['jobs', 'run-1', 'v1', 'final.mp4'])).status).toBe(404);
    as(null);
    expect((await get(['jobs', 'run-1', 'v1', 'final.mp4'])).status).toBe(404);
    as('usr-demo');
    expect((await get(['jobs', 'run-1', 'fill.json'])).status).toBe(404);    // only the finished files
  });

  it('the first frame of a shot of a running job is a private file: a browser or a shared cache keeps no copy for another viewer', async () => {
    put('jobs/run-1/paid/v1/image-s1.png', 'png');
    db.prepare(`INSERT INTO operations (run_id, key, kind, state, output, created_at, updated_at) VALUES ('run-1', 'v1:image:s1', 'image', 'done', 'jobs/run-1/paid/v1/image-s1.png', 'a', 'a')`).run();
    getStore().jobs.find((job) => job.id === 'job-1')!.status = 'running';
    as('usr-demo');
    const frame = await get(['jobs', 'run-1', 'paid', 'v1', 'image-s1.png']);
    expect(frame.status).toBe(200);
    expect(frame.headers.get('cache-control')).toBe('private, no-cache');
    as('usr-paying');
    const refused = await get(['jobs', 'run-1', 'paid', 'v1', 'image-s1.png']);
    expect([refused.status, refused.headers.get('cache-control')]).toEqual([404, 'no-store']);
  });

  it('the clip of a shot and the music of a running job are private files of its owner and the admins, with ranges for the player; the voice and another customer get a 404', async () => {
    for (const [key, kind, name] of [['v1:clip:s1', 'clip', 'clip-s1.mp4'], ['v1:music', 'music', 'music.mp3'], ['v1:voice', 'voice', 'voice.mp3']] as const) {
      put(`jobs/run-1/paid/v1/${name}`);
      db.prepare(`INSERT INTO operations (run_id, key, kind, state, output, created_at, updated_at) VALUES ('run-1', ?, ?, 'done', ?, 'a', 'a')`).run(key, kind, `jobs/run-1/paid/v1/${name}`);
    }
    getStore().jobs.find((job) => job.id === 'job-1')!.status = 'running';
    as('usr-demo');
    const clip = await get(['jobs', 'run-1', 'paid', 'v1', 'clip-s1.mp4'], { range: 'bytes=2-7' });
    expect([clip.status, clip.headers.get('content-range'), clip.headers.get('content-type'), clip.headers.get('cache-control')]).toEqual([206, `bytes 2-7/${SAMPLE.length}`, 'video/mp4', 'private, no-cache']);
    const music = await get(['jobs', 'run-1', 'paid', 'v1', 'music.mp3']);
    expect([music.status, music.headers.get('content-type'), music.headers.get('cache-control')]).toEqual([200, 'audio/mpeg', 'private, no-cache']);
    expect((await get(['jobs', 'run-1', 'paid', 'v1', 'voice.mp3'])).status).toBe(404);
    as('usr-admin');
    expect((await get(['jobs', 'run-1', 'paid', 'v1', 'clip-s1.mp4'])).status).toBe(200);
    as('usr-paying');
    for (const name of ['clip-s1.mp4', 'music.mp3']) {
      const refused = await get(['jobs', 'run-1', 'paid', 'v1', name]);
      expect([refused.status, refused.headers.get('cache-control')]).toEqual([404, 'no-store']);
    }
  });

  it('a regenerated variant\'s video (ref `<job>/<variant>/<run>`): the job\'s owner and the admins; another user 404', async () => {
    db.prepare(`INSERT INTO runs (id, kind, ref, state, input, steps, created_at, updated_at) VALUES ('run-2', 'produce', 'job-1/job-1-v2/run-2', 'done', '{}', '[]', 'a', 'a')`).run();
    put('jobs/run-2/v1/final.mp4');
    as('usr-demo');
    expect((await get(['jobs', 'run-2', 'v1', 'final.mp4'])).status).toBe(200);
    as('usr-admin');
    expect((await get(['jobs', 'run-2', 'v1', 'final.mp4'])).status).toBe(200);
    as('usr-paying');
    expect((await get(['jobs', 'run-2', 'v1', 'final.mp4'])).status).toBe(404);
  });

  it('templates: a waiting one for the admins only; a private one for its owner; never the template file', async () => {
    expect((await get(['templates', 'wait', 'sample.mp4'])).status).toBe(404);
    expect((await get(['templates', 'mine', 'sample.mp4'])).status).toBe(404);
    as('usr-paying');
    expect((await get(['templates', 'mine', 'sample.mp4'])).status).toBe(404);
    as('usr-demo');
    expect((await get(['templates', 'mine', 'sample.mp4'])).status).toBe(200);
    as('usr-admin');
    expect((await get(['templates', 'wait', 'sample.mp4'])).status).toBe(200);
    expect((await get(['templates', 'pub', 'template.json'])).status).toBe(404);
  });

  it('uploads for the uploader and the admins; sources for the admins and the owner of the template made from it', async () => {
    const photo = ['uploads', '11111111-2222-4333-8444-555555555555', '1.png'];
    as('usr-demo');
    expect((await get(photo)).status).toBe(200);
    expect((await get(['uploads', '11111111-2222-4333-8444-555555555555', 'uploader'])).status).toBe(404);
    expect((await get(['sources', 'mine', 'source.mp4'])).status).toBe(200);
    expect((await get(['sources', 'cand-1', 'source.mp4'])).status).toBe(404);
    as('usr-paying');
    expect((await get(photo)).status).toBe(404);
    expect((await get(['sources', 'mine', 'source.mp4'])).status).toBe(404);
    as('usr-admin');
    expect((await get(photo)).status).toBe(200);
    expect((await get(['sources', 'cand-1', 'source.mp4'])).status).toBe(200);
  });

  it('a path that climbs out (`..`, `..%2f`, encoded or decoded) is a 404, also for an admin', async () => {
    as('usr-admin');
    for (const path of [
      ['templates', 'pub', '..%2f..%2fsite.json.extra.mp4'],
      ['templates', 'pub', '../../site.json.extra.mp4'],
      ['templates', '..', '..', 'site.json.extra.mp4'],
      ['..', 'site.json.extra.mp4'],
      ['jobs', 'run-1', 'v1', '..%2f..%2f..%2f..%2fsite.json.extra.mp4'],
      ['site.json.extra.mp4'],
      ['templates', 'pub%2f..', 'sample.mp4'],
    ]) {
      expect((await get(path)).status, path.join('/')).toBe(404);
    }
  });

  it('a file that is a symlink out of the data directory is a 404, also for an admin and on a public template', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'vc-outside-'));
    try {
      writeFileSync(join(outside, 'secret.mp4'), 'secret');
      rmSync(join(dir, 'templates/pub/sample.mp4'));
      symlinkSync(join(outside, 'secret.mp4'), join(dir, 'templates/pub/sample.mp4'));
      expect((await get(['templates', 'pub', 'sample.mp4'])).status).toBe(404);
      as('usr-admin');
      expect((await get(['templates', 'pub', 'sample.mp4'])).status).toBe(404);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('an absolute-path segment and a NUL in a segment are 404', async () => {
    as('usr-admin');
    for (const path of [
      ['templates', 'pub', '/etc/passwd'], ['/etc', 'pub', 'sample.mp4'], ['templates', '', 'sample.mp4'],
      ['templates', 'pub', 'sample.mp4\0'], ['templates', 'pub\0', 'sample.mp4'], [dir, 'templates', 'pub', 'sample.mp4'],
    ]) {
      expect((await get(path)).status, JSON.stringify(path)).toBe(404);
    }
  });

  it('a database that cannot be read is a 404, not a 500', async () => {
    chmodSync(join(dir, 'db.sqlite'), 0o000);                            // the read-only connection cannot open it
    try {
      expect((await get(['templates', 'pub', 'sample.mp4'])).status).toBe(404);
    } finally {
      chmodSync(join(dir, 'db.sqlite'), 0o644);
    }
  });

  it('a Range header that cannot be read (multi-range, words) is ignored: 200 and the whole file (RFC 9110)', async () => {
    for (const range of ['bytes=0-1,3-4', 'bytes=abc', 'items=0-5', 'bytes=-']) {
      const response = await get(['templates', 'pub', 'sample.mp4'], { range });
      expect(response.status, range).toBe(200);
      expect(await response.text()).toBe(SAMPLE);
    }
    expect((await get(['templates', 'pub', 'sample.mp4'], { range: 'bytes=5-3' })).status).toBe(416);
    expect((await get(['templates', 'pub', 'sample.mp4'], { range: 'bytes=-0' })).status).toBe(416);
  });

  it('in fake mode nothing is served', async () => {
    vi.stubEnv('VC_ENGINE', '');
    expect((await get(['templates', 'pub', 'sample.mp4'])).status).toBe(404);
  });
});

it('the source video and its first picture: the template\'s owner and the admins, never a visitor, also on a published template', async () => {
  for (const id of ['pub', 'wait', 'mine']) for (const name of ['reference.jpg', 'reference.mp4']) put(`templates/${id}/${name}`);
  for (const name of ['reference.jpg', 'reference.mp4']) {
    as(null);
    expect((await get(['templates', 'pub', name])).status).toBe(404);   // the source video of a catalog template: its owner's (none) and the admins' only
    expect((await get(['templates', 'mine', name])).status).toBe(404);
    expect((await get(['templates', 'wait', name])).status).toBe(404);
    as('usr-demo');
    expect((await get(['templates', 'mine', name])).status).toBe(200);
    expect((await get(['templates', 'wait', name])).status).toBe(404);
    as(getStore().users.find(u => u.role === 'admin')!.id);
    expect((await get(['templates', 'pub', name])).status).toBe(200);
    expect((await get(['templates', 'wait', name])).status).toBe(200);
    expect((await get(['retired', 'templates', 'mine', name])).status).toBe(404);
  }
});
