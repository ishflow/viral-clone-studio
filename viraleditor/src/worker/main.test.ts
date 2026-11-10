import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync } from 'node:fs';
import { openDb } from '../db/open.ts';
import * as runs from '../db/runs.ts';
import { FakeClock, FakeRenderer, FakeShorts, FakeTopAds } from '../adapters/fakes.ts';
import { buildParts } from './parts.ts';
import { lanesFrom, realHandlers, start } from './main.ts';
import type { RunInput } from '../contracts.ts';

const mem = () => openDb(join(mkdtempSync(join(tmpdir(), 'vc-main-')), 'db.sqlite'));
const now = new Date('2026-10-04T10:00:00.000Z');
const settle = (check: () => boolean) => vi.waitFor(() => { if (!check()) throw new Error('not yet'); }, { timeout: 5000, interval: 10 });
const fakeParts = (db: ReturnType<typeof mem>) => {
  const dir = mkdtempSync(join(tmpdir(), 'vc-main-data-'));
  const parts = buildParts({ VC_DATA_DIR: dir }, db, new FakeClock(now), {
    renderer: new FakeRenderer({ ready: { ready: true, note: null } }),
    aligner: { align: async () => [], ready: async () => ({ ready: false, note: null }) },
  });
  return { ...parts, scanDeps: { ...parts.scanDeps, topAds: new FakeTopAds([[]]), shorts: new FakeShorts({ queue: [] }) } };
};

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('worker/main', () => {
  it('a queued run of each kind reaches its own handler', async () => {
    const db = mem();
    const seen: string[] = [];
    const spy = (kind: runs.RunRow['kind']) => async (run: runs.RunRow) => { seen.push(`${kind}:${run.kind}`); runs.stop(db, run.id, 'engine-error', null, now); };
    runs.enqueue(db, { kind: 'scan', source: 'topads', trigger: 'manual' }, 's1', null, new Date(now.getTime() + 1));
    runs.enqueue(db, { kind: 'edit', templateId: 't', ownerId: null, card: {} } as never, 't', null, new Date(now.getTime() + 2));
    runs.enqueue(db, { kind: 'prepare', templateId: 'p', ownerId: null, from: { kind: 'candidate', candidateId: 'c', force: false } }, 'p', null, new Date(now.getTime() + 3));
    const worker = start(db, { parts: fakeParts(db), idleMs: 20, handlers: { scan: spy('scan'), edit: spy('edit'), prepare: spy('prepare'), produce: spy('produce') } });
    await settle(() => seen.length === 3);
    await worker.stop();
    expect([...seen].sort()).toEqual(['edit:edit', 'prepare:prepare', 'scan:scan']);
  });

  it('the real scan handler runs a queued scan against the parts', async () => {
    const db = mem();
    const id = runs.enqueue(db, { kind: 'scan', source: 'topads', trigger: 'manual' }, 'scan-1', null, now);
    const parts = fakeParts(db);
    const worker = start(db, { parts, idleMs: 20, handlers: realHandlers(parts) });
    await settle(() => runs.getRun(db, id)?.state === 'done');
    await worker.stop();
    expect(runs.getRun(db, id)?.result).toMatchObject({ kind: 'scan', checked: 0 });
  });

  it('the worker id differs between two starts in one process', async () => {
    const db = mem();
    const ids: (string | null)[] = [];
    for (let i = 0; i < 2; i++) {
      const id = runs.enqueue(db, { kind: 'scan', source: 'topads', trigger: 'manual' }, `s${i}`, null, new Date(now.getTime() + i));
      const stopIt = async (run: runs.RunRow) => { runs.stop(db, run.id, 'engine-error', null, now); };
      const worker = start(db, { parts: fakeParts(db), idleMs: 20, handlers: { scan: stopIt, edit: stopIt, prepare: stopIt, produce: stopIt } });
      await settle(() => runs.getRun(db, id)?.state === 'stopped');
      ids.push(runs.getRun(db, id)!.claimedBy);
      await worker.stop();
    }
    expect(ids[0]).toMatch(/^worker-\d+-[0-9a-f]{8}$/);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it('stop() leaves no timer', async () => {
    vi.useFakeTimers();
    const db = mem();
    const ok = async () => {};
    const worker = start(db, { parts: fakeParts(db), handlers: { scan: ok, edit: ok, prepare: ok, produce: ok } });
    await worker.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('VC_WORKER_PREPARE: how many inspections the worker runs at once', () => {
  const prepare = (n: number) => ({ kind: 'prepare', templateId: `p${n}`, ownerId: null, from: { kind: 'candidate', candidateId: `c${n}`, force: false } }) as const;

  it('unset, empty or 1: no lanes, the worker runs one run at a time as before', () => {
    for (const env of [{}, { VC_WORKER_PREPARE: '' }, { VC_WORKER_PREPARE: '1' }]) expect(lanesFrom(env)).toBeUndefined();
  });

  it('4: four inspections at once, next to one produce run and one scan or edit', () => {
    expect(lanesFrom({ VC_WORKER_PREPARE: '4' })).toEqual([{ kinds: ['prepare'], size: 4 }, { kinds: ['produce'], size: 1 }, { kinds: ['scan', 'edit'], size: 1 }]);
  });

  it('every kind of run the schema knows is taken by a lane: a fifth kind added to schema.sql would otherwise wait for ever (K6)', () => {
    const sql = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    const kinds = /CHECK \(kind IN \(([^)]*)\)\)/.exec(sql)?.[1]?.split(',').map((k) => k.trim().replace(/'/g, ''));
    expect(kinds?.length).toBeGreaterThan(0);
    const taken = new Set(lanesFrom({ VC_WORKER_PREPARE: '2' })!.flatMap((lane) => lane.kinds ?? []));
    expect([...taken].sort()).toEqual([...kinds!].sort());
  });

  it('the produce lane is one wide whatever the number', () => {
    for (const n of ['2', '16']) expect(lanesFrom({ VC_WORKER_PREPARE: n })!.filter((lane) => lane.kinds?.includes('produce'))).toEqual([{ kinds: ['produce'], size: 1 }]);
  });

  it.each(['0', '-2', '2.5', 'four', '4 ', '1e1', '04', '17', '400'])('%j is refused with an error that names the variable', (raw) => {
    expect(() => lanesFrom({ VC_WORKER_PREPARE: raw })).toThrow(`VC_WORKER_PREPARE must be a whole number from 1 to 16, got "${raw}"`);
  });

  it('start() with VC_WORKER_PREPARE=3 runs three inspections at once, each slot under its own owner id', async () => {
    vi.stubEnv('VC_WORKER_PREPARE', '3');
    const db = mem();
    const ids = [0, 1, 2, 3].map((n) => runs.enqueue(db, prepare(n), `p${n}`, null, new Date(now.getTime() + n)));
    let inside = 0, most = 0; const owners = new Set<string | null>();
    let open!: () => void; const gate = new Promise<void>((r) => { open = r; });
    const ok = async () => {};
    const worker = start(db, { parts: fakeParts(db), idleMs: 20, handlers: { scan: ok, edit: ok, produce: ok, prepare: async (run) => {
      inside++; most = Math.max(most, inside); owners.add(run.claimedBy);
      await gate;
      runs.stop(db, run.id, 'engine-error', null, now); inside--;
    } } });
    await settle(() => inside === 3);
    await new Promise((r) => setTimeout(r, 60));
    expect(ids.filter((id) => runs.getRun(db, id)?.state === 'queued')).toHaveLength(1);
    open();
    await settle(() => ids.every((id) => runs.getRun(db, id)?.state === 'stopped'));
    await worker.stop();
    expect(most).toBe(3);
    expect(owners.size).toBe(3);
    for (const owner of owners) expect(owner).toMatch(/^worker-\d+-[0-9a-f]{8}#[0-2]$/);
  });

  it('start() with an invalid VC_WORKER_PREPARE throws before anything is started: no timer is left', () => {
    vi.useFakeTimers();
    vi.stubEnv('VC_WORKER_PREPARE', 'many');
    const db = mem();
    const ok = async () => {};
    expect(() => start(db, { parts: fakeParts(db), handlers: { scan: ok, edit: ok, prepare: ok, produce: ok } })).toThrow('VC_WORKER_PREPARE');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('VC_WORKER_PRODUCE: how many videos the worker makes at once', () => {
  const produce = (ownerId: string): RunInput => ({ kind: 'produce', templateId: 't1', ownerId, quality: 'fast', variants: 1, language: 'en', products: [], sample: false });
  const others = [{ kinds: ['scan', 'edit'], size: 1 }];

  it('unset, empty or 1, with VC_WORKER_PREPARE unset, empty or 1: no lanes, the worker runs one run at a time as before', () => {
    for (const VC_WORKER_PRODUCE of [undefined, '', '1']) for (const VC_WORKER_PREPARE of [undefined, '', '1']) expect(lanesFrom({ VC_WORKER_PRODUCE, VC_WORKER_PREPARE })).toBeUndefined();
  });

  it('3: three videos at once, next to one inspection and one scan or edit', () => {
    expect(lanesFrom({ VC_WORKER_PRODUCE: '3' })).toEqual([{ kinds: ['prepare'], size: 1 }, { kinds: ['produce'], size: 3 }, ...others]);
  });

  it('with VC_WORKER_PREPARE each lane has its own number, and 1 next to a wider lane is a lane of one', () => {
    expect(lanesFrom({ VC_WORKER_PREPARE: '4', VC_WORKER_PRODUCE: '2' })).toEqual([{ kinds: ['prepare'], size: 4 }, { kinds: ['produce'], size: 2 }, ...others]);
    expect(lanesFrom({ VC_WORKER_PREPARE: '1', VC_WORKER_PRODUCE: '6' })).toEqual([{ kinds: ['prepare'], size: 1 }, { kinds: ['produce'], size: 6 }, ...others]);
  });

  it('every kind of run the schema knows is taken by a lane when only VC_WORKER_PRODUCE is set', () => {
    const sql = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    const kinds = /CHECK \(kind IN \(([^)]*)\)\)/.exec(sql)?.[1]?.split(',').map((k) => k.trim().replace(/'/g, ''));
    const taken = new Set(lanesFrom({ VC_WORKER_PRODUCE: '2' })!.flatMap((lane) => lane.kinds ?? []));
    expect([...taken].sort()).toEqual([...kinds!].sort());
  });

  it.each(['0', '-2', '2.5', 'three', '3 ', '1e1', '03', '7', '60'])('%j is refused with an error that names the variable', (raw) => {
    expect(() => lanesFrom({ VC_WORKER_PRODUCE: raw })).toThrow(`VC_WORKER_PRODUCE must be a whole number from 1 to 6, got "${raw}"`);
  });

  it('an invalid number is refused whatever the other variable says', () => {
    expect(() => lanesFrom({ VC_WORKER_PREPARE: '4', VC_WORKER_PRODUCE: 'two' })).toThrow('VC_WORKER_PRODUCE must be');
    expect(() => lanesFrom({ VC_WORKER_PREPARE: 'four', VC_WORKER_PRODUCE: '2' })).toThrow('VC_WORKER_PREPARE must be');
    expect(() => lanesFrom({ VC_WORKER_PREPARE: '1', VC_WORKER_PRODUCE: '7' })).toThrow('VC_WORKER_PRODUCE must be');
  });

  it('start() with VC_WORKER_PRODUCE=2 makes two videos at once, each slot under its own owner id, and the third waits', async () => {
    vi.stubEnv('VC_WORKER_PRODUCE', '2');
    const db = mem();
    const ids = [0, 1, 2].map((n) => runs.enqueue(db, produce('u1'), `job${n}`, null, new Date(now.getTime() + n)));
    let inside = 0, most = 0; const owners = new Set<string | null>();
    let open!: () => void; const gate = new Promise<void>((r) => { open = r; });
    const ok = async () => {};
    const worker = start(db, { parts: fakeParts(db), idleMs: 20, handlers: { scan: ok, edit: ok, prepare: ok, produce: async (run) => {
      inside++; most = Math.max(most, inside); owners.add(run.claimedBy);
      await gate;
      runs.stop(db, run.id, 'engine-error', null, now); inside--;
    } } });
    await settle(() => inside === 2);
    await new Promise((r) => setTimeout(r, 60));
    expect(ids.map((id) => runs.getRun(db, id)?.state)).toEqual(['running', 'running', 'queued']);
    open();
    await settle(() => ids.every((id) => runs.getRun(db, id)?.state === 'stopped'));
    await worker.stop();
    expect(most).toBe(2);
    expect(owners.size).toBe(2);
    for (const owner of owners) expect(owner).toMatch(/^worker-\d+-[0-9a-f]{8}#[12]$/);
  });

  it('start() with VC_WORKER_PRODUCE=3: a second customer\'s video starts before the first customer\'s third', async () => {
    vi.stubEnv('VC_WORKER_PRODUCE', '3');
    const db = mem();
    const mine = [0, 1, 2].map((n) => runs.enqueue(db, produce('u1'), `u1-job${n}`, null, new Date(now.getTime() + n)));
    const theirs = [3, 4].map((n) => runs.enqueue(db, produce('u2'), `u2-job${n}`, null, new Date(now.getTime() + n)));
    const started: string[] = [];
    let open!: () => void; const gate = new Promise<void>((r) => { open = r; });
    const ok = async () => {};
    const worker = start(db, { parts: fakeParts(db), idleMs: 20, handlers: { scan: ok, edit: ok, prepare: ok, produce: async (run) => {
      started.push(run.id);
      await gate;
      runs.finish(db, run.id, { kind: 'produce', variants: [] }, now);
    } } });
    await settle(() => started.length === 3);
    await new Promise((r) => setTimeout(r, 60));
    expect([...started].sort()).toEqual([mine[0], mine[1], theirs[0]].sort());
    open();
    await settle(() => [...mine, ...theirs].every((id) => runs.getRun(db, id)?.state === 'done'));
    await worker.stop();
    expect(started).toHaveLength(5);
  });

  it('start() with an invalid VC_WORKER_PRODUCE throws before anything is started: no timer is left', () => {
    vi.useFakeTimers();
    vi.stubEnv('VC_WORKER_PRODUCE', '0');
    const db = mem();
    const ok = async () => {};
    expect(() => start(db, { parts: fakeParts(db), handlers: { scan: ok, edit: ok, prepare: ok, produce: ok } })).toThrow('VC_WORKER_PRODUCE');
    expect(vi.getTimerCount()).toBe(0);
  });
});
