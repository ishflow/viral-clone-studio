import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { openDb } from '../db/open.ts';
import { FakeClock, FakeRenderer } from '../adapters/fakes.ts';
import type { Aligner, ImageRequest, MediaFacts, Renderer, Transcriber } from '../ports.ts';
import { claim, enqueue, finish, getRun, operation } from '../db/runs.ts';
import { paid } from '../produce/paid.ts';
import { planOf } from '../produce/plan.ts';
import { golden, inputOf, startRun, workspace } from '../produce/testing.ts';
import { runWorker } from './loop.ts';
import { buildParts } from './parts.ts';
import { creditsHold, holdCredits, liftCredits } from '../robust/provider-credits.ts';
import type { Env, Overrides } from './parts.ts';

const dir = mkdtempSync(join(tmpdir(), 'vc-parts-'));
const db = openDb(join(dir, 'db.sqlite'));
const clock = new FakeClock('2026-10-04T10:00:00.000Z');
const aligner = (ready: boolean): Aligner => ({ align: async () => [], ready: async () => ({ ready, note: null }) });
const build = (env: Env, ready = false) => buildParts({ VC_DATA_DIR: dir, CLAUDE_CODE_OAUTH_TOKEN: 'token-made-up', ...env }, db, clock, { renderer: new FakeRenderer({ ready: { ready: true, note: null } }), aligner: aligner(ready) });
const settle = () => new Promise((r) => setImmediate(r));

