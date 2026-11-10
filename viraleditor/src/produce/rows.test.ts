import { describe, expect, it } from 'vitest';
import { FakeClock } from '../adapters/fakes.ts';
import { beginOperation, endOperation } from '../db/runs.ts';
import { attemptKey, attemptOf, firstKey } from './rows.ts';
import { golden, inputOf, startRun, workspace } from './testing.ts';

describe('the key of a retry', () => {
  it('ends in a suffix no id can hold, so a key is read back without guessing', () => {
    expect(attemptKey('v1:clip:s3', 1)).toBe('v1:clip:s3');
    expect(attemptKey('v1:clip:s3', 2)).toBe('v1:clip:s3#2');
    expect(attemptKey('v1:music', 12)).toBe('v1:music#12');
    expect(firstKey('v1:clip:s3#2')).toBe('v1:clip:s3');
    expect(firstKey('v1:music#12')).toBe('v1:music');
    // shot, still and segment ids like r2 are legal: they are not a retry
    for (const key of ['v1:clip:r3', 'v1:image:r2', 'v2:clip:r10', 'v1:clip:s3', 'v1:music']) expect(firstKey(key)).toBe(key);
    expect(firstKey('v1:clip:r3#2')).toBe('v1:clip:r3');
  });

  it('attemptOf walks the failed attempts of exactly that key', () => {
    const { db } = workspace();
    const clock = new FakeClock();
    const { template, fill } = golden('layering-01');
    const runId = startRun(db, clock, template, inputOf(template, fill, 1)).id;
    const row = (key: string, state: 'failed' | 'done') => { beginOperation(db, runId, key, 'clip', clock.now()); endOperation(db, runId, key, { state }, clock.now()); };
    expect(attemptOf(db, runId, 'v1:clip:r2')).toEqual({ key: 'v1:clip:r2', row: null });
    row('v1:clip:r2', 'failed');
    expect(attemptOf(db, runId, 'v1:clip:r2')).toEqual({ key: 'v1:clip:r2#2', row: null });
    row('v1:clip:r2#2', 'failed'); row('v1:clip:r2#3', 'done');
    expect(attemptOf(db, runId, 'v1:clip:r2')).toMatchObject({ key: 'v1:clip:r2#3', row: { state: 'done' } });
    expect(attemptOf(db, runId, 'v1:clip:r')).toEqual({ key: 'v1:clip:r', row: null });
  });
});
