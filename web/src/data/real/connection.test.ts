// @vitest-environment node
// THE CONNECTION, for real: the site's data layer with `VC_ENGINE=sqlite` and the real `viraleditor` worker (fake generator,
// scripted model, real HyperFrames render) share one temp data directory. Nothing is requested from anyone.
//
//   cd web && VC_CONNECTION=1 pnpm vitest run src/data/real/connection.test.ts
//
// What it does: seeds the directory with the worker's own seed; publishes layering-01 and turns both scan sources off through the
// site; uploads one photo per product through `data.uploads`; starts a job through `data.jobs.start` (held, then released by the
// store save); starts the worker with its 2nd clip failing, so the job stops with `clips-failed`; resumes it through
// `data.jobs.resume` (approves what is missing); waits until it is done; then `/media` serves the mp4 to the job's owner and 404s
// another user. The worker is ended by this file (SIGTERM, then SIGKILL), also when a step fails.
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/core/session/session', async () => {
  const { data } = await import('@/data');
  const readUser = async () => (session.userId ? data.auth.getUser(session.userId) : null);
  return { getSessionUser: readUser, getSessionState: async () => {
    const user = await readUser();
    return user ? { kind: user.blocked ? 'blocked' : 'active', user } : { kind: 'anonymous' };
  } };
});

import { GET } from '@/app/media/[...path]/route';
import { data } from '@/data';
import { resetStore } from '@/data/mock/store';
import { closeSqliteEngines } from './sqlite-engine';
import { VIRALEDITOR } from './testing';