describe('buildParts', () => {
  it('defaults to the fake generator and says so in health', async () => {
    const parts = build({});
    expect(await parts.health()).toMatchObject({ provider: 'fake', renderer: 'ready', note: null });
    expect(await parts.produceDeps().generator.ready()).toMatchObject({ ready: true });
  });
  it('magnific without a key is the Magnific client (refuses) and health says the key is missing', async () => {
    const parts = build({ VC_PROVIDER: 'magnific' });
    const h = await parts.health();
    expect(h.provider).toBe('magnific');
    expect(h.note).toContain('MAGNIFIC_API_KEY');
    expect(await parts.produceDeps().generator.ready()).toMatchObject({ ready: false, note: expect.stringContaining('MAGNIFIC_API_KEY') });
  });
  it('a provider on hold for its credits is in health, with the run and the instant, until the hold is lifted: in a field of its own, not in the note', async () => {
    const parts = build({});
    holdCredits(db, 'run-7', 'v1:image:s8', new Date('2026-10-05T19:59:00.000Z'));
    try {
      const h = await parts.health();
      expect(h.noCredits).toContain('no credits left');
      expect(h.noCredits).toContain('run-7');
      expect(h.noCredits).toContain('2026-10-05T19:59:00.000Z');
      expect(h.note).toBeNull();   // the note is what is not set up on this machine: the site reads any note as "not configured"
    } finally { liftCredits(db, creditsHold(db)); }
    expect(await parts.health()).toMatchObject({ note: null, noCredits: null });
  });
  it('a hold beside a missing key: the note names the key only, the hold stays in its own field', async () => {
    const parts = build({ VC_PROVIDER: 'magnific' });
    holdCredits(db, 'run-8', 'v1:image:s1', new Date('2026-10-05T20:00:00.000Z'));
    try {
      const h = await parts.health();
      expect(h.note).toContain('MAGNIFIC_API_KEY');
      expect(h.note).not.toContain('credits');
      expect(h.noCredits).toContain('run-8');
    } finally { liftCredits(db, creditsHold(db)); }
  });
  it('magnific with a key: no missing-key note', async () => {
    const parts = build({ VC_PROVIDER: 'magnific', MAGNIFIC_API_KEY: 'k-test', VC_PROVIDER_DAILY_CAP: '100', VC_PROVIDER_JOB_CAP: '60' });
    expect(await parts.health()).toMatchObject({ provider: 'magnific', note: null });
  });
  it('SEC2 fix I4: without CLAUDE_CODE_OAUTH_TOKEN health says model calls are refused; with it, or with a scripted Llm, it does not', async () => {
    for (const missing of [undefined, '', '  ']) {
      const h = await build({ CLAUDE_CODE_OAUTH_TOKEN: missing }).health();
      expect(h.note).toBe('CLAUDE_CODE_OAUTH_TOKEN is not set: model calls are refused');
    }
    const both = await build({ VC_PROVIDER: 'magnific', VC_PROVIDER_DAILY_CAP: '100', VC_PROVIDER_JOB_CAP: '60', CLAUDE_CODE_OAUTH_TOKEN: '' }).health();
    expect(both.note).toBe('MAGNIFIC_API_KEY is not set; CLAUDE_CODE_OAUTH_TOKEN is not set: model calls are refused');
    const scripted = join(dir, 'script-health.json');
    writeFileSync(scripted, JSON.stringify({ answers: [] }));
    expect((await build({ CLAUDE_CODE_OAUTH_TOKEN: '', VC_LLM_SCRIPT: scripted }).health()).note).toBeNull();
    expect((await build({}).health()).note).toBeNull();
  });
  it('VC_LLM_SCRIPT picks the scripted Llm', async () => {
    const file = join(dir, 'script.json');
    writeFileSync(file, JSON.stringify({ answers: [{ match: 'hello', answer: { ok: true } }] }));
    const llm = build({ VC_LLM_SCRIPT: file }).produceDeps().llm;
    expect(await llm.run({ prompt: 'say hello', files: [], schema: z.object({ ok: z.boolean() }) })).toEqual({ ok: true });
  });
  it('the fake options are numbers; a non-number is refused naming the variable', () => {
    expect(() => build({ VC_FAKE_FAIL_CLIP: '2', VC_FAKE_DELAY_MS: '150', VC_FAKE_GENERATOR_LOG: join(dir, 'g.log') })).not.toThrow();
    for (const name of ['VC_FAKE_FAIL_CLIP', 'VC_FAKE_DELAY_MS']) expect(() => build({ [name]: 'abc' })).toThrow(name);
  });
  it('health asks the renderer without the timer: the 30 s check leaves no stage=renderer.ready line, while the handlers\' calls still do (K5)', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
    try {
      const parts = build({});
      expect(await parts.health()).toMatchObject({ renderer: 'ready' });
      expect(lines.filter((l) => l.startsWith('stage=renderer.ready'))).toEqual([]);
      await parts.prepareDeps.renderer.ready();
      expect(lines.filter((l) => l.startsWith('stage=renderer.ready'))).toHaveLength(1);
    } finally { spy.mockRestore(); }
  });
  it('the aligner is handed over only once it is ready', async () => {
    const early = build({}, true);
    expect(early.produceDeps().aligner).toBeUndefined();
    await settle();
    expect(early.produceDeps().aligner).toBeDefined();
    const never = build({}, false);
    await settle();
    expect(never.produceDeps().aligner).toBeUndefined();
  });
});

