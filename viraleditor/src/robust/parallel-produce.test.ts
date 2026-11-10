// Several videos in the making at once: the money rules with the real Magnific client on a scripted `fetch`, the claim of two
// workers on one database, and the one rule the restart needs (ops/worker-restart.sh refuses to cut videos in the making).
// Nothing here reaches a network, a launchd or a browser.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock, FakeLlm, FakeMedia, FakeRenderer } from '../adapters/fakes.ts';
import { UPLOAD_PATH } from '../adapters/routes.ts';
import type { RunInput } from '../contracts.ts';
import { openDb } from '../db/open.ts';
import { claim, enqueue, finish, getRun } from '../db/runs.ts';
import { produceHandler } from '../produce/index.ts';
import type { Assemble } from '../produce/deps.ts';
import { operationsOf } from '../produce/rows.ts';
import { answerOf, golden, inputOf, MEDIA, probesOf, put, resumeRun, seed, workspace } from '../produce/testing.ts';
import { paidFor } from '../template/estimate.ts';
import { runWorker } from '../worker/loop.ts';
import { buildParts } from '../worker/parts.ts';
import { providerUnits, reserveProvider } from './provider-budget.ts';

const input: Extract<RunInput, { kind: 'produce' }> = { kind: 'produce', templateId: 't', quality: 'fast', variants: 1, language: 'en', products: [], sample: false };

// ── ops/worker-restart.sh ──
const SCRIPT = resolve(import.meta.dirname, '../../../ops/worker-restart.sh');
const TARGET = `gui/${process.getuid?.()}/app.viralclone.worker`;
const haveSqlite = spawnSync('sqlite3', ['-version']).status === 0;

/** A data folder with a database, and a `launchctl` that only writes down what it was asked: the real one is never called. */
function restartWorld() {
  const dir = mkdtempSync(join(tmpdir(), 'vc-restart-'));
  const data = join(dir, 'data');
  mkdirSync(data);
  const db = openDb(join(data, 'db.sqlite'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const calls = join(dir, 'launchctl.calls');
  writeFileSync(join(bin, 'launchctl'), `#!/bin/bash\necho "$*" >> '${calls}'\n[ "$1" = print ] && [ -e '${join(dir, 'not-loaded')}' ] && exit 113\nexit 0\n`);
  chmodSync(join(bin, 'launchctl'), 0o755);
  /** A produce run that is in the making now (`beatAgoMs` since its last beat). */
  const making = (ref: string, beatAgoMs = 0, kind: 'produce' | 'scan' = 'produce') => {
    enqueue(db, kind === 'produce' ? input : { kind: 'scan', source: 'topads', trigger: 'manual' }, ref, null, new Date());
    claim(db, `worker-${ref}`, new Date(Date.now() - beatAgoMs), [kind]);
  };
  const envFile = join(dir, 'env');
  writeFileSync(envFile, `VC_DATA_DIR='${data}'\n`, { mode: 0o600 });
  const run = (...args: string[]) => {
    const out = spawnSync('bash', [SCRIPT, ...args], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, VC_ENV_FILE: envFile }, encoding: 'utf8' });
    return { status: out.status, text: `${out.stdout}${out.stderr}`, launchctl: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [] };
  };
  const notLoaded = () => writeFileSync(join(dir, 'not-loaded'), '');
  /** A second data folder (a trial's): with its own database, which is not the one the worker works on. */
  const otherData = () => { const d = join(dir, 'other'); mkdirSync(d); openDb(join(d, 'db.sqlite')).close(); return d; };
  /** A run the worker gave back (running, no worker, no beat): nobody's. */
  const orphan = (ref: string) => {
    enqueue(db, input, ref, null, new Date());
    claim(db, `worker-${ref}`, new Date(), ['produce']);
    db.prepare("UPDATE runs SET claimed_by = NULL, heartbeat = NULL WHERE ref = ?").run(ref);
  };
  return { data, db, making, run, notLoaded, otherData, orphan };
}

