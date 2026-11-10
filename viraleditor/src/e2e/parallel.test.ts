// The parallel-production trial of plan-paralel-uretim section 5, step 1, without money: the worker's own `start` with VC_WORKER_PRODUCE=3,
// the pretend provider (the fake generator with a delay, the real adapter of a pretend Magnific), two customers and five videos.
// The picture side is not part of it (no browser): a video is its files written.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { FakeRenderer } from '../adapters/fakes.ts';
import { enqueue, getRun } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import { produceHandler } from '../produce/index.ts';
import type { Assemble } from '../produce/deps.ts';
import { operationsOf } from '../produce/rows.ts';
import { inputOf, put } from '../produce/testing.ts';
import { paidFor } from '../template/estimate.ts';
import { start, realHandlers } from '../worker/main.ts';
import { buildParts } from '../worker/parts.ts';
import { cleanUp, logOf, makeWorld } from './world.ts';

afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await cleanUp(); });

const REQUESTS = 11;                                              // layering-01, one variant: 5 images, 5 clips, music
const settle = (check: () => boolean) => vi.waitFor(() => { if (!check()) throw new Error('not yet'); }, { timeout: 90_000, interval: 25 });

it('three at once: five videos of two customers on VC_WORKER_PRODUCE=3: 3 run together, the second customer\'s first starts before the first customer\'s third, no request is sent twice, every video is made', { timeout: 120_000 }, async () => {
  vi.stubEnv('VC_WORKER_PRODUCE', '3');
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  const w = await makeWorld();
  vi.stubEnv('VC_DATA_DIR', w.dir);
  const t0 = Date.now();
  const make = (owner: string, n: number) => enqueue(w.db, inputOf(w.template, w.fill, 1, { ownerId: owner }), `${owner}-job${n}`, paidFor(w.template, 1), new Date(t0 + n));
  const mine = [0, 1, 2].map((n) => make('u1', n));
  const theirs = [3, 4].map((n) => make('u2', n));
  const all = [...mine, ...theirs];

  const parts = buildParts(
    { VC_DATA_DIR: w.dir, VC_LLM_SCRIPT: w.answers, VC_FAKE_GENERATOR_LOG: w.generatorLog, VC_FAKE_DELAY_MS: '40' },
    w.db, { now: () => new Date() }, { renderer: new FakeRenderer({ ready: { ready: true, note: null } }), aligner: { align: async () => [], ready: async () => ({ ready: false, note: null }) } },
  );
  const assemble: Assemble = async (deps, _run, _template, media) => {
    deps.onRender?.();
    put(`${media.dir}/final.mp4`, 'a video');
    return { ok: true, video: `${media.dir}/final.mp4`, image: `${media.dir}/poster.jpg` };
  };
  const started: string[] = [];
  let inside = 0, most = 0;
  const handlers = {
    ...realHandlers(parts),
    produce: async (run: RunRow) => {
      started.push(run.id); inside += 1; most = Math.max(most, inside);
      try { await produceHandler({ ...parts.produceDeps(), assemble })(run); } finally { inside -= 1; }
    },
  };
  const worker = start(w.db, { parts, handlers, idleMs: 20 });
  try { await settle(() => all.every((id) => getRun(w.db, id)?.state === 'done')); } finally { await worker.stop(); }

  expect(most).toBe(3);                                            // the lane of 3 was full, and never wider
  expect(new Set(started.slice(0, 3))).toEqual(new Set([mine[0], mine[1], theirs[0]]));   // the customer with the fewest running goes before the first customer's third
  expect(started.slice(3)).toEqual(expect.arrayContaining([mine[2], theirs[1]]));
  expect(started).toHaveLength(5);

  const lines = logOf(w);
  expect(lines).toHaveLength(5 * REQUESTS);                         // what the pretend provider was asked, once per request
  const tickets = all.flatMap((id) => operationsOf(w.db, id).map((row) => row.externalId));
  expect(tickets).toHaveLength(5 * REQUESTS);
  expect(new Set(tickets).size).toBe(5 * REQUESTS);                 // every request a row of its own, every row its own ticket
  expect(new Set(lines.map((line) => line.ticket))).toEqual(new Set(tickets));
  for (const id of all) {
    const run = getRun(w.db, id)!;
    expect(run).toMatchObject({ state: 'done', sent: paidFor(w.template, 1), takeovers: 0 });
    expect(operationsOf(w.db, id).map((row) => row.state)).toEqual(Array(REQUESTS).fill('done'));
    expect(run.result).toMatchObject({ kind: 'produce' });
    const video = run.result?.kind === 'produce' ? run.result.variants[0]?.video : undefined;
    expect(video !== undefined && existsSync(join(w.dir, video))).toBe(true);
  }
  expect(logged.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('stage=gate.provider wait_ms='))).not.toHaveLength(0);   // 3 videos want 9 places at a gate of 3
  expect(logged.mock.calls.map((call) => String(call[0])).filter((line) => /produce-unknown|rejected/.test(line))).toEqual([]);
});