// Money: with the paid provider the caps are not optional. Without them nothing is sent (not even an upload) and the reason can be read.
describe('buildParts: the spending caps of the paid provider', () => {
  const CAPS = { VC_PROVIDER_DAILY_CAP: '100', VC_PROVIDER_JOB_CAP: '60' };
  const KEYED = { VC_PROVIDER: 'magnific', MAGNIFIC_API_KEY: 'k-test' };
  const OWNER = { ...KEYED, VC_OWNER_TEST: '1', VC_BIND_HOST: '127.0.0.1' };
  const image: ImageRequest = { prompt: 'circle', references: [], aspect: '1:1' };
  const refFile = join(dir, 'ref.png');
  const consumedOf = (run: string): number =>
    (db.prepare('SELECT COALESCE(SUM(consumed), 0) AS n FROM provider_budget WHERE run_id = ?').get(run) as { n: number }).n;
  // The Magnific client of the worker speaks through the global fetch: scripted here, so nothing reaches the network and every request is counted.
  let requests: string[] = [];
  beforeEach(() => {
    requests = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
      requests.push(init.method ?? 'GET');
      if (init.method === 'POST') return new Response(JSON.stringify({ data: { task_id: 't1', status: 'COMPLETED', generated: ['https://files.example/a.png'] } }), { status: 200 });
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'content-type': 'image/png' } });
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  const send = (parts: ReturnType<typeof build>, run: string) =>
    parts.produceDeps().generator.image(image, join(dir, 'jobs', run, 'a.png'), () => {}).then(() => null, (e: unknown) => e as { code: string; message: string });

  it('magnific without caps: no request leaves, the refusal names the two variables, health says so', async () => {
    writeFileSync(refFile, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const parts = build(KEYED);
    const error = await parts.produceDeps().generator.image({ ...image, references: [refFile] }, join(dir, 'jobs', 'caps-none', 'a.png'), () => {}).then(() => null, (e: unknown) => e as { code: string; message: string });
    expect(error).toMatchObject({ code: 'not-configured' });
    expect(error?.message).toContain('VC_PROVIDER_DAILY_CAP');
    expect(error?.message).toContain('VC_PROVIDER_JOB_CAP');
    expect(requests).toEqual([]);
    expect((await parts.health()).note).toBe('VC_PROVIDER_DAILY_CAP and VC_PROVIDER_JOB_CAP are not set: paid requests are refused');
  });
  it('magnific without caps: the run stops as a whole with the allowlisted code provider-setup, the row is failed and says why', async () => {
    const { template, fill } = golden('layering-01');
    const work = workspace();
    const run = startRun(work.db, clock, template, inputOf(template, fill, 1));
    const item = planOf(template, fill, run.id, 1, { model: 'seedance-2-mini', resolution: '720p' }).find((planned) => planned.key === 'v1:music')!;
    const parts = buildParts({ VC_DATA_DIR: work.dir, CLAUDE_CODE_OAUTH_TOKEN: 'token-made-up', ...KEYED }, work.db, clock, { renderer: new FakeRenderer({ ready: { ready: true, note: null } }), aligner: aligner(false) });
    const out = await paid({ db: work.db, generator: parts.produceDeps().generator, clock, runId: run.id, claimedBy: 'worker-test', lost: () => {}, approved: getRun(work.db, run.id)!.approved, billed: () => 4 }, item);
    expect(out).toEqual({ ok: false, whole: true, reason: 'engine-error', code: 'provider-setup' });
    expect(operation(work.db, run.id, 'v1:music')).toMatchObject({ state: 'failed', externalId: null, error: expect.stringContaining('VC_PROVIDER_JOB_CAP') });
    expect(requests).toEqual([]);
    expect(existsSync(join(work.dir, 'provider-spend.jsonl'))).toBe(false);          // not even an intent: nothing was about to be paid
  });
  it('magnific with both caps: as before, the request is sent once and counted', async () => {
    const parts = build({ ...KEYED, ...CAPS });
    expect(await send(parts, 'caps-set')).toBeNull();
    expect(requests.filter((method) => method === 'POST')).toHaveLength(1);
    expect(consumedOf('caps-set')).toBe(1);
    expect((await parts.health()).note).toBeNull();
  });
  it('the fake provider without caps: as before, it is ready, says nothing in health and keeps no budget', async () => {
    const parts = build({});
    expect(await parts.health()).toMatchObject({ provider: 'fake', note: null });
    expect(await parts.produceDeps().generator.ready()).toMatchObject({ ready: true });
    await parts.produceDeps().generator.image(image, join(dir, 'jobs', 'caps-fake', 'a.png'), () => {});
    expect(requests).toEqual([]);
    expect(consumedOf('caps-fake')).toBe(0);
  });
  it('the owner test: as before, it does not start without both caps and spends under them with both', async () => {
    expect(() => build(OWNER)).toThrow('provider-cap-required');
    expect(() => build({ ...OWNER, VC_PROVIDER_DAILY_CAP: '100' })).toThrow('provider-cap-required');
    const parts = build({ ...OWNER, ...CAPS });
    expect(await send(parts, 'caps-owner')).toBeNull();
    expect(requests.filter((method) => method === 'POST')).toHaveLength(1);
    expect(consumedOf('caps-owner')).toBe(1);
  });
  it.each([
    [{ VC_PROVIDER_JOB_CAP: '60' }], [{ VC_PROVIDER_DAILY_CAP: '100' }],
    [{ VC_PROVIDER_DAILY_CAP: '0', VC_PROVIDER_JOB_CAP: '60' }], [{ VC_PROVIDER_DAILY_CAP: '100', VC_PROVIDER_JOB_CAP: '-5' }],
    [{ VC_PROVIDER_DAILY_CAP: 'abc', VC_PROVIDER_JOB_CAP: '60' }],
  ])('one cap or an invalid value %j does not start: owner test and closed magnific alike', (caps) => {
    expect(() => build({ ...OWNER, ...caps })).toThrow('provider-cap-required');
    expect(() => build({ ...KEYED, ...caps })).toThrow('provider-cap-required');
  });
});

