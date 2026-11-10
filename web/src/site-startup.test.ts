// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import configuration from '../next.config';
afterEach(() => vi.unstubAllEnvs());
it('claims the site lock during Next configuration before it listens, and leaves builds unlocked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-next-lock-'));
  writeFileSync(join(dir, 'site.lock'), String(process.ppid));
  vi.stubEnv('VC_ENGINE', 'sqlite'); vi.stubEnv('VC_DATA_DIR', dir);
  expect(() => configuration('phase-production-build')).not.toThrow();
  expect(() => configuration('phase-production-server')).toThrow('site-not-started');
  // Next dev forks a server: the child claims its lock in instrumentation, before any port can write.
  expect(() => configuration('phase-development-server')).not.toThrow();
});
