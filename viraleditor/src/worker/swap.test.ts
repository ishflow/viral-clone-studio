// The worker's wiring of a person swap: which provider it builds from its environment, and which handler a produce run goes to.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock, FakeRenderer } from '../adapters/fakes.ts';
import type { RunInput } from '../contracts.ts';
import { openDb } from '../db/open.ts';
import { claim, enqueue, getRun, operation } from '../db/runs.ts';
import { countRows, operationsOf } from '../produce/rows.ts';
import { finalOf, hasFfmpeg, seedSwap, startSwap } from '../swap/testing.ts';
import { realHandlers } from './main.ts';
import { buildParts } from './parts.ts';
import type { Env } from './parts.ts';

const clock = new FakeClock('2026-10-07T10:00:00.000Z');
function build(env: Env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vc-swap-parts-'));
  const db = openDb(join(dir, 'db.sqlite'));
  const parts = buildParts({ VC_DATA_DIR: dir, CLAUDE_CODE_OAUTH_TOKEN: 'token-made-up', ...env }, db, clock, { renderer: new FakeRenderer({ ready: { ready: true, note: null } }), aligner: { align: async () => [], ready: async () => ({ ready: false, note: null }) } });
  return { dir, db, parts };
}
const REQUEST = { video: '/nowhere/p01.mp4', people: [{ slot: 1, body: '/nowhere/body.jpg', face: null, hint: 'the person' }], seconds: 5, tier: { model: 'any', resolution: '720p' }, keepSound: false };
const codeOf = (promise: Promise<unknown>) => promise.then(() => 'no error', (error: { code?: string }) => error.code);
/** A worker that pays for what it sends: the paid provider with its key and its caps, all made up. */
const PAID = { VC_PROVIDER: 'magnific', MAGNIFIC_API_KEY: 'k-test', VC_PROVIDER_DAILY_CAP: '100', VC_PROVIDER_JOB_CAP: '60' };
afterEach(() => { vi.unstubAllEnvs(); });

