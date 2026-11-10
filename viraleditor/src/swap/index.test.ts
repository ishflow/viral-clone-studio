// A person-swap run from its claim to the delivered video, on real files: the pretend provider, the real ffmpeg tools.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { containerFacts } from '../adapters/encode.ts';
import { FakeClock } from '../adapters/fakes.ts';
import { createFakeSwapper } from '../adapters/fake-swapper.ts';
import type { FakeSwapperOptions } from '../adapters/fake-swapper.ts';
import type { CardSwap, Paid } from '../contracts.ts';
import { getRun, operation } from '../db/runs.ts';
import { abs } from '../paths.ts';
import { GeneratorError } from '../ports.ts';
import type { PersonSwapper, Splicer } from '../ports.ts';
import { operationsOf } from '../produce/rows.ts';
import { PHOTOGRAPH, put, resumeRun, workspace } from '../produce/testing.ts';
import { creditsHold, holdCredits } from '../robust/provider-credits.ts';
import { openGate } from '../worker/gate.ts';
import { swapHandler } from './index.ts';
import type { SwapDeps } from './index.ts';
import { BODY, clip, FFMPEG, FFPROBE, finalOf, hasFfmpeg, inputOf, partFile, seedSwap, startSwap, TEMPLATE, tools } from './testing.ts';

const TIERS = { fast: { model: 'fake-swap', resolution: '720p' }, best: { model: 'fake-swap', resolution: '1080p' } };
const ZERO: Paid = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };
const SLOW = 120_000;

let db: DatabaseSync, dir: string, clock: FakeClock, swap: CardSwap;
beforeEach(async () => {
  ({ db, dir } = workspace());
  clock = new FakeClock();
  if (hasFfmpeg) swap = await seedSwap(25);
}, SLOW);
const log = () => join(dir, 'fake-swapper.log');
const fake = (options: Partial<FakeSwapperOptions> = {}) => createFakeSwapper({ log: log(), ffmpeg: FFMPEG, ffprobe: FFPROBE, ...options });
const promptsSent = () => (existsSync(log()) ? readFileSync(log(), 'utf8').trim().split('\n').map((row) => (JSON.parse(row) as { prompt: string }).prompt) : []);
const sentVideos = () => (existsSync(log()) ? readFileSync(log(), 'utf8').trim().split('\n').map((row) => (JSON.parse(row) as { video: string }).video) : []);
const handle = (swapper: PersonSwapper, id: string, more: Partial<SwapDeps> = {}) => swapHandler({ db, swapper, ...tools(), clock, tiers: TIERS, ...more })(getRun(db, id)!);
const stateOf = (id: string) => { const run = getRun(db, id)!; return { state: run.state, reason: run.reason, missing: run.missing, detail: run.detail }; };
/** jobs/<run>/stop.json: what the admin reads of a stopped run. */
const stopOf = (id: string) => JSON.parse(readFileSync(abs(`jobs/${id}/stop.json`), 'utf8')) as { reason: string; detail: string };
const posterOf = (id: string) => abs(`jobs/${id}/v1/poster.jpg`);
type Join = Splicer['join'];
/** The real tools, but the parts are joined by `join` (given the real one). */
const joinedBy = (join: (real: Join) => Join): Partial<SwapDeps> => { const real = tools().splicer; return { splicer: { ...real, join: join(real.join) } }; };
/** Joiners that go wrong in the three ways a delivered video never may: no label drawn, a frame lost, no sound laid under it. */
const BROKEN: Record<string, (real: Join) => Join> = {
  'shows no AI label': (real) => (parts, sound, _label, to) => {
    const clear = join(dir, 'clear.png');
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=540x120,format=rgba', '-frames:v', '1', clear]);
    return real(parts, sound, clear, to);
  },
  'is a frame short': (real) => async (parts, sound, label, to) => {
    const last = parts.at(-1)!, short = join(dir, 'short.mp4');
    const { width, height, fps, frames } = await tools().media.probe(last);
    await tools().splicer.fit(last, short, { width, height, fps, frames: frames - 1 });
    return real([...parts.slice(0, -1), short], sound, label, to);
  },
  'has no sound': (real) => (parts, _sound, label, to) => real(parts, null, label, to),
};
/** The fake, but `change` decides what one part's request does instead (by the number of the part): fail, or (answering true) write the file itself. */
function except(change: (n: number, to: string) => boolean | undefined | Promise<never>): PersonSwapper & { asked: number[] } {
  const real = fake(), asked: number[] = [];
  return {
    ...real, asked,
    async replace(request, to, onSubmitted) {
      const n = swap.parts.find((part) => partFile(part.n) === request.video)!.n;
      asked.push(n);
      const other = change(n, to);
      if (other instanceof Promise) return other;
      if (other === true) { onSubmitted(`made-${n}`); return { taskId: `made-${n}`, file: to }; }
      return real.replace(request, to, onSubmitted);
    },
  };
}

