// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { ownerTestConfig } from './paid-mode';

const LIB = fileURLToPath(new URL('../../../ops/lib.sh', import.meta.url));
/** What `ops/preflight.sh` asks about the list of the env file: exit status 0 = full addresses only, 1 = refused. */
const shellAnswer = (list: string) => spawnSync('bash', ['-c', '. "$0"; mail_allow_names_people "$1"', LIB, list]).status;
const siteRefuses = (list: string) => {
  try {
    ownerTestConfig({ VC_OWNER_TEST: '1', VC_PROVIDER: 'magnific', VC_BIND_HOST: '127.0.0.1', VC_PROVIDER_DAILY_CAP: '20', VC_PROVIDER_JOB_CAP: '10', VC_MAIL: 'resend', VC_MAIL_ALLOW: list });
    return false;
  } catch (error) {
    return (error as Error).message === 'owner-test-forbids-open-mail-allowlist';
  }
};

it('the preflight knows the mail list the owner test forbids: `*`, a domain or an empty entry is refused there as the site refuses it', () => {
  for (const list of ['*', ' * ', 'gmail.com', 'owner@example.com,gmail.com', 'owner@example.com, *', '*,owner@example.com', 'owner@example.com,', ',owner@example.com', '']) {
    expect(siteRefuses(list), list).toBe(true);
    expect(shellAnswer(list), list).toBe(1);
  }
});
it('a list of full addresses only passes the preflight, as the site starts with it', () => {
  for (const list of ['owner@example.com', 'owner@example.com, Guest@Example.org', 'a@example.com,b@example.com,c@example.com']) {
    expect(siteRefuses(list), list).toBe(false);
    expect(shellAnswer(list), list).toBe(0);
  }
});

const OPS = fileURLToPath(new URL('../../../ops/', import.meta.url));
/**
 * What `ops/preflight.sh` itself prints for an env file with this mail list. The env file is written here with made-up values (the
 * real one is never read). The script's last step, `health.sh`, looks at the running install, so the script and `lib.sh` run as
 * copies next to a stand-in for it; the short PATH and the empty HOME keep it from starting `claude` or reading anything of the owner.
 */
function preflightSays(list: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'vc-preflight-'));
  mkdirSync(join(dir, 'ops'));
  for (const file of ['preflight.sh', 'lib.sh']) copyFileSync(join(OPS, file), join(dir, 'ops', file));
  writeFileSync(join(dir, 'ops', 'health.sh'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  const envFile = join(dir, 'env');
  writeFileSync(envFile, ["VC_OWNER_TEST='1'", "VC_PROVIDER='magnific'", "VC_MAIL='resend'", `VC_MAIL_ALLOW='${list}'`, ''].join('\n'), { mode: 0o600 });
  return spawnSync('bash', [join(dir, 'ops', 'preflight.sh'), '--env-file', envFile], { env: { PATH: '/usr/bin:/bin', HOME: dir, NODE_ENV: 'test' }, encoding: 'utf8' }).stdout;
}
const REFUSAL = /^FAIL  .*owner-test-forbids-open-mail-allowlist/m;
const PASS = 'OK    VC_MAIL_ALLOW names full addresses only';

it('ops/preflight.sh, run on an env file, fails the list the owner test forbids and names the start refusal', () => {
  for (const list of ['*', 'gmail.com', 'owner@example.com,gmail.com', 'owner@example.com, *', 'owner@example.com,', '']) {
    const out = preflightSays(list);
    expect(out, list).toMatch(REFUSAL);
    expect(out, list).not.toContain(PASS);
  }
});
it('ops/preflight.sh, run on an env file, passes a list of full addresses', () => {
  const out = preflightSays('owner@example.com, Guest@Example.org');
  expect(out).toContain(PASS);
  expect(out).not.toMatch(REFUSAL);
});
