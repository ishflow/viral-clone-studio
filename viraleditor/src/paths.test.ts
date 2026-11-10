import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { abs, dataDir, rel } from './paths.ts';

describe('paths', () => {
  it('uses VC_DATA_DIR when set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-'));
    process.env.VC_DATA_DIR = dir;
    try {
      expect(dataDir()).toBe(dir);
      expect(rel('jobs', 'r1', 'fill.json')).toBe('jobs/r1/fill.json');
      expect(abs('jobs/r1/fill.json')).toBe(join(dir, 'jobs/r1/fill.json'));
    } finally {
      delete process.env.VC_DATA_DIR;
    }
  });
  it('defaults to <repo>/data', () => {
    delete process.env.VC_DATA_DIR;
    expect(dataDir().endsWith('/data')).toBe(true);
    expect(dataDir()).not.toContain('/engine/');
  });
  it('abs refuses paths that leave the data dir', () => {
    process.env.VC_DATA_DIR = mkdtempSync(join(tmpdir(), 'vc-'));
    try {
      expect(() => abs('../x')).toThrow();
      expect(() => abs('a/../../x')).toThrow();
      expect(() => abs('/etc/passwd')).toThrow();
    } finally {
      delete process.env.VC_DATA_DIR;
    }
  });
});
