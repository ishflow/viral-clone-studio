// R2: a request the provider refused for good (HTTP 4xx, no task made, nothing paid) gives its units back to `consumed`;
// anything that may have cost money (5xx, no answer, a task-less answer, an accepted task) stays counted.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createMagnific } from '../adapters/magnific.ts';
import type { GeneratorError, ImageRequest } from '../ports.ts';
import { budgetSchema, consumeProvider, refundProvider, reserveProvider } from './provider-budget.ts';

const DAY = new Date('2026-10-06T10:00:00Z');
const caps = { daily: 100, job: 60 };
const consumedOf = (db: DatabaseSync, run: string): number =>
  (db.prepare('SELECT COALESCE(SUM(consumed), 0) AS n FROM provider_budget WHERE run_id = ?').get(run) as { n: number }).n;

describe('refundProvider', () => {
  it('takes the units back from consumed and leaves the reservation alone', () => {
    const db = new DatabaseSync(':memory:'); budgetSchema(db);
    reserveProvider(db, caps, 'job', 43, DAY); consumeProvider(db, caps, 'job', 5, DAY);
    refundProvider(db, caps, 'job', 5, DAY);
    expect(db.prepare('SELECT reserved, consumed FROM provider_budget WHERE run_id = ?').get('job')).toEqual({ reserved: 43, consumed: 0 });
  });
  it('never takes more than was consumed: a real spend is not under-counted', () => {
    const db = new DatabaseSync(':memory:'); budgetSchema(db);
    reserveProvider(db, caps, 'job', 43, DAY); consumeProvider(db, caps, 'job', 3, DAY);
    refundProvider(db, caps, 'job', 5, DAY);
    expect(consumedOf(db, 'job')).toBe(0);
    refundProvider(db, caps, 'nobody', 5, DAY);                         // no row at all: nothing happens, no throw
    expect(db.prepare('SELECT COUNT(*) AS n FROM provider_budget WHERE run_id = ?').get('nobody')).toEqual({ n: 0 });
  });
  it('does nothing without caps (no budget configured)', () => {
    const db = new DatabaseSync(':memory:'); budgetSchema(db);
    expect(() => refundProvider(db, null, 'job', 5, DAY)).not.toThrow();
  });
});

const KEY = 'test-key-made-up';
const image: ImageRequest = { prompt: 'circle', references: [], aspect: '1:1' };

type Answer = Response | Error;
/** A Magnific client on a scripted POST answer, wired to a real budget database the way worker/parts.ts wires it. */
function stage(answer: () => Answer) {
  const dir = mkdtempSync(join(tmpdir(), 'vc-refund-'));
  const db = new DatabaseSync(join(dir, 'db.sqlite')); budgetSchema(db);
  let posts = 0;
  const fetcher = (async (_url: string, init: RequestInit = {}) => {
    if ((init.method ?? 'GET') === 'POST') { posts += 1; const a = answer(); if (a instanceof Error) throw a; return a; }
    return new Response(JSON.stringify({ data: { task_id: 't', status: 'IN_PROGRESS', generated: [] } }), { status: 200 });
  }) as unknown as typeof fetch;
  const generator = createMagnific({
    apiKey: KEY, spendDir: dir, fetch: fetcher, pollMs: 1, taskTimeoutMs: 5, requestTimeoutMs: 1000, sleep: async () => {},
    beforePaid: (runId, units) => consumeProvider(db, caps, runId, units, DAY),
    afterRefused: (runId, units) => refundProvider(db, caps, runId, units, DAY),
  });
  const send = (run: string) => generator.image(image, join(dir, 'jobs', run, 'a.png'), () => {});
  const spend = () => readFileSync(join(dir, 'provider-spend.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { event: string });
  return { db, send, generator, dir, spend, posts: () => posts };
}
const status = (code: number): Answer => new Response(JSON.stringify({ message: 'no' }), { status: code });
const settle = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as GeneratorError);

describe('the Magnific client and the budget', () => {
  it.each([400, 402, 403, 404, 422, 429])('HTTP %i: consumed does not change, the spend log still says rejected', async (code) => {
    const s = stage(() => status(code));
    const before = consumedOf(s.db, 'job-a');
    const error = await settle(s.send('job-a'));
    expect(error?.code).toBe('rejected');
    expect(consumedOf(s.db, 'job-a')).toBe(before);
    expect(s.spend().map((e) => e.event)).toEqual(['intent', 'rejected']);
  });
  it.each([
    ['500', () => status(500)], ['502', () => status(502)], ['503', () => status(503)], ['504', () => status(504)],
    ['408', () => status(408)], ['no answer', () => new TypeError('fetch failed')],
    ['200 without a task', () => new Response('{}', { status: 200 })],
  ] as [string, () => Answer][])('%s: still counted, the run may have been charged', async (_name, answer) => {
    const s = stage(answer);
    const error = await settle(s.send('job-b'));
    expect(error?.code).toBe('submission-unknown');
    expect(consumedOf(s.db, 'job-b')).toBe(1);
  });
  it('an accepted task stays counted', async () => {
    const s = stage(() => new Response(JSON.stringify({ data: { task_id: 't', status: 'CREATED' } }), { status: 200 }));
    await settle(s.send('job-c'));
    expect(consumedOf(s.db, 'job-c')).toBe(1);
  });
  it('many refusals in a row never fill the job cap or the day: the refused tries cost nothing', async () => {
    const s = stage(() => status(402));
    for (let i = 0; i < 100; i += 1) await settle(s.send('job-d'));
    expect(s.posts()).toBe(100);
    expect(consumedOf(s.db, 'job-d')).toBe(0);
    // the job still has its whole cap: a request after the top-up is not stopped by `provider-cap`
    expect(() => consumeProvider(s.db, caps, 'job-d', 43, DAY)).not.toThrow();
  });
  it('a real spend between refusals is counted exactly', async () => {
    let n = 0;
    const s = stage(() => (n++ % 2 === 0 ? status(402) : new Response(JSON.stringify({ data: { task_id: 't', status: 'CREATED' } }), { status: 200 })));
    for (let i = 0; i < 10; i += 1) await settle(s.send('job-e'));
    expect(consumedOf(s.db, 'job-e')).toBe(5);
  });
  it('a refusal by our own cap is not refunded (no POST was made, nothing was consumed)', async () => {
    const s = stage(() => status(402));
    consumeProvider(s.db, caps, 'job-f', 60, DAY);
    const error = await settle(s.send('job-f'));
    expect(error?.message).toBe('provider-cap');
    expect(s.posts()).toBe(0);
    expect(consumedOf(s.db, 'job-f')).toBe(60);
  });
});
