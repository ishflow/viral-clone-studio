// Two person-swap videos in the making at once, on the worker's own wiring (buildParts, realHandlers, two produce lanes): two
// templates of different lengths, two customers with photographs of their own. What goes to the provider for a run, and what
// comes back into its folder, is that run's alone.
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { containerFacts } from '../adapters/encode.ts';
import { FakeRenderer } from '../adapters/fakes.ts';
import type { CardSwap, Paid } from '../contracts.ts';
import { enqueue, getRun, operation } from '../db/runs.ts';
import { abs } from '../paths.ts';
import { GeneratorError } from '../ports.ts';
import type { PersonSwapper, SwapRequest } from '../ports.ts';
import { countOf } from '../produce/plan.ts';
import { operationsOf } from '../produce/rows.ts';
import { PHOTOGRAPH, put, workspace } from '../produce/testing.ts';
import { needsOf, partOf } from '../swap/plan.ts';
import { BODY, FFPROBE, finalOf, hasFfmpeg, inputOf, seedSwap, TEMPLATE } from '../swap/testing.ts';
import { runWorker } from '../worker/loop.ts';
import { realHandlers } from '../worker/main.ts';
import { buildParts } from '../worker/parts.ts';

const ZERO: Paid = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };
const SLOW = 120_000;
const OTHER = 'swap-2';
const HERS = { body: 'uploads/u2/body.png', face: 'uploads/u2/face.png' };
const clock = { now: () => new Date() };
const health = async () => ({ provider: 'fake' as const, renderer: 'ready' as const, note: null });
const ok = async () => {};
async function until(check: () => boolean, ms = 90_000): Promise<void> {
  for (const end = Date.now() + ms; Date.now() < end;) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  throw new Error('timed out waiting');
}

interface Asked { run: string; video: string; people: SwapRequest['people'] }
/**
 * The worker's own provider with every request written down under the run whose folder its file goes to. `together`: of how many runs requests were open at one time, at the most.
 * The first request of all, once the provider has made its file, stays open until a request of the other run is open too (or `release`):
 * whether the two meet is not left to how long this machine takes over each.
 */
function listened(real: PersonSwapper, refuse: (request: SwapRequest) => boolean = () => false) {
  const asked: Asked[] = [], open = new Map<string, number>();
  const seen = { together: 0 };
  let release!: () => void;
  const met = new Promise<void>((resolve) => { release = resolve; });
  const swapper: PersonSwapper = {
    ...real,
    async replace(request, to, onSubmitted) {
      const run = /\/jobs\/([^/]+)\//.exec(to)![1]!;
      const first = asked.length === 0;
      asked.push({ run, video: request.video, people: request.people });
      open.set(run, (open.get(run) ?? 0) + 1);
      seen.together = Math.max(seen.together, open.size);
      if (open.size === 2) release();
      try {
        if (refuse(request)) throw new GeneratorError('rejected', 'photo-refused', null, 422);
        const made = await real.replace(request, to, onSubmitted);
        if (first) await met;
        return made;
      } finally {
        if (open.get(run) === 1) open.delete(run); else open.set(run, open.get(run)! - 1);
      }
    },
  };
  return { swapper, asked, seen, release };
}

let db: DatabaseSync, dir: string, long: CardSwap, short: CardSwap, errors: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  ({ db, dir } = workspace());
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  if (!hasFfmpeg) return;
  short = await seedSwap(12);                                               // two parts of 6 seconds…
  renameSync(abs(`templates/${TEMPLATE}`), abs(`templates/${OTHER}`));      // …as the other template
  long = await seedSwap(25);                                                // three parts
  put(HERS.body, PHOTOGRAPH);
  put(HERS.face, PHOTOGRAPH);
}, SLOW);
afterEach(() => { errors.mockRestore(); });

/** Both videos queued, the worker started with two produce lanes; returns when both runs have ended. When they do not end in time, the request held open is let go, so that the worker stops and the test says so. */
async function making(refuse?: (request: SwapRequest) => boolean) {
  const parts = buildParts({ VC_DATA_DIR: dir, CLAUDE_CODE_OAUTH_TOKEN: 'token-made-up' }, db, clock, { renderer: new FakeRenderer({ ready: { ready: true, note: null } }), aligner: { align: async () => [], ready: async () => ({ ready: false, note: null }) } });
  const provider = listened(parts.swapDeps.swapper, refuse);
  const handlers = realHandlers({ ...parts, swapDeps: { ...parts.swapDeps, swapper: provider.swapper } });
  const his = enqueue(db, inputOf(), 'job-1', countOf(needsOf(long, 'any')), clock.now());
  const hers = enqueue(db, inputOf({ templateId: OTHER, ownerId: 'u2', swap: { people: [{ slot: 1, ...HERS }] } }), 'job-2', countOf(needsOf(short, 'any')), clock.now());
  const worker = runWorker({ db, clock, workerId: 'worker-A', idleMs: 5, health, lanes: [{ kinds: ['produce'], size: 2 }], handlers: { ...handlers, scan: ok, prepare: ok, edit: ok } });
  try { await until(() => [his, hers].every((id) => ['done', 'stopped'].includes(getRun(db, id)!.state))); } finally { provider.release(); await worker.stop(); }
  return { his, hers, ...provider };
}
const of = (asked: Asked[], run: string) => asked.filter((each) => each.run === run);
const photographs = (asked: Asked[]) => [...new Set(asked.flatMap((each) => each.people.flatMap((person) => [person.body, person.face])))];
/** The provider's own record: the part each ticket was accepted for. */
const acceptedFor = () => new Map(readFileSync(join(dir, 'fake-swapper.log'), 'utf8').trim().split('\n').map((row) => { const line = JSON.parse(row) as { ticket: string; video: string }; return [line.ticket, line.video] as const; }));

