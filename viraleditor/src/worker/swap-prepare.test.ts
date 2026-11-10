// The worker's wiring of the preparation of a person-swap template: which handler a prepare run goes to.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock, FakeLlm, FakeRenderer } from '../adapters/fakes.ts';
import type { RunInput } from '../contracts.ts';
import { openDb } from '../db/open.ts';
import { claim, enqueue, getRun } from '../db/runs.ts';
import * as templates from '../db/templates.ts';
import { realHandlers } from './main.ts';
import { buildParts } from './parts.ts';

const clock = new FakeClock('2026-10-07T10:00:00.000Z');
const ID = 'swap-new';
type Prepare = Extract<RunInput, { kind: 'prepare' }>;

/** A worker on a data dir of its own, with a model that is never asked and nothing that starts a process when it is built. */
function build() {
  const dir = mkdtempSync(join(tmpdir(), 'vc-swap-prepare-'));
  vi.stubEnv('VC_DATA_DIR', dir);
  const db = openDb(join(dir, 'db.sqlite'));
  const parts = buildParts({ VC_DATA_DIR: dir, CLAUDE_CODE_OAUTH_TOKEN: 'token-made-up' }, db, clock, { renderer: new FakeRenderer({ ready: { ready: true, note: null } }), aligner: { align: async () => [], ready: async () => ({ ready: false, note: null }) } });
  return { db, handlers: realHandlers({ ...parts, prepareDeps: { ...parts.prepareDeps, llm: new FakeLlm([]) } }) };
}
/** The row the site writes with a prepare run, and the run, claimed. */
function begin(db: ReturnType<typeof openDb>, input: Prepare) {
  templates.upsert(db, {
    id: ID, state: 'preparing', owner: null, sourceKind: 'upload', sourceUrl: null, note: null, estimate: null, minutes: null,
    card: { title: 'dance.mp4', category: '', format: 'no-talking', seconds: 0, referenceViews: '', image: null, video: null, products: 0, shots: [], description: '', tags: [] },
  }, clock.now());
  enqueue(db, input, ID, null, clock.now());
  return claim(db, 'worker-test', clock.now())!;
}
afterEach(() => { vi.unstubAllEnvs(); });

describe('realHandlers: a prepare run', () => {
  // a candidate that is not there: the product preparation finds no source, the person-swap preparation takes no candidate at all
  it.each([['swap', 'unsupported'], [undefined, 'source-unavailable']] as const)('that says mode %s is prepared by the handler that ends a missing candidate as %s', async (mode, note) => {
    const { db, handlers } = build();
    const run = begin(db, { kind: 'prepare', templateId: ID, ownerId: null, ...(mode ? { mode } : {}), from: { kind: 'candidate', candidateId: 'none', force: true } });
    await handlers.prepare(run);
    expect(getRun(db, run.id)!.result).toEqual({ kind: 'prepare', state: 'failed', note });
  });
});
