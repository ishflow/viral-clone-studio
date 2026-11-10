// C6 cases 2 and 6 with the real renderer (HyperFrames, Chrome, ffmpeg) on the 2 s fixture document.
// `VE_RENDER=1 pnpm vitest run src/robust`.
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { writeFixtureComposition } from '../adapters/fixtures/composition.ts';
import { createMeasure } from '../adapters/measure.ts';
import { createRenderer } from '../adapters/renderer.ts';
import { openDb } from '../db/open.ts';
import * as runs from '../db/runs.ts';
import { runWorker } from '../worker/loop.ts';
import { FFMPEG, FFPROBE, HYPERFRAMES, canRender, processesOf, short, until } from './harness.ts';
import { job } from './job.ts';

const T = 600_000;
const health = async () => ({ provider: 'fake' as const, renderer: 'ready' as const, note: null });
const ok = async () => {};
const measure = createMeasure(FFMPEG, FFPROBE);
const reap = (path: string): string[] => { const left = processesOf(path); for (const p of left) { try { process.kill(p.pid, 'SIGKILL'); } catch { /* gone */ } } return left.map(short); };

async function world(name: string) {
  const base = mkdtempSync(join(tmpdir(), `ve-robust-${name}-`));
  const composition = join(base, 'comp');
  await writeFixtureComposition(composition, { master: { lufs: -14, peak: -1 }, ffmpeg: FFMPEG });
  const file = join(base, 'db.sqlite');
  const log = join(base, 'log');
  writeFileSync(log, '');
  const out = join(base, 'out');
  return { base, composition, file, db: openDb(file), log, out, lines: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
}

describe.skipIf(!canRender)('a worker dies mid-render and another takes over (C6 case 2, real renderer)', () => {
  it('A is SIGKILLed while rendering; B takes over after the stale heartbeat: the run is done once, by B; paid once; the video is B\'s complete render; nothing of A is left', { timeout: T }, async () => {
    const w = await world('takeover');
    const id = runs.enqueue(w.db, { kind: 'scan', source: 'topads', trigger: 'manual' }, 'r1', null, new Date());
    const tmp = join(w.base, 'tmp');
    const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: tmp, HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1' };
    const { mkdirSync } = await import('node:fs');
    mkdirSync(tmp, { recursive: true });
    const a = spawn(process.execPath, [join(import.meta.dirname, 'worker-child.ts'), w.file, w.composition, w.out, w.log], { stdio: ['ignore', 'pipe', 'ignore'], env });
    let seen = '';
    a.stdout!.setEncoding('utf8').on('data', (d: string) => { seen += d; });
    const aExit = new Promise((r) => a.on('exit', r));
    try {
      expect(await until(() => /progress \d+/.test(seen), 120_000, 50)).toBe(true);
    } finally {
      a.kill('SIGKILL');                                                                // A polls forever by itself: it never outlives this test
      await aExit;
    }

    const clock = { now: () => new Date(Date.now() + runs.STALE_MS + 1000) };          // A's heartbeat is stale to B
    const renderer = createRenderer({ bin: HYPERFRAMES, ffmpeg: FFMPEG, ffprobe: FFPROBE, measure });
    const b = runWorker({ db: w.db, clock, workerId: 'worker-B', idleMs: 200, health, handlers: { scan: job({ db: w.db, clock, renderer, composition: w.composition, out: w.out, log: w.log, who: 'B' }), produce: ok, prepare: ok, edit: ok } });
    let done = false;
    try {
      done = await until(() => runs.getRun(w.db, id)?.state !== 'running', 300_000, 200);
    } finally {
      await b.stop();
    }
    expect(done).toBe(true);
    expect(runs.getRun(w.db, id)).toMatchObject({ state: 'done', claimedBy: 'worker-B' });
    expect(w.lines()).toEqual([`paid A ${id}`, `render A ${id}`, `render B ${id}`]);
    expect(readdirSync(w.out)).toEqual([`${id}.mp4`]);                                   // A's temp file and the CLI's work folders are gone
    expect(await measure.streams(join(w.out, `${id}.mp4`))).toMatchObject({ frames: 60, width: 720, height: 1280, audio: true });
    const clean = await until(() => processesOf(w.base).length === 0, 10_000);
    expect(clean, reap(w.base).join(', ')).toBe(true);
  });
});

describe.skipIf(!canRender)('five jobs in a row through one worker (C6 case 6)', () => {
  it('time per job stays flat; no process, no temp entry and no heap accumulates between jobs', { timeout: T }, async () => {
    const w = await world('five');
    const root = tmpdir();                                                              // this run's own temp root: Chrome's profile lands here
    const clock = { now: () => new Date() };
    const renderer = createRenderer({ bin: HYPERFRAMES, ffmpeg: FFMPEG, ffprobe: FFPROBE, measure });
    const render = job({ db: w.db, clock, renderer, composition: w.composition, out: w.out, log: w.log, who: 'W' });
    const samples: { seconds: number; heap: number; rss: number; processes: string[]; temp: number }[] = [];
    const ids = Array.from({ length: 5 }, (_, i) => runs.enqueue(w.db, { kind: 'scan', source: 'topads', trigger: 'manual' }, `r${i}`, null, new Date(Date.now() + i)));
    const worker = runWorker({
      db: w.db, clock, workerId: 'worker-W', idleMs: 200, health,
      handlers: {
        scan: async (run) => {
          const from = performance.now();
          await render(run);
          const seconds = (performance.now() - from) / 1000;
          await until(() => processesOf(root).length === 0, 5000);
          samples.push({ seconds, heap: process.memoryUsage().heapUsed, rss: process.memoryUsage().rss, processes: processesOf(root).map(short), temp: readdirSync(root).length });
        },
        produce: ok, prepare: ok, edit: ok,
      },
    });
    try {
      await until(() => ids.every((id) => runs.getRun(w.db, id)?.state === 'done') || samples.length === 5, 500_000, 500);
    } finally {
      await worker.stop();
    }
    const line = `C6 case 6: ${samples.map((s) => `${s.seconds.toFixed(1)}s heap ${(s.heap / 2 ** 20).toFixed(0)}MB rss ${(s.rss / 2 ** 20).toFixed(0)}MB temp ${s.temp}`).join(' | ')}`;
    if (process.env.C6_SAMPLES) writeFileSync(process.env.C6_SAMPLES, `${line}\n`);       // the numbers for the report
    expect(ids.map((id) => runs.getRun(w.db, id)?.state)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(samples.flatMap((s) => s.processes)).toEqual([]);
    expect(samples[4]!.temp).toBeLessThanOrEqual(samples[0]!.temp);
    // no growth: the last job is not slower than the slowest of jobs 2-4 (the first warms the caches). Not "all equal": the machine is shared,
    // and a load that ends mid-test made jobs 2-3 take 11-14 s and jobs 4-5 5 s in one run (C6 case 8: no wall-clock equality)
    expect(samples[4]!.seconds).toBeLessThanOrEqual(1.5 * Math.max(...samples.slice(1, 4).map((s) => s.seconds)) + 5);
    expect(samples[4]!.heap - samples[0]!.heap).toBeLessThan(50 * 2 ** 20);
    expect(readdirSync(w.out).sort()).toEqual(ids.map((id) => `${id}.mp4`).sort());
  });
});
