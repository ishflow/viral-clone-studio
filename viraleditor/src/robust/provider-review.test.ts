// T2-2 review: the money paths of the budget. Each case is a way the count of what was really spent could come out short.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createMagnific } from '../adapters/magnific.ts';
import type { RunInput } from '../contracts.ts';
import { openDb } from '../db/open.ts';
import { beginOperation, endOperation, enqueue } from '../db/runs.ts';
import type { ImageRequest } from '../ports.ts';
import { budgetSchema, consumeProvider, refundProvider, reserveProvider } from './provider-budget.ts';
import { settleUnknown } from './settle-unknown.ts';

const DAY1 = new Date('2026-10-06T23:59:30Z');
const DAY2 = new Date('2026-10-07T00:00:30Z');
const caps = { daily: 1000, job: 600 };
const input: RunInput = { kind: 'produce', templateId: 't', quality: 'fast', variants: 1, language: 'en', products: [], sample: false };
const consumedOn = (db: DatabaseSync, run: string, day: string): number =>
  (db.prepare('SELECT COALESCE(SUM(consumed), 0) AS n FROM provider_budget WHERE run_id = ? AND day = ?').get(run, day) as { n: number }).n;

describe('review: a refund takes back exactly the request that was refused', () => {
  it('a POST that was sent on one UTC day and refused on the next gives back the first day, not the units another request consumed on the second', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-review-'));
    const db = openDb(join(dir, 'db.sqlite')); budgetSchema(db);
    let now = DAY1;
    const image: ImageRequest = { prompt: 'circle', references: [], aspect: '1:1' };
    // the refused POST was charged on day 1; while it was on the wire (an upload may take minutes) the clock passed midnight
    const fetcher = (async (_url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'POST') {
        now = DAY2;
        consumeProvider(db, caps, 'job', 4, now);                            // another request of the same job, charged on day 2 (its POST is still to come)
        return new Response(JSON.stringify({ message: 'no credits' }), { status: 402 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const generator = createMagnific({
      apiKey: 'test-key-made-up', spendDir: dir, fetch: fetcher, sleep: async () => {},
      beforePaid: (runId, units) => { const at = now; consumeProvider(db, caps, runId, units, at); return at; },
      afterRefused: (runId, units, at) => refundProvider(db, caps, runId, units, at ?? now),
    });
    await expect(generator.image(image, join(dir, 'jobs', 'job', 'a.png'), () => {})).rejects.toMatchObject({ code: 'rejected' });
    expect(consumedOn(db, 'job', '2026-10-06')).toBe(0);                     // the refused request is given back where it was charged
    expect(consumedOn(db, 'job', '2026-10-07')).toBe(4);                     // and what the other request consumed is still counted
  });
});

describe('review: settleUnknown gives each request back once', () => {
  it('a key named twice is refunded once', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'vc-review-')), 'db.sqlite')); budgetSchema(db);
    const id = enqueue(db, input, 'job-1', null, DAY1);
    db.prepare("UPDATE runs SET state = 'stopped', reason = 'submission-unknown' WHERE id = ?").run(id);
    reserveProvider(db, caps, 'job-1', 20, DAY1);
    for (const key of ['v1:image:s1', 'v1:image:s2']) {
      beginOperation(db, id, key, 'image', DAY1);
      endOperation(db, id, key, { state: 'unknown', error: 'no answer [units:1]' }, DAY1);
      consumeProvider(db, caps, 'job-1', 1, DAY1);
    }
    const done = settleUnknown(db, (key, units, at) => refundProvider(db, caps, key, units, at), { runId: id, by: 'a', at: DAY2, keys: ['v1:image:s1', 'v1:image:s1'] });
    expect(done.refunded).toBe(1);
    expect(consumedOn(db, 'job-1', '2026-10-06')).toBe(1);                   // s2 was never settled: it is still counted
  });
});
