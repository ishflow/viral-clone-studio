import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db/open.ts';
import { enqueue } from '../db/runs.ts';
import { budgetSchema, consumeProvider, reserveProvider } from '../robust/provider-budget.ts';
import { startBudgetSweep } from './budget-sweep.ts';

beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); });
afterEach(() => { vi.useRealTimers(); });

it('a job the site closed gives back its unused reservation at the next tick, and what it consumed stays', () => {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'vc-sweep-')), 'db.sqlite')); budgetSchema(db);
  const day = new Date('2026-10-05T20:00:00Z'), caps = { daily: 100, job: 60 };
  const id = enqueue(db, { kind: 'produce', templateId: 't', quality: 'fast', variants: 1, language: 'en', products: [], sample: false }, 'job-1', null, day);
  reserveProvider(db, caps, 'job-1', 43, day); consumeProvider(db, caps, 'job-1', 10, day);
  const held = () => db.prepare('SELECT reserved, consumed FROM provider_budget').get();
  const sweep = startBudgetSweep({ db, everyMs: 30_000 });
  expect(held()).toEqual({ reserved: 43, consumed: 10 });                       // stopped: it may be resumed
  db.prepare("UPDATE runs SET state = 'stopped' WHERE id = ?").run(id);
  vi.advanceTimersByTime(30_000);
  expect(held()).toEqual({ reserved: 43, consumed: 10 });
  db.prepare("UPDATE runs SET state = 'closed' WHERE id = ?").run(id);          // what the site's close does
  vi.advanceTimersByTime(30_000);
  expect(held()).toEqual({ reserved: 10, consumed: 10 });
  sweep.stop(); db.close();
});
