// Helpers of the end-to-end tests: a temp data dir seeded with layering-01, a worker as a child process, polling.
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createMedia } from '../adapters/media.ts';
import { openDb } from '../db/open.ts';
import { enqueue, getRun } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import { readSettings, writeSettings } from '../db/settings.ts';
import { answerOf, golden, inputOf } from '../produce/testing.ts';
import type { ProduceInput } from '../produce/testing.ts';
import { seed } from '../seed/seed.ts';
import { paidFor } from '../template/estimate.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';

export const ROOT = resolve(import.meta.dirname, '../..');
const find = (name: string) => [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`].find((path) => existsSync(path)) ?? name;
export const FFMPEG = find('ffmpeg');
export const FFPROBE = find('ffprobe');

export interface World {
  dir: string; db: DatabaseSync; template: TemplateJson; fill: FillJson;
  generatorLog: string; answers: string;
}

export interface LogLine { kind: 'image' | 'clip' | 'music' | 'voice'; words: string; seconds: number | null; ticket: string }

const worlds: World[] = [];

/** A data dir seeded by the seed's own function: layering-01 is a `ready` template, both scan sources are off, one product picture is on disk. */
export async function makeWorld(): Promise<World> {
  const dir = mkdtempSync(join(tmpdir(), 've-e2e-'));
  const db = openDb(join(dir, 'db.sqlite'));
  const here = join(ROOT, 'src', 'resolve', 'golden');
  const empty = (name: string) => { const p = join(dir, '_seed-' + name); mkdirSync(p, { recursive: true }); return p; };
  await seed(
    { db, media: createMedia(FFMPEG, FFPROBE), clock: { now: () => new Date() }, dataDir: dir },
    { golden: here, productions: empty('productions'), candidates: empty('candidates') },
  );
  writeSettings(db, { ...readSettings(db), sources: { topads: false, shorts: false } });
  const { template, fill } = golden('layering-01');
  // one real picture (a flat 64×64 PNG made by ffmpeg), at every path the fill's products name
  const picture = join(dir, '_picture.png');
  const made = spawnSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x336699:s=64x64', '-frames:v', '1', '-y', picture]);
  if (made.status !== 0) throw new Error(`ffmpeg could not make the picture: ${made.stderr}`);
  const bytes = readFileSync(picture);
  for (const product of fill.products) for (const image of product.images) {
    mkdirSync(dirname(join(dir, image)), { recursive: true });
    writeFileSync(join(dir, image), bytes);
  }
  const answers = join(dir, 'answers.json');
  writeFileSync(answers, JSON.stringify({ answers: [{ match: template.id, answer: answerOf(fill, 1) }] }));
  const world = { dir, db, template, fill, generatorLog: join(dir, 'generator.log'), answers };
  worlds.push(world);
  return world;
}

/** The produce input and the approved amount, computed as the site computes them (inputOf, paidFor). */
export function produceInput(w: World): { input: ProduceInput; approved: ReturnType<typeof paidFor> } {
  return { input: inputOf(w.template, w.fill, 1), approved: paidFor(w.template, 1) };
}

/** Queue a run, the way the site hands it over: `held: true` leaves it held until `release`. */
export function queue(w: World, held: boolean): string {
  const { input, approved } = produceInput(w);
  const id = enqueue(w.db, input, `e2e-${Math.random().toString(36).slice(2)}`, approved, new Date());
  if (held) w.db.prepare(`UPDATE runs SET state = 'held' WHERE id = ?`).run(id);
  return id;
}
/** What `committed()` of the site's engine does: held runs become queued. */
export function release(w: World): void {
  w.db.prepare(`UPDATE runs SET state = 'queued' WHERE state = 'held'`).run();
}

export interface Worker { child: ChildProcess; exited: Promise<number | null>; output: () => string }
const alive = new Set<Worker>();

export function startWorker(w: World, extra: Record<string, string> = {}): Worker {
  const env: NodeJS.ProcessEnv = {
    ...process.env, VC_DATA_DIR: w.dir, VC_FAKE_GENERATOR_LOG: w.generatorLog, VC_LLM_SCRIPT: w.answers,
    HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', NO_COLOR: '1', ...extra,
  };
  delete env.VC_PROVIDER;
  const child = spawn('node', ['src/worker/main.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  const keep = (b: Buffer) => { text = (text + b.toString()).slice(-4000); };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  const exited = new Promise<number | null>((res) => child.once('exit', (code) => res(code)));
  const worker = { child, exited, output: () => text };
  alive.add(worker);
  return worker;
}

export async function endWorker(worker: Worker): Promise<void> {
  if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL');
  await worker.exited;
  alive.delete(worker);
}
export async function endAll(): Promise<void> {
  for (const worker of [...alive]) await endWorker(worker);
}

export async function until<T>(what: string, ms: number, check: () => T | null | false | undefined, every = 500): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = check();
    if (got) return got;
    if (Date.now() > end) throw new Error(`timed out (${ms} ms) waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, every));
  }
}

export function logOf(w: World): LogLine[] {
  return existsSync(w.generatorLog)
    ? readFileSync(w.generatorLog, 'utf8').split('\n').filter((row) => row !== '').map((row) => JSON.parse(row) as LogLine)
    : [];
}

export const runOf = (w: World, id: string): RunRow => getRun(w.db, id)!;
export const finished = (r: RunRow) => r.state === 'done' || r.state === 'stopped';

/** Ends every worker, then closes and removes every data dir this file made (also after a failed test). */
export async function cleanUp(): Promise<void> {
  await endAll();
  for (const w of worlds.splice(0)) {
    try { w.db.close(); } catch { /* already closed */ }
    rmSync(w.dir, { recursive: true, force: true });
  }
}