describe.skipIf(!hasFfmpeg)('two person-swap videos in the making at once, in two lanes of one worker', () => {
  it('each run sends the parts of its own template with the photographs of its own customer, and each video is made of its own parts', async () => {
    const { his, hers, asked, seen } = await making();
    expect(seen.together).toBe(2);                                          // requests of both runs were open at one time
    expect([getRun(db, his)!.state, getRun(db, hers)!.state]).toEqual(['done', 'done']);
    expect(new Set([getRun(db, his)!.claimedBy, getRun(db, hers)!.claimedBy]).size).toBe(2);   // a lane each

    expect(of(asked, his).map((each) => each.video).sort()).toEqual([1, 2, 3].map((n) => abs(partOf(TEMPLATE, n))));
    expect(of(asked, hers).map((each) => each.video).sort()).toEqual([1, 2].map((n) => abs(partOf(OTHER, n))));
    expect(photographs(of(asked, his))).toEqual([abs(BODY), null]);
    expect(photographs(of(asked, hers))).toEqual([abs(HERS.body), abs(HERS.face)]);

    // the rows: each paid file is in the folder of its own run, under a ticket no other run has, and the provider accepted that ticket for a part of that run's template
    const accepted = acceptedFor();
    const tickets: string[] = [];
    for (const [run, template] of [[his, TEMPLATE], [hers, OTHER]] as const) {
      for (const { key } of operationsOf(db, run)) {
        const row = operation(db, run, key)!;
        expect(row).toMatchObject({ state: 'done', output: expect.stringMatching(new RegExp(`^jobs/${run}/paid/v1/clip-p0\\d\\.mp4$`)) });
        expect(accepted.get(row.externalId!)).toBe(abs(partOf(template, Number(key.slice(-2)))));
        tickets.push(row.externalId!);
      }
    }
    expect(new Set(tickets).size).toBe(5);
    expect(accepted.size).toBe(5);                                          // five parts, five requests: none twice

    expect(getRun(db, his)).toMatchObject({ sent: { ...ZERO, clips: 3, clipSeconds: 27 }, result: { kind: 'produce', variants: [{ video: `jobs/${his}/v1/final.mp4`, image: `jobs/${his}/v1/poster.jpg` }] } });
    expect(getRun(db, hers)).toMatchObject({ sent: { ...ZERO, clips: 2, clipSeconds: 12 }, result: { kind: 'produce', variants: [{ video: `jobs/${hers}/v1/final.mp4`, image: `jobs/${hers}/v1/poster.jpg` }] } });
    expect((await containerFacts(FFPROBE, finalOf(his), 10_000)).frames).toBe(750);
    expect((await containerFacts(FFPROBE, finalOf(hers), 10_000)).frames).toBe(360);
  }, SLOW);

  it('the provider refuses the photograph of one customer: that run alone stops, with nothing counted, and the other video is delivered whole', async () => {
    const { his, hers, asked } = await making((request) => request.people.some((person) => person.body === abs(HERS.body)));
    expect(getRun(db, hers)).toMatchObject({ state: 'stopped', reason: 'engine-error', detail: 'photo-refused', result: { kind: 'produce', variants: [] } });
    expect(getRun(db, hers)!.sent ?? ZERO).toEqual(ZERO);
    expect(operationsOf(db, hers).filter((row) => row.externalId !== null)).toEqual([]);
    expect(existsSync(finalOf(hers))).toBe(false);

    expect(getRun(db, his)).toMatchObject({ state: 'done', sent: { ...ZERO, clips: 3, clipSeconds: 27 } });
    expect(of(asked, his)).toHaveLength(3);
    expect(photographs(of(asked, his))).toEqual([abs(BODY), null]);
    expect((await containerFacts(FFPROBE, finalOf(his), 10_000)).frames).toBe(750);
    expect([...acceptedFor().values()].sort()).toEqual([1, 2, 3].map((n) => abs(partOf(TEMPLATE, n))));   // nothing of the refused run reached the provider's record
  }, SLOW);
});