describe('buildParts: the person-swap provider', () => {
  it('is the pretend one unless another is named, with its own log in the data dir and a model for each quality', async () => {
    for (const env of [{}, { VC_SWAP_PROVIDER: 'fake' }]) {
      const { dir, parts } = build(env);
      expect(await codeOf(parts.swapDeps.swapper.replace(REQUEST, join(dir, 'out.mp4'), () => {}))).toBe('upload-failed');   // the fake reads its files; a paid client would be refused for its key first
      expect(Object.keys(parts.swapDeps.tiers)).toEqual(['fast', 'best']);
      expect((await parts.health()).note).toBeNull();
    }
  });

  it('a provider this worker cannot build refuses every request as not configured, never the pretend one instead, and health says so', async () => {
    for (const name of ['fal', 'FAKE ', 'x'.repeat(80)]) {
      const { dir, parts } = build({ VC_SWAP_PROVIDER: name });
      const { swapper } = parts.swapDeps;
      expect(await codeOf(swapper.replace(REQUEST, join(dir, 'out.mp4'), () => { throw new Error('accepted'); }))).toBe('not-configured');
      expect(await codeOf(swapper.resume('fake-swap-1', join(dir, 'out.mp4')))).toBe('not-configured');
      expect((await swapper.ready()).ready).toBe(false);
      expect(existsSync(join(dir, 'fake-swapper.log'))).toBe(false);
      expect((await parts.health()).note).toMatch(/VC_SWAP_PROVIDER.*refused/);
    }
  });

  it('a worker that pays never builds the pretend one: with no provider named, with `fake` or with one it cannot build, every request is refused as not configured', async () => {
    for (const named of [{}, { VC_SWAP_PROVIDER: '' }, { VC_SWAP_PROVIDER: 'fake' }, { VC_SWAP_PROVIDER: 'fal' }]) {
      const { dir, parts } = build({ ...PAID, ...named });
      const { swapper } = parts.swapDeps;
      expect(await codeOf(swapper.replace(REQUEST, join(dir, 'out.mp4'), () => { throw new Error('accepted'); }))).toBe('not-configured');
      expect(await codeOf(swapper.resume('fake-swap-1', join(dir, 'out.mp4')))).toBe('not-configured');
      expect((await swapper.ready()).ready).toBe(false);
      expect(existsSync(join(dir, 'fake-swapper.log'))).toBe(false);
    }
  });

  it('health names the person-swap provider in a field of its own: the pretend one, or not configured; one that was only never named adds nothing to the note of the product provider', async () => {
    for (const env of [{}, { VC_SWAP_PROVIDER: '' }, { VC_SWAP_PROVIDER: 'fake' }]) {
      expect(await build(env).parts.health()).toMatchObject({ provider: 'fake', swap: 'fake', note: null });
    }
    expect((await build({ VC_SWAP_PROVIDER: 'fal' }).parts.health()).swap).toBe('not-configured');
    // a worker that pays, with person swap never set up: the product provider is ready and its note is silent (the site reads any note as "the product provider is not configured")
    for (const named of [{}, { VC_SWAP_PROVIDER: '' }]) {
      expect(await build({ ...PAID, ...named }).parts.health()).toMatchObject({ provider: 'magnific', swap: 'not-configured', note: null });
    }
    for (const name of ['fake', 'fal']) {
      expect((await build({ ...PAID, VC_SWAP_PROVIDER: name }).parts.health()).swap).toBe('not-configured');
    }
  });

  it('health says why the worker has no person-swap provider in a field of its own (swapNote); the product provider and its note are what they were', async () => {
    // I2 KÜÇÜK-5: a worker that pays and was named none. The reason names the variable, and the two fields the site reads its product provider from still say "ready"
    for (const named of [{}, { VC_SWAP_PROVIDER: '' }]) {
      const health = await build({ ...PAID, ...named }).parts.health();
      expect(health).toMatchObject({ provider: 'magnific', note: null, swap: 'not-configured', swapNote: 'VC_SWAP_PROVIDER is not set: a worker that pays has no person-swap provider' });
      expect(health.provider === 'fake' ? 'fake' : health.note === null ? 'ready' : 'not-configured').toBe('ready');   // the site's own reading (web: sqlite-engine.ts health())
    }
    // one that was named and cannot be built says so there too; its line of the note is the one it always was
    for (const env of [{ VC_SWAP_PROVIDER: 'fal' }, { ...PAID, VC_SWAP_PROVIDER: 'fake' }]) {
      expect(await build(env).parts.health()).toMatchObject({ swap: 'not-configured', swapNote: 'VC_SWAP_PROVIDER names a person-swap provider this worker cannot build', note: 'VC_SWAP_PROVIDER names a person-swap provider this worker cannot build: its requests are refused' });
    }
    // a provider that is there has nothing to say
    for (const env of [{}, { VC_SWAP_PROVIDER: 'fake' }]) expect(await build(env).parts.health()).toMatchObject({ swap: 'fake', swapNote: null, note: null });
  });

  it.skipIf(!hasFfmpeg)('a person-swap run on a worker that pays and has no person-swap provider stops under provider-setup: nothing is sent, counted or delivered', async () => {
    const { dir, db, parts } = build(PAID);
    vi.stubEnv('VC_DATA_DIR', dir);
    const swap = await seedSwap(25);
    const run = startSwap(db, clock, swap);
    await realHandlers(parts).produce(run);
    const stopped = getRun(db, run.id)!;
    expect(stopped).toMatchObject({ state: 'stopped', reason: 'engine-error', detail: 'provider-setup', result: { kind: 'produce', variants: [] } });
    // what the customer paid for is all still unspent: no request was accepted, and none counts against the approval
    const none = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };
    expect(stopped.sent ?? none).toEqual(none);
    expect(countRows(operationsOf(db, run.id), () => 9, 'spent')).toEqual(none);
    expect(operationsOf(db, run.id).filter((row) => row.state !== 'failed' || row.externalId !== null)).toEqual([]);
    expect(operation(db, run.id, 'v1:clip:p01')).toMatchObject({ state: 'failed', externalId: null, error: expect.stringContaining('VC_SWAP_PROVIDER is not set') });
    expect(existsSync(join(dir, 'fake-swapper.log'))).toBe(false);
    expect(existsSync(finalOf(run.id))).toBe(false);
  }, 120_000);

  it('VC_FAKE_FAIL_SWAP is a number; anything else is refused naming the variable', () => {
    expect(() => build({ VC_FAKE_FAIL_SWAP: 'two' })).toThrow('VC_FAKE_FAIL_SWAP');
  });
});

describe('realHandlers: a produce run', () => {
  const input = (swap: boolean): RunInput => ({ kind: 'produce', templateId: 'none', quality: 'fast', variants: 1, language: 'en', products: [], sample: false, ...(swap ? { swap: { people: [{ slot: 1, body: 'uploads/u1/body.png', face: null }] } } : {}) });
  it.each([[true, 'swap.json'], [false, 'template.json']])('that carries photographs of people (%s) is made by the handler that looks for %s', async (swap, file) => {
    const { dir, db, parts } = build();
    vi.stubEnv('VC_DATA_DIR', dir);
    const id = enqueue(db, input(swap), 'job-1', null, clock.now());
    await realHandlers(parts).produce(claim(db, 'worker-test', clock.now())!);
    expect((JSON.parse(readFileSync(join(dir, 'jobs', id, 'stop.json'), 'utf8')) as { reason: string; detail: string })).toMatchObject({ reason: 'template-missing', detail: expect.stringContaining(file) });
  });
});