describe.skipIf(!hasFfmpeg)('a person-swap run', () => {
  it('a video of 25 seconds is asked for in 3 parts and delivered with every frame of the source, its sound and the AI label', async () => {
    const run = startSwap(db, clock, swap);
    await handle(fake(), run.id);
    const done = getRun(db, run.id)!;
    expect(stateOf(run.id)).toEqual({ state: 'done', reason: null, missing: null, detail: null });
    expect(done.result).toEqual({ kind: 'produce', variants: [{ video: `jobs/${run.id}/v1/final.mp4`, image: `jobs/${run.id}/v1/poster.jpg` }] });
    expect(sentVideos()).toEqual([1, 2, 3].map(partFile));
    expect(done.sent).toEqual({ ...ZERO, clips: 3, clipSeconds: 27 });
    expect(await containerFacts(FFPROBE, finalOf(run.id), 10_000)).toMatchObject({ ...(await containerFacts(FFPROBE, abs(`templates/${TEMPLATE}/source.mp4`), 10_000)), seconds: expect.any(Number) });
    expect((await containerFacts(FFPROBE, finalOf(run.id), 10_000))).toMatchObject({ frames: 750, audio: true });
    expect(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format_tags=comment', '-of', 'csv=p=0', finalOf(run.id)]).toString().trim()).toBe('AI-generated');
    expect(existsSync(abs(`jobs/${run.id}/v1/poster.jpg`))).toBe(true);
    expect(done.steps.filter((step) => step.total > 0).map((step) => [step.key, step.status, step.done, step.total])).toEqual([['clips', 'done', 3, 3], ['edit', 'done', 1, 1], ['render', 'done', 1, 1]]);
    expect(done.variants).toEqual([{ n: 1, status: 'done', video: `jobs/${run.id}/v1/final.mp4`, image: `jobs/${run.id}/v1/poster.jpg`, reason: null }]);
  }, SLOW);

  it('asks with the clothes the run was given: the photograph\'s when it says so, the video\'s when it says so or says nothing (a run written before the choice)', async () => {
    const photo = startSwap(db, clock, swap, undefined, inputOf({ swap: { people: [{ slot: 1, body: BODY, face: null }], outfit: 'photo' } }));
    await handle(fake(), photo.id);
    expect(promptsSent()).toHaveLength(3);
    for (const prompt of promptsSent()) expect(prompt).toContain('Outfit: the person wears the clothes of the photograph.');
    rmSync(log());
    const old = startSwap(db, clock, swap);
    await handle(fake(), old.id);
    for (const prompt of promptsSent()) expect(prompt).toContain('Outfit: keep the clothes of the person in the video.');
  }, SLOW);

  it('with a side photograph is delivered like any other, and every request says only that it has one; a run without (also one written before there was a third) says it has none', async () => {
    const sides = () => readFileSync(log(), 'utf8').trim().split('\n').map((row) => (JSON.parse(row) as { side: string[] }).side);
    put('uploads/u1/side.png', PHOTOGRAPH);
    const withSide = startSwap(db, clock, swap, undefined, inputOf({ swap: { people: [{ slot: 1, body: BODY, face: null, side: 'uploads/u1/side.png' }] } }));
    await handle(fake(), withSide.id);
    expect(stateOf(withSide.id)).toEqual({ state: 'done', reason: null, missing: null, detail: null });
    expect(sides()).toEqual([['yes'], ['yes'], ['yes']]);
    expect(readFileSync(log(), 'utf8')).not.toContain('side.png');
    rmSync(log());
    const without = startSwap(db, clock, swap);
    await handle(fake(), without.id);
    expect(sides()).toEqual([['no'], ['no'], ['no']]);
  }, SLOW);

  it('is delivered while the provider of the product videos is on hold for its credits, and leaves that hold standing', async () => {
    holdCredits(db, 'another-run', 'v1:image:s1', clock.now());
    const run = startSwap(db, clock, swap);
    await handle(fake(), run.id);
    expect(stateOf(run.id)).toEqual({ state: 'done', reason: null, missing: null, detail: null });
    expect(sentVideos()).toEqual([1, 2, 3].map(partFile));
    expect(creditsHold(db)).toMatchObject({ runId: 'another-run', key: 'v1:image:s1' });
  }, SLOW);

  it('stops when a part fails: only that part is missing, and a resume sends only that part', async () => {
    const run = startSwap(db, clock, swap);
    await handle(fake({ failSwap: 2 }), run.id);
    expect(stateOf(run.id)).toEqual({ state: 'stopped', reason: 'clips-failed', missing: { ...ZERO, clips: 1, clipSeconds: 9 }, detail: null });
    expect(getRun(db, run.id)!.result).toEqual({ kind: 'produce', variants: [] });
    expect(existsSync(finalOf(run.id))).toBe(false);                     // never a video with a part of the source in it
    resumeRun(db, clock, run.id);
    await handle(fake(), run.id);
    expect(stateOf(run.id).state).toBe('done');
    expect(sentVideos()).toEqual([1, 2, 3, 2].map(partFile));
    expect(operationsOf(db, run.id).map((row) => [row.key, row.state])).toEqual([['v1:clip:p01', 'done'], ['v1:clip:p02', 'failed'], ['v1:clip:p02#2', 'done'], ['v1:clip:p03', 'done']]);
    expect((await containerFacts(FFPROBE, finalOf(run.id), 10_000)).frames).toBe(750);
  }, SLOW);

  it('a request whose answer is unknown stops the run, and no later call of the handler sends anything', async () => {
    const run = startSwap(db, clock, swap);
    await handle(except((n) => (n === 2 ? Promise.reject(new GeneratorError('submission-unknown', 'no answer')) : undefined)), run.id);
    expect(stateOf(run.id)).toMatchObject({ state: 'stopped', reason: 'submission-unknown', missing: ZERO });
    db.prepare("UPDATE runs SET state = 'running' WHERE id = ?").run(run.id);
    const later = except(() => undefined);
    await handle(later, run.id);
    expect(stateOf(run.id)).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
    expect(later.asked).toEqual([]);
  }, SLOW);

  it('a worker that died before the provider answered left a request that may exist: it is never sent again', async () => {
    const run = startSwap(db, clock, swap);
    db.prepare("INSERT INTO operations (run_id, key, kind, state, created_at, updated_at) VALUES (?, 'v1:clip:p01', 'clip', 'pending', ?, ?)").run(run.id, clock.now().toISOString(), clock.now().toISOString());
    const swapper = except(() => undefined);
    await handle(swapper, run.id);
    expect(stateOf(run.id)).toMatchObject({ state: 'stopped', reason: 'submission-unknown' });
    expect(swapper.asked).toEqual([]);
  }, SLOW);

  it('a part that came back in another size and two frames short is fitted; one of another length is made again by a resume', async () => {
    const run = startSwap(db, clock, swap);
    await handle(except((n, to) => { if (n === 1) clip(to, 248, { width: 360, height: 640, fps: 30 }); if (n === 3) clip(to, 90); return n !== 2; }), run.id);
    expect(stateOf(run.id)).toEqual({ state: 'stopped', reason: 'clips-failed', missing: { ...ZERO, clips: 1, clipSeconds: 9 }, detail: null });
    resumeRun(db, clock, run.id);
    const again = except(() => undefined);
    await handle(again, run.id);
    expect([stateOf(run.id).state, again.asked]).toEqual(['done', [3]]);
    expect(await containerFacts(FFPROBE, finalOf(run.id), 10_000)).toMatchObject({ width: 180, height: 320, frames: 750 });
  }, SLOW);

  it('sends nothing for a run it can know is wrong before it pays', async () => {
    const swapper = except(() => undefined);
    const stopped = async (start: () => { id: string }) => { const { id } = start(); await handle(swapper, id); return [stateOf(id).state, stateOf(id).reason]; };
    expect(await stopped(() => startSwap(db, clock, swap, { ...ZERO, clips: 3, clipSeconds: 26 }))).toEqual(['stopped', 'estimate-exceeded']);
    expect(await stopped(() => startSwap(db, clock, swap, undefined, inputOf({ swap: { people: [{ slot: 1, body: BODY, face: null }, { slot: 2, body: BODY, face: null }] } })))).toEqual(['stopped', 'engine-error']);
    expect(await stopped(() => startSwap(db, clock, swap, undefined, inputOf({ swap: { people: [{ slot: 1, body: `templates/${TEMPLATE}/swap.json`, face: null }] } })))).toEqual(['stopped', 'engine-error']);
    put('uploads/u1/broken.png', 'not a picture');
    expect(await stopped(() => startSwap(db, clock, swap, undefined, inputOf({ swap: { people: [{ slot: 1, body: BODY, face: 'uploads/u1/broken.png' }] } })))).toEqual(['stopped', 'images-failed']);
    expect(await stopped(() => startSwap(db, clock, swap, undefined, inputOf({ swap: { people: [{ slot: 1, body: BODY, face: null, side: 'uploads/u1/broken.png' }] } })))).toEqual(['stopped', 'images-failed']);
    expect(await stopped(() => startSwap(db, clock, swap, undefined, inputOf({ swap: { people: [{ slot: 1, body: BODY, face: null, side: `templates/${TEMPLATE}/swap.json` }] } })))).toEqual(['stopped', 'engine-error']);
    copyFileSync(partFile(1), partFile(3));
    expect(await stopped(() => startSwap(db, clock, swap))).toEqual(['stopped', 'template-missing']);
    rmSync(abs(`templates/${TEMPLATE}/swap.json`));
    expect(await stopped(() => startSwap(db, clock, swap))).toEqual(['stopped', 'template-missing']);
    expect(swapper.asked).toEqual([]);
    put(BODY, PHOTOGRAPH);
  }, SLOW);

  it.each(Object.keys(BROKEN))('a joined video that %s is not delivered: the run stops as render-failed and no final.mp4 appears', async (how) => {
    const run = startSwap(db, clock, swap);
    await handle(fake(), run.id, joinedBy(BROKEN[how]!));
    expect(stateOf(run.id)).toEqual({ state: 'stopped', reason: 'render-failed', missing: ZERO, detail: null });
    expect(getRun(db, run.id)!.result).toEqual({ kind: 'produce', variants: [] });
    expect(getRun(db, run.id)!.variants).toMatchObject([{ video: null, image: null }]);
    expect([existsSync(finalOf(run.id)), existsSync(posterOf(run.id))]).toEqual([false, false]);
    expect(stopOf(run.id).detail).toMatch(/^the joined video is not delivered: /);
  }, SLOW);

  it('a request of an earlier call that may exist stops the run before any other part is sent', async () => {
    const run = startSwap(db, clock, swap);
    db.prepare("INSERT INTO operations (run_id, key, kind, state, created_at, updated_at) VALUES (?, 'v1:clip:p02', 'clip', 'unknown', ?, ?)").run(run.id, clock.now().toISOString(), clock.now().toISOString());
    const swapper = except(() => undefined);
    await handle(swapper, run.id);
    expect(stateOf(run.id)).toMatchObject({ state: 'stopped', reason: 'submission-unknown', missing: ZERO });
    expect(swapper.asked).toEqual([]);                                   // parts 1 and 3 were never sent, and are not sent now
  }, SLOW);

  it('a paid part whose file is gone stops a resume before anything is sent: neither it nor the part that is missing is paid for', async () => {
    const run = startSwap(db, clock, swap);
    await handle(except((n) => (n === 1 ? Promise.reject(new GeneratorError('task-failed', 'the provider made nothing')) : undefined)), run.id);
    expect(stateOf(run.id)).toMatchObject({ state: 'stopped', reason: 'clips-failed' });
    rmSync(abs(operation(db, run.id, 'v1:clip:p03')!.output!));
    resumeRun(db, clock, run.id);
    const again = except(() => undefined);
    await handle(again, run.id);
    expect(stateOf(run.id)).toMatchObject({ state: 'stopped', reason: 'engine-error' });
    expect(again.asked).toEqual([]);
    expect(stopOf(run.id).detail).toBe('the paid file of v1:clip:p03 is gone: it is not paid for again');
    expect(existsSync(finalOf(run.id))).toBe(false);
  }, SLOW);

  it('a part the provider refuses by its own rules stops the run before any part is sent', async () => {
    const run = startSwap(db, clock, swap);
    const swapper = except(() => undefined);
    await handle({ ...swapper, refusal: (request) => (request.video === partFile(2) ? 'not this part' : null) }, run.id);
    expect(stateOf(run.id)).toMatchObject({ state: 'stopped', reason: 'engine-error', missing: ZERO });
    expect(swapper.asked).toEqual([]);
    expect(operationsOf(db, run.id)).toEqual([]);
    expect(stopOf(run.id).detail).toBe('v1:clip:p02: not this part');
  }, SLOW);

  it.each([['fails', 'task-failed', 'clips-failed'], ['may or may not exist at the provider', 'submission-unknown', 'submission-unknown']] as const)(
    'with one request in flight at a time, once a part %s no later part is sent', async (_how, code, reason) => {
      const run = startSwap(db, clock, swap);
      const swapper = except((n) => (n === 1 ? Promise.reject(new GeneratorError(code, 'no file')) : undefined));
      await handle(swapper, run.id, { paidGate: openGate(1) });
      expect(stateOf(run.id)).toMatchObject({ state: 'stopped', reason });
      expect(swapper.asked).toEqual([1]);
    }, SLOW);

  it('a worker that lost the run while it joined the video gives no file its name', async () => {
    const run = startSwap(db, clock, swap);
    const taken = (real: Join): Join => async (...args) => {
      const facts = await real(...args);
      db.prepare("UPDATE runs SET claimed_by = 'worker-other' WHERE id = ?").run(run.id);
      return facts;
    };
    await handle(fake(), run.id, joinedBy(taken));
    expect([existsSync(finalOf(run.id)), existsSync(posterOf(run.id))]).toEqual([false, false]);
    expect(getRun(db, run.id)).toMatchObject({ state: 'running', claimedBy: 'worker-other', result: null });
  }, SLOW);

  it('the provider refuses the photograph: the run stops under that code and nothing is delivered', async () => {
    const run = startSwap(db, clock, swap);
    await handle(except(() => Promise.reject(new GeneratorError('rejected', 'photo-refused', null, 422))), run.id);
    expect(stateOf(run.id)).toMatchObject({ state: 'stopped', reason: 'engine-error', detail: 'photo-refused' });
    expect(getRun(db, run.id)!.sent ?? ZERO).toMatchObject({ clips: 0 });
  }, SLOW);
});