describe.skipIf(!haveSqlite)('ops/worker-restart.sh: the worker is restarted only when no video is in the making', () => {
  it('with nothing in the making it restarts the worker: one kickstart of the worker, nothing else', () => {
    const w = restartWorld();
    const out = w.run();
    expect(out.status).toBe(0);
    expect(out.launchctl).toEqual([`print ${TARGET}`, `kickstart -k ${TARGET}`]);
  });

  it('videos that only wait, and work that is no video, do not stop it', () => {
    const w = restartWorld();
    enqueue(w.db, input, 'waits-1', null, new Date());
    enqueue(w.db, input, 'waits-2', null, new Date());
    w.making('scan-1', 0, 'scan');
    const out = w.run();
    expect(out.status).toBe(0);
    expect(out.launchctl).toContain(`kickstart -k ${TARGET}`);
  });

  it('a video in the making refuses the restart, says how many and how to force it, and never calls launchd', () => {
    const w = restartWorld();
    w.making('job-a'); w.making('job-b'); w.making('job-c');
    const out = w.run();
    expect(out.status).not.toBe(0);
    expect(out.text).toContain('3 videos in the making');
    expect(out.text).toContain('--force');
    expect(out.launchctl).toEqual([]);
  });

  it('one video is said in the singular, with the run it is', () => {
    const w = restartWorld();
    w.making('job-a');
    const id = (w.db.prepare("SELECT id FROM runs WHERE ref = 'job-a'").get() as { id: string }).id;
    const out = w.run();
    expect(out.status).not.toBe(0);
    expect(out.text).toContain('1 video in the making');
    expect(out.text).toContain(id.slice(0, 8));
    expect(out.launchctl).toEqual([]);
  });

  it('--force restarts anyway, after a warning that says what it costs: a request cut off while it is sent is settled by hand', () => {
    const w = restartWorld();
    w.making('job-a'); w.making('job-b');
    const out = w.run('--force');
    expect(out.status).toBe(0);
    expect(out.text).toMatch(/WARN.*2 videos in the making/);
    expect(out.text).toContain('submission-unknown');
    expect(out.launchctl).toContain(`kickstart -k ${TARGET}`);
  });

  it('--dry-run says what it would do and calls nothing: idle it would restart, busy it refuses exactly like the real run, busy and forced it would restart', () => {
    const w = restartWorld();
    const idle = w.run('--dry-run');
    expect(idle.status).toBe(0);
    expect(idle.text).toContain('would restart');
    w.making('job-a');
    const busy = w.run('--dry-run');
    expect(busy.status).not.toBe(0);
    expect(busy.text).toContain('1 video in the making');
    const forced = w.run('--dry-run', '--force');
    expect(forced.status).toBe(0);
    expect(forced.text).toContain('would restart');
    expect(forced.launchctl).toEqual([]);
  });

  it('a video whose worker has not beaten for over a minute is nobody\'s work in the making: the restart goes on and says so', () => {
    const w = restartWorld();
    w.making('dead', 5 * 60_000);
    const out = w.run();
    expect(out.status).toBe(0);
    expect(out.text).toContain('1 video has no worker');
    expect(out.launchctl).toContain(`kickstart -k ${TARGET}`);
  });

  it('without a database it cannot tell, so it refuses, forced or not', () => {
    const w = restartWorld();
    for (const extra of [[], ['--force']]) {
      const out = w.run('--data-dir', join(w.data, 'nowhere'), '--dry-run', ...extra);
      expect(out.status).not.toBe(0);
      expect(out.text).toContain('no database');
      expect(out.launchctl).toEqual([]);
    }
  });

  it('a worker that is not loaded in launchd is an error, not a kickstart', () => {
    const w = restartWorld();
    w.notLoaded();
    const out = w.run();
    expect(out.status).not.toBe(0);
    expect(out.text).toContain('not loaded');
    expect(out.launchctl).toEqual([`print ${TARGET}`]);
  });

  it('a database nobody holds open (the worker is down, no -wal or -shm file is left) is read all the same', () => {
    const w = restartWorld();
    w.making('job-a');
    w.db.close();
    for (const suffix of ['-wal', '-shm']) expect(existsSync(join(w.data, `db.sqlite${suffix}`))).toBe(false);
    const out = w.run();
    expect(out.status).not.toBe(0);
    expect(out.text).toContain('1 video in the making');
    expect(out.launchctl).toEqual([]);
  });

  it('--data-dir is only for --dry-run: a real restart with a folder that is not the worker\'s is refused before anything is asked of launchd', () => {
    const w = restartWorld();
    const other = w.otherData();
    const real = w.run('--data-dir', other);
    expect(real.status).not.toBe(0);
    expect(real.text).toContain('--dry-run');
    expect(real.launchctl).toEqual([]);
    const dry = w.run('--data-dir', other, '--dry-run');
    expect(dry.status).toBe(0);
    expect(dry.text).toContain('would restart');
    expect(dry.launchctl).toEqual([]);
  });

  it('a run that was given back (running, no worker, no beat) is nobody\'s video: it does not stop the restart, and it is said', () => {
    const w = restartWorld();
    w.orphan('given-back');
    const out = w.run();
    expect(out.status).toBe(0);
    expect(out.text).toContain('1 video has no worker');
    expect(out.text).not.toContain('in the making');
    expect(out.launchctl).toContain(`kickstart -k ${TARGET}`);
  });

  it('videos waiting in the queue are said (a worker may take one between the check and the restart), and still do not stop it', () => {
    const w = restartWorld();
    enqueue(w.db, input, 'waits-1', null, new Date());
    enqueue(w.db, input, 'waits-2', null, new Date());
    const out = w.run();
    expect(out.status).toBe(0);
    expect(out.text).toMatch(/WARN.*2 videos wait/);
    expect(out.launchctl).toContain(`kickstart -k ${TARGET}`);
    const none = restartWorld().run();
    expect(none.text).not.toContain('wait');
  });

  it('an option it does not know is refused', () => {
    const w = restartWorld();
    const out = w.run('--now');
    expect(out.status).not.toBe(0);
    expect(out.text).toContain('unknown option');
    expect(out.launchctl).toEqual([]);
  });
});

