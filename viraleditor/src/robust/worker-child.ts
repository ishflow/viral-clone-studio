// A worker in a process of its own (C6 case 2): `node worker-child.ts <db> <composition> <out> <log>`. It runs `job` with the real renderer
// and prints `claimed <run>` when its handler starts, so the test knows when to end it.
import { openDb } from '../db/open.ts';
import { createMeasure } from '../adapters/measure.ts';
import { createRenderer } from '../adapters/renderer.ts';
import { runWorker } from '../worker/loop.ts';
import { FFMPEG, FFPROBE, HYPERFRAMES } from './harness.ts';
import { job } from './job.ts';

const [file, composition, out, log] = process.argv.slice(2) as [string, string, string, string];
const db = openDb(file);
const clock = { now: () => new Date() };
const renderer = createRenderer({ bin: HYPERFRAMES, ffmpeg: FFMPEG, ffprobe: FFPROBE, measure: createMeasure(FFMPEG, FFPROBE) });
const handler = job({ db, clock, renderer: { render: (dir, to, onProgress) => renderer.render(dir, to, (p) => { console.log(`progress ${p.frame}`); onProgress(p); }) }, composition, out, log, who: 'A' });
const ok = async () => {};
runWorker({
  db, clock, workerId: 'worker-A', idleMs: 200, health: async () => ({ provider: 'fake', renderer: 'ready', note: null }),
  handlers: { scan: async (run) => { console.log(`claimed ${run.id}`); await handler(run); }, produce: ok, prepare: ok, edit: ok },
});
