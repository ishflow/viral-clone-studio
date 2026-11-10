import { it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { golden, world } from './testing.ts';
import { prepareHandler } from './index.ts';
import { asOwner, getRun, release } from '../db/runs.ts';
import * as templates from '../db/templates.ts';
it.each(['new-owner', null])('stale prepare cannot write after takeover or SIGTERM hand-back (%s)', async nextOwner => {
  const w = world();
  try {
    const url = 'https://www.youtube.com/watch?v=offline';
    templates.upsert(w.db, { id: 'probe', state: 'preparing', owner: 'u', sourceKind: 'link', sourceUrl: url, note: null,
      card: { title: url, category: '', format: 'no-talking', seconds: 0, referenceViews: '', image: null, video: null, products: 1, shots: [], description: '', tags: [] }, estimate: null, minutes: null }, w.clock.now());
    const run = w.run({ kind: 'prepare', templateId: 'probe', ownerId: 'u', from: { kind: 'link', url } });
    const handler = prepareHandler({ ...w, downloader: { video: async () => {
      if (nextOwner === null) release(w.db, run.id, run.claimedBy!, w.clock.now());
      else w.db.prepare('UPDATE runs SET claimed_by = ? WHERE id = ?').run(nextOwner, run.id);
      throw new Error('old downloader failed after takeover');
    } } });
    await asOwner({ runId: run.id, workerId: run.claimedBy!, refused: null }, () => handler(run));
    expect(getRun(w.db, run.id)).toMatchObject({ state: 'running', claimedBy: nextOwner });
    expect(templates.get(w.db, 'probe')?.state).toBe('preparing');
  } finally { w.db.close(); }
});

it.each(['new-owner', null])('late successful download cannot publish shared files after ownership loss (%s)', async nextOwner => {
  const w = world();
  try {
    const candidate = w.candidate();
    const run = w.run({ kind: 'prepare', templateId: 'late', ownerId: null, from: { kind: 'candidate', candidateId: candidate.id, force: false } });
    const before = w.db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidate.id);
    await prepareHandler({ ...w, downloader: { video: async (url, dir) => {
      const result = await w.downloader.video(url, dir);
      if (nextOwner === null) release(w.db, run.id, run.claimedBy!, w.clock.now());
      else w.db.prepare('UPDATE runs SET claimed_by = ? WHERE id = ?').run(nextOwner, run.id);
      return result;
    } } })(run);
    expect(getRun(w.db, run.id)).toMatchObject({ state: 'running', claimedBy: nextOwner });
    expect(templates.get(w.db, 'late')).toBeNull();
    expect(w.db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidate.id)).toEqual(before);
    expect(w.db.prepare('SELECT * FROM usage').all()).toEqual([]);
    expect(existsSync(join(w.dataDir, 'sources', candidate.id, 'meta.json'))).toBe(false);
    expect(existsSync(join(w.dataDir, 'sources', candidate.id, 'source.mp4'))).toBe(false);
  } finally { w.db.close(); }
});

it.each(['new-owner', null])('late successful renderer cannot publish ready state after ownership loss (%s)', async nextOwner => {
  const w = world({ llm: [{ score: 82, notes: [], unsupported: null, mode: 'beats', brands: [] }, golden('layering-01')] });
  try {
    const candidate = w.candidate();
    const run = w.run({ kind: 'prepare', templateId: 'late-check', ownerId: null, from: { kind: 'candidate', candidateId: candidate.id, force: false } });
    let before: unknown;
    await prepareHandler({ ...w, renderer: { ...w.renderer, check: async dir => {
      const result = await w.renderer.check(dir);
      before = w.db.prepare('SELECT * FROM templates WHERE id = ?').get('late-check');
      if (nextOwner === null) release(w.db, run.id, run.claimedBy!, w.clock.now());
      else w.db.prepare('UPDATE runs SET claimed_by = ? WHERE id = ?').run(nextOwner, run.id);
      return result;
    }, render: w.renderer.render.bind(w.renderer), ready: w.renderer.ready.bind(w.renderer) } })(run);
    expect(getRun(w.db, run.id)).toMatchObject({ state: 'running', claimedBy: nextOwner });
    expect(w.db.prepare('SELECT * FROM templates WHERE id = ?').get('late-check')).toEqual(before);
    expect(templates.get(w.db, 'late-check')?.state).toBe('preparing');
    expect(existsSync(join(w.dataDir, 'templates', 'late-check', 'template.json'))).toBe(false);
    expect(w.db.prepare('SELECT state FROM candidates WHERE id = ?').get(candidate.id)).toEqual({ state: 'scored' });
    expect(w.db.prepare('SELECT prepared FROM scans').all()).toEqual([]);
  } finally { w.db.close(); }
});
