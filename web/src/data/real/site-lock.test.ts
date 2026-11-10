// @vitest-environment node
import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSiteOwner } from './site-lock';
it('a second process exits before writing the first process store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-lock-'));
  assertSiteOwner(dir);
  const module = new URL('./site-lock.ts', import.meta.url).href;
  const script = `import { assertSiteOwner } from ${JSON.stringify(module)}; import { writeFileSync } from 'node:fs'; assertSiteOwner(process.argv[1]); writeFileSync(process.argv[1] + '/site.json', 'lost ledger');`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, dir], { encoding: 'utf8' });
  expect(child.status).toBe(1);
  expect(child.stderr).toContain('site-not-started');
  expect(readFileSync(join(dir, 'site.lock'), 'utf8')).toBe(String(process.pid));
  expect(existsSync(join(dir, 'site.json'))).toBe(false);
});

it('fails closed on an empty lock while its creator may still be writing the pid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-empty-lock-'));
  writeFileSync(join(dir, 'site.lock'), '');
  expect(() => assertSiteOwner(dir)).toThrow('site-not-started');
  expect(readFileSync(join(dir, 'site.lock'), 'utf8')).toBe('');
});
