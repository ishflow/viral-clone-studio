// Real HyperFrames (`VE_RENDER=1 pnpm vitest run src/quality`): the labelled set of real renders at 720x1280 and 1080x1920.
// Good renders must raise no error; every planted fault must be found. About 44 renders: half an hour on a loaded machine.
// VE_QUALITY_SET=<folder> keeps the renders there and uses the ones it already holds; VE_QUALITY_JOBS: renders at a time (default 2).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { available } from '../compose/golden-helpers.ts';
import { CANVASES, CASES, buildSet, judge, table } from './labelled.ts';
import type { Row } from './labelled.ts';

const SET_TIMEOUT = 48 * 60_000;

describe.skipIf(!available)('the labelled set of real renders', () => {
  const kept = process.env.VE_QUALITY_SET;
  const root = kept ?? mkdtempSync(join(tmpdir(), 've-labelled-'));
  const rows: Row[] = [];
  beforeAll(async () => {
    const built = await buildSet(root, Number(process.env.VE_QUALITY_JOBS ?? 2));
    for (const render of built) rows.push(await judge(render));
  }, SET_TIMEOUT);
  afterAll(() => { if (!kept) rmSync(root, { recursive: true, force: true }); });

  it('holds every case at both sizes (the cases on real footage only where that footage is on disk)', () => {
    const always = CASES.filter((c) => c.doc !== 'real');
    for (const canvas of CANVASES) for (const c of always) expect(rows.some((r) => r.name === c.name && r.size === canvas.width), `${c.name} at ${canvas.width}`).toBe(true);
  });
  it('good renders raise no error', () => {
    const alarms = rows.filter((r) => r.good && r.errors.length > 0).map((r) => `${r.name}-${r.size}: ${r.errors.join(', ')}`);
    expect(alarms, table(rows).text).toEqual([]);
  });
  it('every planted fault is found', () => {
    const missed = rows.filter((r) => !r.good && !r.found).map((r) => `${r.name}-${r.size}: ${r.fault}`);
    expect(missed, table(rows).text).toEqual([]);
  });
  it('a planted fault raises no error about anything else', () => {
    const allowed: Record<string, string[]> = { 'black-clip': ['black-frames'], 'frozen-clip': ['frozen-frames', 'wrong-footage'], 'wrong-clip': ['wrong-footage'] };
    const stray = rows.filter((r) => !r.good).flatMap((r) => r.issues
      .filter((i) => i.severity === 'error' && !(allowed[r.name] ?? ['text-missing', 'output-mismatch']).includes(i.code))
      .map((i) => `${r.name}-${r.size}: ${i.code} (${i.target})`));
    expect(stray, table(rows).text).toEqual([]);
  });
});
