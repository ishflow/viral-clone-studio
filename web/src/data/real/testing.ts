import type * as ChildProcess from 'node:child_process';
import type * as Fs from 'node:fs';
import type * as Os from 'node:os';
import type * as Path from 'node:path';
import type * as Sqlite from 'node:sqlite';
import type { DatabaseSync } from 'node:sqlite';
import type { JobRecord } from '../mock/store';
import type { GenerateInput, Paid } from '../ports';
import type { Card, TemplateRow } from './rows';

// Test helpers of the real engine: a temp data directory whose database is built from the worker's own `schema.sql`.
// (Node modules through `getBuiltinModule`: browser-safe.test.ts holds every non-test file of the data layer to that.)

const fs = (): typeof Fs => process.getBuiltinModule('node:fs');
const os = (): typeof Os => process.getBuiltinModule('node:os');
const path = (): typeof Path => process.getBuiltinModule('node:path');
const child = (): typeof ChildProcess => process.getBuiltinModule('node:child_process');

/** The repo's `viraleditor/` folder (this file is web/src/data/real/testing.ts). */
export const VIRALEDITOR = path().resolve(__dirname, '../../../../viraleditor');

/** A temp data directory with `db.sqlite` made from `viraleditor/schema.sql`, as the worker makes it. */
export function makeDataDir(): { dir: string; db: DatabaseSync } {
  const dir = fs().mkdtempSync(path().join(os().tmpdir(), 'vc-site-engine-'));
  const db = new (process.getBuiltinModule('node:sqlite') as typeof Sqlite).DatabaseSync(path().join(dir, 'db.sqlite'));
  db.exec(fs().readFileSync(path().join(VIRALEDITOR, 'schema.sql'), 'utf8'));
  return { dir, db };
}

export const PAID: Paid = { images: 5, clips: 5, clipSeconds: 20, music: 1, voice: 0 };

export function card(over: Partial<Card> = {}): Card {
  return {
    title: 'Layering recipe', category: 'Fragrance', format: 'no-talking', seconds: 8, referenceViews: '1.2M',
    image: 'templates/t1/poster.jpg', video: 'templates/t1/sample.mp4', products: 1,
    shots: [{ n: 1, from: 0, to: 2, action: 'Hands enter', text: 'hook', product: 1 }], description: 'Two sentences.', tags: ['oil'], ...over,
  };
}

/** Writes a template row, as the worker does. `card` may be raw text, to write a broken one. */
export function putTemplate(db: DatabaseSync, over: Partial<Omit<TemplateRow, 'card'>> & { card?: Card | string } = {}): string {
  const row = { id: 't1', state: 'ready', owner: null, sourceKind: 'seed', estimate: PAID, minutes: 7, timesGenerated: 0, note: null, ...over };
  const text = typeof row.card === 'string' ? row.card : JSON.stringify(row.card ?? card());
  db.prepare(
    `INSERT INTO templates (id, state, owner, source_kind, source_url, note, card, estimate, minutes, times_generated, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:00.000Z')`,
  ).run(row.id, row.state, row.owner, row.sourceKind, row.note, text, row.estimate ? JSON.stringify(row.estimate) : null, row.minutes, row.timesGenerated);
  return row.id;
}

/** A job record as the site's runner makes it, not yet handed to the engine. */
export function jobRecord(over: Partial<JobRecord> = {}, input: Partial<GenerateInput> = {}): JobRecord {
  return {
    id: crypto.randomUUID(), userId: 'u-1', templateId: 't1', templateTitle: 'Layering recipe',
    input: { templateId: 't1', products: [], quality: 'fast', variants: 1, language: 'en', ...input },
    credits: 2, status: 'running', steps: [], stoppedReason: null, startedAt: '2026-10-04T12:00:00.000Z', finishedAt: null, variants: [],
    resumedAt: null, pinnedElapsed: null, refundEntryId: null, clockFrom: null, variantRuns: {}, approved: null, chargeEntryId: null,
    sample: false, freeVideo: false, returnedCredits: 0, stoppedAt: null, closedAt: null, closedReason: null, deletedAt: null, ...over,
  };
}

/** Runs an ES module script with the worker's own code (cwd `viraleditor/`) and returns what it prints as JSON. */
export function viraleditorJson<T>(script: string): T {
  const out = child().execFileSync('node', ['--input-type=module', '-e', script], { cwd: VIRALEDITOR, timeout: 60_000, encoding: 'utf8' });
  return JSON.parse(out) as T;
}