// ── the money: the worker's own wiring (buildParts: real Magnific client, real budget, one gate for all runs) on a scripted provider ──
const NOW = '2026-10-06T10:00:00.000Z';
const { template, fill } = golden('layering-01');
const UNITS = providerUnits(paidFor(template, 1));                // 26 for layering-01: 5 images, 5 clips of 20 s together, music
const REQUESTS = 11;
const LIVE = { daily: 100, job: 60 };                              // the caps the live site has today

/** The model's answer for run `n`: every prompt starts with `[run n shot]`, so a request that reaches the provider says whose it is and which one. */
function answerFor(n: number): unknown {
  const answer = answerOf(fill, 1).fills[0] as { shots: Record<string, Record<string, string>>; music: { prompt: string } };
  for (const [id, shot] of Object.entries(answer.shots)) for (const key of Object.keys(shot)) shot[key] = `[run ${n} ${id}] ${shot[key]}`;
  answer.music.prompt = `[run ${n} music] ${answer.music.prompt}`;
  return { fills: [answer] };
}

interface Post { n: number; path: string; run: number; prompt: string; units: number }
type Answer = Response | Error;

/** Magnific as a script: every paid POST is accepted and finished at once unless `answer` says otherwise; `open` counts requests between their POST and their file (the time the worker's gate holds a place). */
function provider(answer: (post: Post) => Answer | undefined | Promise<Answer | undefined> = () => undefined) {
  const posts: Post[] = [];
  const state = { open: 0, most: 0 };
  const files = { png: MEDIA.image, mp4: MEDIA.clip, mp3: MEDIA.music };
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (url.startsWith('https://files.example/')) {
      state.open -= 1;
      const ext = url.slice(url.lastIndexOf('.') + 1) as keyof typeof files;
      return new Response(files[ext], { status: 200, headers: { 'content-type': ext === 'png' ? 'image/png' : ext === 'mp4' ? 'video/mp4' : 'audio/mpeg' } });
    }
    if (method === 'POST' && url.endsWith(UPLOAD_PATH)) return new Response(JSON.stringify({ files: [{ upload_url: 'https://up.example/u', asset_url: 'https://assets.example/photo.png', headers: {} }] }), { status: 200 });
    if (method === 'PUT') return new Response('', { status: 200 });
    if (method !== 'POST') return new Response('{}', { status: 500 });                   // no task is ever asked for: every one is finished with its acceptance
    const path = new URL(url).pathname;
    const body = JSON.parse(await new Response(init.body as ConstructorParameters<typeof Response>[0]).text()) as { prompt: string; duration?: number | string };
    const post: Post = { n: posts.length + 1, path, run: Number(/^\[run (\d+) /.exec(body.prompt)?.[1] ?? -1), prompt: body.prompt, units: path.includes('/video/') ? Number(body.duration) : 1 };
    posts.push(post);
    state.open += 1; state.most = Math.max(state.most, state.open);
    await new Promise((resolve) => setTimeout(resolve, 3));                            // in flight for a moment: the other runs go on meanwhile
    const said = await answer(post);
    if (said !== undefined) state.open -= 1;                                           // no file will follow
    if (said instanceof Error) throw said;
    if (said !== undefined) return said;
    const ext = path.includes('text-to-image') ? 'png' : path.includes('/video/') ? 'mp4' : 'mp3';
    return new Response(JSON.stringify({ data: { task_id: `t${post.n}`, status: 'COMPLETED', generated: [`https://files.example/${post.n}.${ext}`] } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { posts, state, fetcher, units: () => posts.reduce((sum, post) => sum + post.units, 0) };
}

const health = async () => ({ provider: 'magnific' as const, renderer: 'ready' as const, note: null });
const ok = async () => {};
/** The picture side is not the money: a video is its files written. */
const assemble: Assemble = async (deps, _run, _template, media) => {
  deps.onRender?.();
  put(`${media.dir}/final.mp4`, 'a video');
  return { ok: true, video: `${media.dir}/final.mp4`, image: `${media.dir}/poster.jpg` };
};
async function until(check: () => boolean, ms = 20_000): Promise<void> {
  for (const end = Date.now() + ms; Date.now() < end;) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error('timed out waiting');
}

interface Options {
  runs: number; lanes: number; caps?: { daily: number; job: number }; reserve?: boolean; answer?: (post: Post) => Answer | undefined | Promise<Answer | undefined>;
  /** Runs once the videos are queued and worker A works on them; the videos are waited for after it returns. `start` opens another worker on the same database. */
  during?: (ctx: { db: ReturnType<typeof openDb>; scripted: ReturnType<typeof provider>; queued: string[]; worker: ReturnType<typeof runWorker>; start: (id: string) => ReturnType<typeof runWorker>; handler: (run: { ref: string }) => (run: never) => Promise<unknown> }) => Promise<void>;
}
/** `runs` videos of layering-01 handed to one worker of `lanes` produce lanes, as the site hands them: an approval, a reservation (when `reserve`), the worker's claim. Returns when every run has ended. */
async function making(options: Options) {
  const caps = options.caps ?? LIVE;
  const scripted = provider(options.answer);
  vi.stubGlobal('fetch', scripted.fetcher);
  const { dir, db } = workspace();
  seed(template, fill);
  const clock = new FakeClock(NOW);
  const parts = buildParts(
    { VC_DATA_DIR: dir, CLAUDE_CODE_OAUTH_TOKEN: 'token-made-up', VC_PROVIDER: 'magnific', MAGNIFIC_API_KEY: 'k-test-made-up', VC_PROVIDER_DAILY_CAP: String(caps.daily), VC_PROVIDER_JOB_CAP: String(caps.job) },
    db, clock, { renderer: new FakeRenderer({ ready: { ready: true, note: null } }), aligner: { align: async () => [], ready: async () => ({ ready: false, note: null }) } },
  );
  const media = new FakeMedia({ probes: { by: probesOf(fill) } });
  const deps = (llm: FakeLlm) => ({ ...parts.produceDeps(), llm, media, assemble });
  const handler = (run: { ref: string }) => produceHandler(deps(new FakeLlm([answerFor(Number(run.ref.split('-')[1]))])));
  const queued: string[] = [], refused: number[] = [];
  for (let n = 0; n < options.runs; n++) {
    const ref = `job-${n}`;
    // the site, when a customer starts a video: the day's cap is looked at before the run is queued
    if (options.reserve) { try { reserveProvider(db, caps, ref, UNITS, clock.now()); } catch { refused.push(n); continue; } }
    queued.push(enqueue(db, inputOf(template, fill, 1, { ownerId: `u${n % 2}` }), ref, paidFor(template, 1), clock.now()));
  }
  const start = (id: string) => runWorker({
    db, clock, workerId: id, idleMs: 5, health, lanes: [{ kinds: ['produce'], size: options.lanes }],
    handlers: { produce: (run) => handler(run)(run), scan: ok, edit: ok, prepare: ok },
  });
  const worker = start('worker-A');
  await options.during?.({ db, scripted, queued, worker, start, handler: handler as never });
  await until(() => queued.every((id) => ['done', 'stopped'].includes(getRun(db, id)!.state)));
  await worker.stop();
  const consumed = (db.prepare('SELECT COALESCE(SUM(consumed), 0) AS n FROM provider_budget').get() as { n: number }).n;
  const spend = readFileSync(join(dir, 'provider-spend.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { runId: string; event: string });
  return { dir, db, clock, queued, refused, runs: queued.map((id) => getRun(db, id)!), scripted, consumed, spend, deps, handler };
}
const sentRows = (db: ReturnType<typeof openDb>, id: string) => operationsOf(db, id);

afterEach(() => { vi.unstubAllGlobals(); });

describe('videos in the making at once, on the worker\'s own wiring: the money', () => {
  it('four videos, three lanes, the live caps (100 a day): the units taken never pass the day\'s cap, and every unit taken is a request that was sent', { timeout: 60_000 }, async () => {
    const w = await making({ runs: 4, lanes: 3 });                    // the site would have refused the 4th (104 > 100); here nobody reserved: the guard of every POST alone
    expect(w.consumed).toBeLessThanOrEqual(LIVE.daily);
    expect(w.consumed).toBe(w.scripted.units());                      // taken = sent: nothing sent without its units, no units kept for nothing
    expect(w.runs.filter((run) => run.state === 'done')).toHaveLength(3);
    const stopped = w.runs.filter((run) => run.state === 'stopped');
    expect(stopped).toHaveLength(1);
    expect(stopped[0]!).toMatchObject({ reason: 'engine-error', detail: 'provider-cap' });
    expect(w.scripted.posts.length).toBe(w.spend.filter((line) => line.event === 'intent').length);
  });

  it('the site reserves before it queues: of five videos at a cap of 100 three are queued and finish, two are refused up front, and no video is stopped by the cap', { timeout: 60_000 }, async () => {
    const w = await making({ runs: 5, lanes: 3, reserve: true });
    expect(w.queued).toHaveLength(3);
    expect(w.refused).toEqual([3, 4]);
    expect(w.runs.map((run) => run.state)).toEqual(['done', 'done', 'done']);
    expect(w.consumed).toBe(3 * UNITS);
    expect(w.scripted.units()).toBe(3 * UNITS);
    expect(w.scripted.posts).toHaveLength(3 * REQUESTS);
  });

  it('a tight cap with many lanes: whatever the interleaving, the cap is the ceiling, and the cap is used up (the next request would not have fitted)', { timeout: 60_000 }, async () => {
    for (const daily of [30, 55, 77]) {
      const w = await making({ runs: 4, lanes: 4, caps: { daily, job: 60 } });
      expect(w.consumed).toBeLessThanOrEqual(daily);
      expect(w.consumed).toBe(w.scripted.units());
      expect(w.consumed).toBeGreaterThan(daily - 15);                  // the largest request is a clip of 5 s here: nothing smaller was left unsent
      expect(w.runs.every((run) => run.state === 'stopped' || run.state === 'done')).toBe(true);
      vi.unstubAllGlobals();
    }
  });

  it('wide caps: four videos make 44 requests, no request goes to the provider twice, each one is a row and a line of the spend log, and no more than the gate\'s 3 are open at once', { timeout: 60_000 }, async () => {
    const w = await making({ runs: 4, lanes: 4, caps: { daily: 1000, job: 60 } });
    const { posts } = w.scripted;
    expect(posts).toHaveLength(4 * REQUESTS);
    const seen = posts.map((post) => `${post.run} ${post.path} ${post.prompt}`);
    expect(new Set(seen).size).toBe(seen.length);                      // by what the provider received, not by what the worker says it sent
    expect(new Set(posts.map((post) => post.run))).toEqual(new Set([0, 1, 2, 3]));
    for (const run of w.runs) {
      expect(run).toMatchObject({ state: 'done', sent: paidFor(template, 1) });
      expect(sentRows(w.db, run.id)).toHaveLength(REQUESTS);
      expect(sentRows(w.db, run.id).every((row) => row.state === 'done')).toBe(true);
    }
    expect(w.spend.filter((line) => line.event === 'intent')).toHaveLength(4 * REQUESTS);
    expect(w.spend.filter((line) => line.event === 'accepted')).toHaveLength(4 * REQUESTS);
    expect(w.consumed).toBe(4 * UNITS);
    expect(w.scripted.state.most).toBeLessThanOrEqual(3);              // VC_GATE_PROVIDER unset: the 3 one run alone has always sent
    expect(w.scripted.state.most).toBeGreaterThan(1);
  });

  it('the answer of one request is lost: that video stops with submission-unknown and sends nothing more, the other three are not touched, and the lost request is never sent again, not even by a resume', { timeout: 60_000 }, async () => {
    const w = await making({ runs: 4, lanes: 4, caps: { daily: 1000, job: 60 }, answer: (post) => (post.n === 5 ? new Response('upstream', { status: 502 }) : undefined) });
    const unknown = w.runs.filter((run) => run.state === 'stopped');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!).toMatchObject({ reason: 'submission-unknown' });
    const others = w.runs.filter((run) => run.state === 'done');
    expect(others).toHaveLength(3);
    for (const run of others) expect(sentRows(w.db, run.id)).toHaveLength(REQUESTS);
    const { posts } = w.scripted;
    const mine = posts.filter((post) => post.run === Number(getRun(w.db, unknown[0]!.id)!.ref.split('-')[1]));
    expect(mine.length).toBeLessThan(REQUESTS);                        // it stopped: what had not started was never sent
    expect(sentRows(w.db, unknown[0]!.id).filter((row) => row.state === 'unknown')).toHaveLength(1);
    const seen = posts.map((post) => `${post.run} ${post.path} ${post.prompt}`);
    expect(new Set(seen).size).toBe(seen.length);
    expect(w.consumed).toBe(w.scripted.units());                       // the lost request stays counted: it may have cost money
    // the customer continues, or an operator retries without settling: the request that may exist is not sent again
    const before = posts.length;
    const again = resumeRun(w.db, w.clock, unknown[0]!.id);
    await w.handler(again)(again);
    expect(getRun(w.db, unknown[0]!.id)).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
    expect(w.scripted.posts).toHaveLength(before);
    expect(w.consumed).toBe(w.scripted.units());
  });

  it('the site reserves on its own connection while the lanes consume: the day\'s reservations never pass the cap, no run consumes more than it reserved, and every unit consumed is a request sent', { timeout: 60_000 }, async () => {
    const site = { taken: 0, refused: 0 };
    const w = await making({
      runs: 4, lanes: 4,
      during: async ({ db, scripted, queued }) => {
        const file = (db.prepare('PRAGMA database_list').get() as { file: string }).file;
        const other = openDb(file);                                        // the site: another connection, another process in life
        for (let n = 0; n < 16; n++) {
          other.exec('BEGIN IMMEDIATE');
          try { reserveProvider(other, LIVE, `site-${n}`, 6, new Date(NOW)); other.exec('COMMIT'); site.taken += 1; } catch { other.exec('ROLLBACK'); site.refused += 1; }
          await new Promise((resolve) => setTimeout(resolve, 3));
        }
        other.close();
        await until(() => queued.every((id) => ['done', 'stopped'].includes(getRun(db, id)!.state)) || scripted.posts.length > 0);
      },
    });
    const rows = w.db.prepare('SELECT reserved, consumed FROM provider_budget').all() as Array<{ reserved: number; consumed: number }>;
    expect(rows.reduce((sum, row) => sum + row.reserved, 0)).toBeLessThanOrEqual(LIVE.daily);
    for (const row of rows) expect(row.consumed).toBeLessThanOrEqual(row.reserved);
    expect(w.consumed).toBe(w.scripted.units());
    expect(site.taken).toBeGreaterThan(0);
    expect(w.scripted.posts.length).toBeGreaterThan(0);
  });

  it('a paid POST is refused with 429 while several videos run: its units go back, only that video stops, the others finish, and nothing is sent twice', { timeout: 60_000 }, async () => {
    const refusedAt = 14;
    const w = await making({ runs: 4, lanes: 4, caps: { daily: 1000, job: 60 }, answer: (post) => (post.n === refusedAt ? new Response('{"message":"too many requests"}', { status: 429 }) : undefined) });
    const refused = w.scripted.posts[refusedAt - 1]!;
    const stopped = w.runs.filter((run) => run.state === 'stopped');
    expect(stopped).toHaveLength(1);
    expect(getRun(w.db, stopped[0]!.id)!.ref).toBe(`job-${refused.run}`);
    expect(stopped[0]!.reason).not.toBe('submission-unknown');          // a refusal is an answer: the request does not exist
    const others = w.runs.filter((run) => run.state === 'done');
    expect(others).toHaveLength(3);
    for (const run of others) expect(sentRows(w.db, run.id)).toHaveLength(REQUESTS);
    expect(w.consumed).toBe(w.scripted.units() - refused.units);        // the refused request's units are back, nothing else is
    const seen = w.scripted.posts.map((post) => `${post.run} ${post.path} ${post.prompt}`);
    expect(new Set(seen).size).toBe(seen.length);
    expect(w.spend.filter((line) => line.event === 'rejected')).toHaveLength(1);
  });

  it('the worker hands its videos back while paid requests are on their way: at most the gate\'s 3 end as unknown, and no request is sent again by whoever takes the videos over', { timeout: 60_000 }, async () => {
    const held: Array<(answer: Response | Error) => void> = [];
    const w = await making({
      runs: 4, lanes: 4, caps: { daily: 1000, job: 60 },
      answer: (post) => (post.n <= 3 ? new Promise<Response | Error>((resolve) => { held.push(resolve); }) : undefined),   // the first 3 answers do not come: the gate is full
      during: async ({ db, scripted, worker, start }) => {
        await until(() => scripted.state.open === 3 && scripted.posts.length === 3);
        await new Promise((resolve) => setTimeout(resolve, 50));          // the other videos wait at the gate
        expect(scripted.posts).toHaveLength(3);
        worker.handBack();                                                 // SIGTERM: every running video given back at once
        const second = start('worker-B');                                  // the next worker takes them over
        await until(() => (db.prepare("SELECT COUNT(*) AS n FROM runs WHERE state = 'stopped'").get() as { n: number }).n >= 1);
        void second;
        for (const release of held) release(new Error('the old process is gone'));   // its places at the gate are free again for the videos B went on with
      },
    });
    const unknown = (w.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE state = 'unknown'").get() as { n: number }).n;
    expect(unknown).toBeLessThanOrEqual(3);
    expect(unknown).toBeGreaterThan(0);
    const seen = w.scripted.posts.map((post) => `${post.run} ${post.path} ${post.prompt}`);
    expect(new Set(seen).size).toBe(seen.length);                        // not one of the three was sent again
    expect(w.scripted.posts.slice(0, 3).map((post) => post.n)).toEqual([1, 2, 3]);
  });
});

// ── two workers on one database: nobody takes the run another holds ──
describe('two workers on one database file', () => {
  it('two worker loops on two connections, three lanes each: twelve videos, each one taken by exactly one lane, none taken over', { timeout: 30_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-two-workers-'));
    const file = join(dir, 'db.sqlite');
    const a = openDb(file), b = openDb(file);
    const clock = new FakeClock(NOW);
    const ids = Array.from({ length: 12 }, (_, n) => enqueue(a, { ...input, ownerId: `u${n % 3}` }, `job-${n}`, null, new Date(Date.parse(NOW) + n)));
    const handled: string[] = [];
    const owners = new Map<string, string>();
    const handlerFor = (db: typeof a) => async (run: { id: string; claimedBy: string | null }) => {
      handled.push(run.id); owners.set(run.id, run.claimedBy ?? '');
      await new Promise((resolve) => setTimeout(resolve, 5));
      finish(db, run.id, { kind: 'produce', variants: [] }, clock.now());
    };
    const loop = (db: typeof a, workerId: string) => runWorker({ db, clock, workerId, idleMs: 2, health, lanes: [{ kinds: ['produce'], size: 3 }], handlers: { produce: handlerFor(db), scan: ok, edit: ok, prepare: ok } });
    const workers = [loop(a, 'worker-A'), loop(b, 'worker-B')];
    await until(() => ids.every((id) => getRun(a, id)!.state === 'done'));
    await Promise.all(workers.map((worker) => worker.stop()));
    expect([...handled].sort()).toEqual([...ids].sort());              // every video once, none twice
    expect(ids.map((id) => getRun(a, id)!.takeovers)).toEqual(ids.map(() => 0));
    expect(new Set([...owners.values()].map((owner) => owner.split('#')[0]))).toEqual(new Set(['worker-A', 'worker-B']));
  });

  /** `count` queued videos, two processes that start claiming at one instant; each pauses `pauseMs` after a claim (the time a video takes to be started on). */
  async function race(count: number, pauseMs: number) {
    const dir = mkdtempSync(join(tmpdir(), 'vc-two-processes-'));
    const file = join(dir, 'db.sqlite');
    const db = openDb(file);
    const ids = Array.from({ length: count }, (_, n) => enqueue(db, { ...input, ownerId: `u${n % 2}` }, `job-${n}`, null, new Date(Date.parse(NOW) + n)));
    const code = `
      const { openDb } = await import(${JSON.stringify(new URL('../db/open.ts', import.meta.url).href)});
      const { claim } = await import(${JSON.stringify(new URL('../db/runs.ts', import.meta.url).href)});
      const db = openDb(process.env.VC_T_FILE);
      while (Date.now() < Number(process.env.VC_T_AT)) { /* both start together */ }
      const pause = () => { if (Number(process.env.VC_T_PAUSE) > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.VC_T_PAUSE)); };
      const mine = [];
      for (let run = claim(db, process.env.VC_T_WHO, new Date(), ['produce']); run !== null; run = claim(db, process.env.VC_T_WHO, new Date(), ['produce'])) { mine.push(run.id); pause(); }
      console.log(JSON.stringify(mine));`;
    const at = String(Date.now() + 1500);
    const child = (who: string) => new Promise<string[]>((resolveIds, reject) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { PATH: process.env.PATH ?? '', VC_T_FILE: file, VC_T_WHO: who, VC_T_AT: at, VC_T_PAUSE: String(pauseMs) }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      p.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      p.stderr.on('data', (d: Buffer) => { err += d.toString(); });
      p.on('exit', (status) => (status === 0 ? resolveIds(JSON.parse(out) as string[]) : reject(new Error(`${who} exited ${status}: ${err}`))));
    });
    const [first, second] = await Promise.all([child('worker-1#0'), child('worker-2#0')]);
    expect([...first, ...second].sort()).toEqual([...ids].sort());      // every video, none twice
    expect(first.filter((id) => second.includes(id))).toEqual([]);
    for (const id of ids) expect(getRun(db, id)).toMatchObject({ state: 'running', takeovers: 0 });
    return { first, second };
  }

  it('two worker PROCESSES claiming as fast as they can, 200 queued videos: every one is claimed by exactly one of them', { timeout: 60_000 }, async () => {
    await race(200, 0);
  });

  it('two worker PROCESSES that each take a moment per video, 40 queued videos: both really work, every video is claimed by exactly one of them', { timeout: 60_000 }, async () => {
    const { first, second } = await race(40, 3);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
  });
});