const MIN = 60_000;
const OWNER = 'usr-demo';
const find = (name: string) => [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`].find((path) => existsSync(path)) ?? name;
const freeGb = () => { const s = statfsSync('/System/Volumes/Data'); return (s.bavail * s.bsize) / 1e9; };

let worker: { child: ChildProcess; exited: Promise<number | null>; output: () => string } | null = null;
let dir: string | null = null;

async function endWorker(): Promise<void> {
  if (!worker) return;
  const { child, exited } = worker;
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 20_000);
  await exited;
  clearTimeout(timer);
  worker = null;
}

afterAll(async () => {
  await endWorker();
  closeSqliteEngines();
  vi.unstubAllEnvs();
  resetStore();
  if (dir && !process.env.VC_CONNECTION_KEEP) rmSync(dir, { recursive: true, force: true });
}, MIN);

async function until<T>(what: string, ms: number, check: () => Promise<T | null>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await check();
    if (got) return got;
    if (worker?.child.exitCode !== null && worker?.child.exitCode !== undefined) throw new Error(`the worker exited while waiting for ${what}: ${worker.output()}`);
    if (Date.now() > end) throw new Error(`timed out (${ms} ms) waiting for: ${what}\n${worker?.output() ?? ''}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

const media = (url: string, userId: string | null) => {
  session.userId = userId;
  const path = url.replace(/^\/media\//, '').split('/');
  return GET(new Request(`http://site${url}`), { params: Promise.resolve({ path }) });
};

describe.skipIf(!process.env.VC_CONNECTION)('the site and the worker on one database', () => {
  it('a job started on the site is produced by the worker, stops, is resumed on the site, and its mp4 is served to its owner only', async () => {
    const t0 = Date.now();
    expect(freeGb(), 'free disk (GB) on /System/Volumes/Data').toBeGreaterThan(10);
    dir = mkdtempSync(join(tmpdir(), 'vc-connection-'));

    // 1. the worker's own seed: two golden templates (ready), their samples and posters, the candidates
    const seeded = spawnSync('pnpm', ['--dir', VIRALEDITOR, '-s', 'seed', '--json'], { env: { ...process.env, VC_DATA_DIR: dir }, encoding: 'utf8', timeout: 3 * MIN });
    expect(seeded.status, seeded.stderr).toBe(0);
    expect(JSON.parse(seeded.stdout).templates.map((t: { id: string }) => t.id)).toContain('layering-01');

    // 2. the site, next to that directory
    vi.stubEnv('VC_ENGINE', 'sqlite');
    vi.stubEnv('VC_DATA_DIR', dir);
    resetStore();
    closeSqliteEngines();
    await data.admin.saveSettings({ sources: { topads: false, shorts: false } });   // the worker's schedule must not scan anything
    await data.admin.updateTemplate('layering-01', { status: 'published' });
    const template = (await data.catalog.get('layering-01', OWNER))!;
    expect(template).toMatchObject({ status: 'published', products: 4, image: '/media/templates/layering-01/poster.jpg' });

    // 3. one real photo per product, through the site's upload
    const png = join(dir, '_photo.png');
    const made = spawnSync(find('ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x336699:s=64x64', '-frames:v', '1', '-y', png], { timeout: MIN });
    expect(made.status, String(made.stderr)).toBe(0);
    const bytes = readFileSync(png);
    const names = ['Body Oil', 'Body Mist', 'Hair Mist', 'Perfume'];
    const products = await Promise.all(names.map(async (name) => ({
      name, description: `About ${name}.`, images: [await data.uploads.save(OWNER, new File([bytes], 'photo.png', { type: 'image/png' }))],
    })));

    // 4. the job: estimate, then start with the confirmed amount (the engine holds the run until the store is saved)
    const input = { templateId: 'layering-01', products, quality: 'fast' as const, variants: 1 as const, language: 'en' };
    const estimate = await data.jobs.estimate(OWNER, input);
    expect(estimate.enough).toBe(true);
    const job = await data.jobs.start(OWNER, input, 'connection-1', estimate);
    expect(JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8')).jobs.map((j: { id: string }) => j.id)).toContain(job.id);

    // 5. the worker, its 2nd clip failing; the model's answer is the golden fill
    const rest = JSON.parse(readFileSync(join(VIRALEDITOR, 'src/resolve/golden/layering-01/fill.json'), 'utf8')) as Record<string, unknown>;
    delete rest.language;                                                  // what the model answers: the fill without these two
    delete rest.products;
    const answers = join(dir, '_answers.json');
    writeFileSync(answers, JSON.stringify({ answers: [{ match: 'layering-01', answer: { fills: [rest] } }] }));
    const env: NodeJS.ProcessEnv = {
      ...process.env, VC_DATA_DIR: dir, VC_LLM_SCRIPT: answers, VC_FAKE_GENERATOR_LOG: join(dir, '_generator.log'), VC_FAKE_FAIL_CLIP: '2',
      HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', NO_COLOR: '1',
    };
    delete env.VC_PROVIDER;
    delete env.VC_ENGINE;
    const child = spawn('node', ['src/worker/main.ts'], { cwd: VIRALEDITOR, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    const keep = (chunk: Buffer) => { text = (text + chunk.toString()).slice(-6000); };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    worker = { child, exited: new Promise((resolve) => child.once('exit', (code) => resolve(code))), output: () => text };

    // 6. it stops at the clips; the site reads the reason and what a resume needs
    const stopped = await until('the job stops', 10 * MIN, async () => {
      const now = await data.jobs.get(job.id, OWNER);
      return now && now.status !== 'running' ? now : null;
    });
    expect(stopped, worker.output()).toMatchObject({ status: 'stopped', stoppedReason: 'clips-failed' });
    expect((await data.admin.health()).worker).toBe('running');
    const cost = await data.jobs.resumeCost(job.id, OWNER);

    // 7. resumed on the site (approved += missing, held, released by the store save); the worker finishes it
    const resumed = await data.jobs.resume(job.id, OWNER, cost);
    expect(resumed.status).toBe('running');
    const done = await until('the job is done', 20 * MIN, async () => {
      const now = await data.jobs.get(job.id, OWNER);
      return now && now.status !== 'running' ? now : null;
    });
    expect(done, worker.output()).toMatchObject({ status: 'done' });
    const [variant] = done.variants;
    expect(variant?.video).toMatch(/^\/media\/jobs\/[0-9a-f-]{36}\/v1\/final\.mp4$/);

    // 8. /media: the owner gets the mp4 (with ranges), another user and nobody get 404
    const own = await media(variant!.video!, OWNER);
    expect(own.status).toBe(200);
    expect(own.headers.get('accept-ranges')).toBe('bytes');
    const body = new Uint8Array(await own.arrayBuffer());
    expect(new TextDecoder().decode(body.subarray(4, 8))).toBe('ftyp');
    expect((await media(variant!.video!, 'usr-paying')).status).toBe(404);
    expect((await media(variant!.video!, null)).status).toBe(404);
    expect((await media('/media/templates/layering-01/sample.mp4', null)).status).toBe(200);
    console.log(`[connection] job ${job.id} done; mp4 ${body.byteLength} bytes; resume cost ${cost}; seconds ${Math.round((Date.now() - t0) / 1000)}`);
    await endWorker();
  }, 40 * MIN);
});