// Several videos at once: what they share on this machine and at the provider goes through gates the worker builds once.
describe('buildParts: the gates of several runs at once', () => {
  const FACTS: MediaFacts = { width: 720, height: 1280, fps: 30, frames: 30, seconds: 1, audio: true };
  /** Calls that stay at work until they are let go: how many are at work now, and the most there were. */
  function held() {
    const going: (() => void)[] = [];
    const state = { now: 0, most: 0, started: 0 };
    const work = async (): Promise<void> => {
      state.now += 1; state.started += 1; state.most = Math.max(state.most, state.now);
      await new Promise<void>((go) => { going.push(go); });
      state.now -= 1;
    };
    /** Lets go, one after the other, until nothing is at work and nothing more starts. */
    const finishAll = async (): Promise<void> => { for (let quiet = 0; quiet < 5;) { const go = going.shift(); if (go) { go(); quiet = 0; } else quiet += 1; await settle(); } };
    return { state, work, finishAll };
  }
  const renderings = () => { const h = held(); const renderer: Renderer = { check: async () => ({ ok: true, issues: [] }), render: async () => { await h.work(); return FACTS; }, ready: async () => ({ ready: true, note: null }) }; return { ...h, renderer }; };
  const withParts = (env: Env, overrides: Overrides = {}, database: DatabaseSync = db) =>
    buildParts({ VC_DATA_DIR: dir, CLAUDE_CODE_OAUTH_TOKEN: 'token-made-up', ...env }, database, clock, { renderer: new FakeRenderer({ ready: { ready: true, note: null } }), aligner: aligner(false), ...overrides });
  const errorLines = async (work: () => Promise<void>): Promise<string[]> => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
    try { await work(); } finally { spy.mockRestore(); }
    return lines;
  };
  const aWhile = () => new Promise((r) => setTimeout(r, 5));

  describe('paid requests (VC_GATE_PROVIDER)', () => {
    const through = async (env: Env) => {
      const parts = withParts(env);
      const h = held();
      const one = parts.produceDeps().paidGate!, other = parts.produceDeps().paidGate!;     // two runs: each handler is built from its own snapshot
      const all = [one, other, one, other, one, other, one, other].map((gate) => gate(h.work));
      await settle();
      const atOnce = h.state.now;
      await h.finishAll(); await Promise.all(all);
      return { atOnce, most: h.state.most, started: h.state.started };
    };
    it('without the setting: every run is handed the one gate, 3 requests at once over all of them, as one run alone sends today', async () => {
      expect(await through({})).toEqual({ atOnce: 3, most: 3, started: 8 });
    });
    it('the setting is the number at once: 1, 6, and 12 at the most', async () => {
      expect(await through({ VC_GATE_PROVIDER: '1' })).toEqual({ atOnce: 1, most: 1, started: 8 });
      expect(await through({ VC_GATE_PROVIDER: '6' })).toEqual({ atOnce: 6, most: 6, started: 8 });
      expect(await through({ VC_GATE_PROVIDER: '12' })).toEqual({ atOnce: 8, most: 8, started: 8 });
    });
    it.each(['0', '13', '-1', '2.5', 'abc', ' 3'])('%j does not start the worker, and the refusal names the variable', (raw) => {
      expect(() => withParts({ VC_GATE_PROVIDER: raw })).toThrow(`VC_GATE_PROVIDER must be a whole number from 1 to 12, got "${raw}"`);
    });
    it('a request that waited says so in the log, only its wait: stage=gate.provider wait_ms', async () => {
      const lines = await errorLines(async () => {
        const gate = withParts({ VC_GATE_PROVIDER: '1' }).produceDeps().paidGate!;
        const h = held();
        const both = [gate(h.work), gate(h.work)];
        await aWhile();
        await h.finishAll(); await Promise.all(both);
      });
      expect(lines.filter((line) => line.startsWith('stage=gate.'))).toEqual([expect.stringMatching(/^stage=gate\.provider wait_ms=\d+$/)]);
    });
  });

  describe('renders (VC_GATE_RENDER)', () => {
    const through = async (env: Env) => {
      const r = renderings();
      const parts = withParts(env, { renderer: r.renderer });
      const all = [1, 2, 3].map((n) => parts.produceDeps().renderer.render(`jobs/r${n}/v1`, `jobs/r${n}/v1/out.mp4`, () => {}));
      await settle();
      const atOnce = r.state.now;
      const check = await parts.produceDeps().renderer.check('jobs/r9/v1');                // a check has its own gate: a render at work is not in its way
      await r.finishAll();
      return { atOnce, most: r.state.most, answers: await Promise.all(all), check };
    };
    it('without the setting one render at a time over all runs; the others wait their turn and all are made', async () => {
      expect(await through({})).toEqual({ atOnce: 1, most: 1, answers: [FACTS, FACTS, FACTS], check: { ok: true, issues: [] } });
    });
    it('the setting is the number at once', async () => {
      expect(await through({ VC_GATE_RENDER: '2' })).toMatchObject({ atOnce: 2, most: 2 });
      expect(await through({ VC_GATE_RENDER: '4' })).toMatchObject({ atOnce: 3, most: 3 });
    });
    it.each(['0', '5', '-1', '1.5', 'abc'])('%j does not start the worker, and the refusal names the variable', (raw) => {
      expect(() => withParts({ VC_GATE_RENDER: raw })).toThrow(`VC_GATE_RENDER must be a whole number from 1 to 4, got "${raw}"`);
    });
    it('a render that waited says so in the log, and its own time is the work without the wait', async () => {
      const lines = await errorLines(async () => {
        const r = renderings();
        const parts = withParts({}, { renderer: r.renderer });
        const both = [1, 2].map((n) => parts.produceDeps().renderer.render(`jobs/w${n}/v1`, `jobs/w${n}/v1/out.mp4`, () => {}));
        await aWhile();
        await r.finishAll(); await Promise.all(both);
      });
      expect(lines.filter((line) => line.startsWith('stage=gate.'))).toEqual([expect.stringMatching(/^stage=gate\.renderer\.render wait_ms=\d+$/)]);
      expect(lines.filter((line) => line.startsWith('stage=renderer.render ms='))).toHaveLength(2);
    });
    it('a run that waits for its render keeps its beat for minutes and is not there for another worker to take; it renders when its turn comes', async () => {
      const r = renderings();
      const own = openDb(join(mkdtempSync(join(tmpdir(), 'vc-parts-beat-')), 'db.sqlite'));
      const time = new FakeClock('2026-10-04T10:00:00.000Z');
      const parts = buildParts({ VC_DATA_DIR: dir, CLAUDE_CODE_OAUTH_TOKEN: 'token-made-up' }, own, time, { renderer: r.renderer, aligner: aligner(false) });
      const { template, fill } = golden('layering-01');
      const id = enqueue(own, inputOf(template, fill, 1), 'job-render-wait', null, time.now());
      const other = parts.produceDeps().renderer.render('jobs/other/v1', 'jobs/other/v1/out.mp4', () => {});   // another run is rendering
      await settle();
      const idle = async () => {};
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const worker = runWorker({ db: own, clock: time, workerId: 'worker-loop', idleMs: 5, health: parts.health, handlers: { scan: idle, prepare: idle, edit: idle,
        produce: async (run) => { await parts.produceDeps().renderer.render(`jobs/${run.id}/v1`, `jobs/${run.id}/v1/out.mp4`, () => {}); finish(own, run.id, { kind: 'produce', variants: [] }, time.now()); } } });
      try {
        for (let i = 0; i < 200 && getRun(own, id)!.state !== 'running'; i += 1) await settle();
        for (let beat = 0; beat < 20; beat += 1) { time.advance(15_000); await vi.advanceTimersByTimeAsync(15_000); }   // five minutes
        expect(getRun(own, id)).toMatchObject({ state: 'running', claimedBy: 'worker-loop', takeovers: 0, heartbeat: time.now().toISOString() });
        expect(claim(own, 'worker-other', time.now())).toBeNull();
        expect(r.state).toMatchObject({ started: 1, now: 1 });                              // only the other run's render is at work
        await r.finishAll(); await other;
        for (let i = 0; i < 200 && getRun(own, id)!.state === 'running'; i += 1) await settle();
      } finally { await r.finishAll(); await worker.stop(); vi.useRealTimers(); }
      expect(getRun(own, id)).toMatchObject({ state: 'done', takeovers: 0 });
      expect(r.state.started).toBe(2);
    });
  });

  describe('the aligner stands at the gate of the speech recognition (VC_GATE_TRANSCRIBE)', () => {
    const ears = () => {
      const h = held();
      const transcriber: Transcriber = { words: async () => { await h.work(); return []; } };
      const ready: Aligner = { align: async () => { await h.work(); return []; }, ready: async () => ({ ready: true, note: null }) };
      return { ...h, transcriber, aligner: ready };
    };
    const through = async (env: Env) => {
      const e = ears();
      const parts = withParts(env, { transcriber: e.transcriber, aligner: e.aligner });
      await settle();
      const deps = parts.produceDeps();
      const all = [deps.transcriber.words('a.mp4', 'en'), deps.aligner!.align('a.mp4', ['hi'], 'en'), deps.aligner!.align('b.mp4', ['hi'], 'en'), parts.prepareDeps.transcriber.words('c.mp4', 'en')];
      await settle();
      const atOnce = e.state.now;
      await e.finishAll(); await Promise.all(all);
      return { atOnce, most: e.state.most, started: e.state.started };
    };
    it('with a gate of 1 an alignment and a recognition are never at work together, whichever run asked', async () => {
      expect(await through({ VC_GATE_TRANSCRIBE: '1' })).toEqual({ atOnce: 1, most: 1, started: 4 });
    });
    it('with a gate of 2 two of them work at once, an alignment among them', async () => {
      expect(await through({ VC_GATE_TRANSCRIBE: '2' })).toEqual({ atOnce: 2, most: 2, started: 4 });
    });
    it('an alignment that waited says so in the log: stage=gate.aligner.align wait_ms', async () => {
      const lines = await errorLines(async () => {
        const e = ears();
        const parts = withParts({ VC_GATE_TRANSCRIBE: '1' }, { transcriber: e.transcriber, aligner: e.aligner });
        await settle();
        const both = [parts.produceDeps().transcriber.words('a.mp4', 'en'), parts.produceDeps().aligner!.align('a.mp4', ['hi'], 'en')];
        await aWhile();
        await e.finishAll(); await Promise.all(both);
      });
      expect(lines.filter((line) => line.startsWith('stage=gate.'))).toEqual([expect.stringMatching(/^stage=gate\.aligner\.align wait_ms=\d+$/)]);
    });
    it('asking whether the aligner is there does not wait at the gate', async () => {
      const e = ears();
      const parts = withParts({ VC_GATE_TRANSCRIBE: '1' }, { transcriber: e.transcriber, aligner: e.aligner });
      await settle();
      const busy = parts.produceDeps().transcriber.words('a.mp4', 'en');
      await settle();
      expect(await parts.produceDeps().aligner!.ready()).toEqual({ ready: true, note: null });
      await e.finishAll(); await busy;
    });
  });
});
