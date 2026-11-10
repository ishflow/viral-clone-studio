// The worker's wiring of the edit of a person-swap template: which handler an edit run goes to.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock, FakeRenderer } from '../adapters/fakes.ts';
import type { CardSwap, RunInput, SwapSlot } from '../contracts.ts';
import { openDb } from '../db/open.ts';
import { claim, enqueue, getRun } from '../db/runs.ts';
import * as templates from '../db/templates.ts';
import { realHandlers } from './main.ts';
import { buildParts } from './parts.ts';

const clock = new FakeClock('2026-10-07T10:00:00.000Z');
type Edit = Extract<RunInput, { kind: 'edit' }>;
const CARD: Edit['card'] = { title: 'A dance', category: '', products: 0, shots: [], description: '', tags: [] };
const STORED: CardSwap = { people: 1, persons: [{ slot: 1, box: { left: 0, top: 0, right: 100, bottom: 100 }, hint: 'the person in the video' }], parts: [{ n: 1, from: 0, to: 6 }], sound: false };
const WOMAN: SwapSlot = { slot: 1, box: { left: 10, top: 20, right: 70, bottom: 95 }, hint: 'the woman in the green shirt' };

/** A worker on a data dir of its own, a template folder with `file` in it, and the template's row. */
function build(id: string, file: string, content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'vc-swap-edit-'));
  vi.stubEnv('VC_DATA_DIR', dir);
  const db = openDb(join(dir, 'db.sqlite'));
  const parts = buildParts({ VC_DATA_DIR: dir, CLAUDE_CODE_OAUTH_TOKEN: 'token-made-up' }, db, clock, { renderer: new FakeRenderer({ ready: { ready: true, note: null } }), aligner: { align: async () => [], ready: async () => ({ ready: false, note: null }) } });
  const at = join(dir, 'templates', id, file);
  mkdirSync(join(dir, 'templates', id), { recursive: true });
  writeFileSync(at, content);
  templates.upsert(db, {
    id, state: 'ready', owner: null, sourceKind: 'link', sourceUrl: null, note: null, estimate: null, minutes: null,
    card: { ...CARD, format: 'no-talking', seconds: 6, referenceViews: '', image: null, video: null },
  }, clock.now());
  const edit = async (input: Edit) => {
    const id = enqueue(db, input, input.templateId, null, clock.now());
    await realHandlers(parts).edit(claim(db, 'worker-test', clock.now())!);
    return getRun(db, id)!.result;
  };
  return { edit, read: () => readFileSync(at, 'utf8') };
}
afterEach(() => { vi.unstubAllEnvs(); });

describe('realHandlers: an edit run', () => {
  it('that carries the people of a person swap is taken by the person-swap edit: swap.json has them', async () => {
    const { edit, read } = build('swap-1', 'swap.json', JSON.stringify(STORED));
    expect(await edit({ kind: 'edit', templateId: 'swap-1', card: CARD, swap: { persons: [WOMAN] } })).toEqual({ kind: 'edit', ok: true, note: null });
    expect(JSON.parse(read())).toEqual({ ...STORED, persons: [WOMAN] });
  });

  it('without them is the edit of a product template as before: it finds no template.json in a person-swap template and writes nothing', async () => {
    const { edit, read } = build('swap-1', 'swap.json', JSON.stringify(STORED));
    expect(await edit({ kind: 'edit', templateId: 'swap-1', card: { ...CARD, title: 'Another title' } })).toEqual({ kind: 'edit', ok: false, note: 'template-missing' });
    expect(read()).toBe(JSON.stringify(STORED));
  });

  it('that carries people for a product template changes nothing of it: a product template is no person-swap template', async () => {
    const { edit, read } = build('product-1', 'template.json', '{"title":"a product template"}');
    expect(await edit({ kind: 'edit', templateId: 'product-1', card: { ...CARD, title: 'Another title' }, swap: { persons: [WOMAN] } })).toEqual({ kind: 'edit', ok: false, note: 'template-missing' });
    expect(read()).toBe('{"title":"a product template"}');
  });
});
