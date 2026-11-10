// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { register } from './instrumentation';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('start-up check', () => {
  it('in paid mode the server refuses to start without VC_SESSION_SECRET: the error is logged and the process exits with 1', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('VC_PROVIDER', 'magnific');
    vi.stubEnv('VC_SESSION_SECRET', '');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await register();
    expect(exit).toHaveBeenCalledWith(1);
    expect(String(logged.mock.calls[0]?.[0])).toContain('session-secret-required');
  });

  it('a secret that is too short stops it the same way', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('VC_SESSION_SECRET', 'short');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await register();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('with a secret it starts', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('VC_SESSION_SECRET', 'a-session-secret-of-at-least-32-characters');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await register();
    expect(exit).not.toHaveBeenCalled();
  });
});

it('exits on a live competing site lock instead of only throwing from Next instrumentation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-startup-'));
  writeFileSync(join(dir, 'site.lock'), String(process.ppid));
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  vi.stubEnv('VC_ENGINE', 'sqlite');
  vi.stubEnv('VC_DATA_DIR', dir);
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await register();
  expect(exit).toHaveBeenCalledWith(1);
  expect(String(logged.mock.calls[0]?.[0])).toContain('site-not-started');
});

describe('trusted proxy start-up check', () => {
  const start = async (env: Record<string, string>) => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await register();
    return { exit, logged };
  };

  it('VC_TRUST_PROXY=cloudflare on a site that does not listen on loopback only does not start: past the tunnel anyone can write cf-connecting-ip', async () => {
    for (const host of ['0.0.0.0', '192.168.1.20', '']) {
      const { exit, logged } = await start({ VC_TRUST_PROXY: 'cloudflare', VC_BIND_HOST: host });
      expect(exit, host).toHaveBeenCalledWith(1);
      expect(String(logged.mock.calls[0]?.[0])).toBe('site-not-started: cloudflare-proxy-requires-loopback');
      vi.restoreAllMocks();
    }
  });
  it('on a loopback bind it starts, and the older values are not looked at', async () => {
    expect((await start({ VC_TRUST_PROXY: 'cloudflare', VC_BIND_HOST: '127.0.0.1' })).exit).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect((await start({ VC_TRUST_PROXY: '1', VC_BIND_HOST: '0.0.0.0' })).exit).not.toHaveBeenCalled();
  });
});

describe('owner test start-up check: real generation + credit nobody paid for + mail to everyone must not start', () => {
  const owner = { VC_OWNER_TEST: '1', VC_PROVIDER: 'magnific', VC_ENGINE: 'sqlite', VC_BIND_HOST: '127.0.0.1', VC_PROVIDER_DAILY_CAP: '100', VC_PROVIDER_JOB_CAP: '60',
    VC_MAIL: 'resend', RESEND_API_KEY: 'private-test-placeholder', MAIL_FROM: 'no-reply@ishflow.com' };
  const check = async (env: Record<string, string | undefined>) => {
    const { checkOwnerTestConfig } = await import('./instrumentation-node');
    for (const [name, value] of Object.entries({ ...owner, ...env })) vi.stubEnv(name, value as string);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    checkOwnerTestConfig();
    return { exit, logged };
  };

  it('with VC_MAIL_ALLOW=* or a whole domain the site does not start, whether the payments are the demo ports, fake or Dodo test; the log names the reason and no value', async () => {
    for (const payments of [undefined, 'fake', 'test']) for (const allow of ['*', 'gmail.com', 'owner@example.com,gmail.com']) {
      const { exit, logged } = await check({ VC_PAYMENTS: payments, VC_MAIL_ALLOW: allow });
      expect(exit, `${payments} ${allow}`).toHaveBeenCalledWith(1);
      expect(logged.mock.calls.flat().join()).toBe('site-not-started: owner-test-forbids-open-mail-allowlist');
      vi.restoreAllMocks();
    }
  });
  it('the setting the live site runs on today starts: owner test, fake payments, a list of full addresses', async () => {
    for (const payments of [undefined, 'fake']) {
      const { exit } = await check({ VC_PAYMENTS: payments, VC_MAIL_ALLOW: 'owner@example.com,guest@example.org' });
      expect(exit, String(payments)).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });
});

describe('payment pipeline start-up check', () => {
  const secret = 'a-payments-webhook-secret-of-32-chars-or-more';

  it('with VC_PAYMENTS=fake and no webhook secret the site does not start; the log names the reason, not a value', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('VC_PAYMENTS', 'fake');
    vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET', '');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await register();
    expect(exit).toHaveBeenCalledWith(1);
    expect(String(logged.mock.calls[0]?.[0])).toBe('site-not-started: webhook-secret-required');
  });

  it('a live or test mode has no adapter yet and fails closed', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('VC_PAYMENTS', 'live');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await register();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('Dodo test mode does not start on the in-memory store: a restart would lose the commands written before each call', async () => {
    const { checkPaymentConfig } = await import('./instrumentation-node');
    for (const [name, value] of Object.entries({ VC_PAYMENTS: 'test', DODO_API_KEY_TEST: 'made-up-dodo-test-key', DODO_WEBHOOK_SECRET_TEST: 'whsec_' + Buffer.alloc(32, 7).toString('base64'),
      DODO_PRODUCT_PACK_STARTER: 'pdt_madeupstarter', DODO_PRODUCT_PACK_STANDARD: 'pdt_madeupstandard', DODO_PRODUCT_PACK_STUDIO: 'pdt_madeupstudio' })) vi.stubEnv(name, value);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const engine of ['', 'fake', 'SQLITE']) {
      vi.stubEnv('VC_ENGINE', engine);
      exit.mockClear();
      logged.mockClear();
      checkPaymentConfig();
      expect(exit, engine).toHaveBeenCalledWith(1);
      expect(String(logged.mock.calls[0]?.[0])).toBe('site-not-started: test-payments-require-sqlite');
    }
    exit.mockClear();
    vi.stubEnv('VC_ENGINE', 'sqlite');
    vi.stubEnv('INTERNAL_CRON_SECRET', 'a-made-up-sweep-secret-of-32-chr');
    checkPaymentConfig();
    expect(exit).not.toHaveBeenCalled();
  });

  it('Dodo test mode does not start without the secret of the minute\'s sweep, or with one too short to open its door: the sweep would be refused for ever, and a payment whose webhook is lost would never be credited', async () => {
    const { checkPaymentConfig } = await import('./instrumentation-node');
    for (const [name, value] of Object.entries({ VC_PAYMENTS: 'test', VC_ENGINE: 'sqlite', DODO_API_KEY_TEST: 'made-up-dodo-test-key', DODO_WEBHOOK_SECRET_TEST: 'whsec_' + Buffer.alloc(32, 7).toString('base64'),
      DODO_PRODUCT_PACK_STARTER: 'pdt_madeupstarter', DODO_PRODUCT_PACK_STANDARD: 'pdt_madeupstandard', DODO_PRODUCT_PACK_STUDIO: 'pdt_madeupstudio' })) vi.stubEnv(name, value);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const cron of [undefined, '', 'a-made-up-sweep-secret-of-31-ch']) {
      vi.stubEnv('INTERNAL_CRON_SECRET', cron as string);
      exit.mockClear();
      logged.mockClear();
      checkPaymentConfig();
      expect(exit, String(cron)).toHaveBeenCalledWith(1);
      expect(String(logged.mock.calls[0]?.[0])).toBe('site-not-started: sweep-secret-required');
    }
    exit.mockClear();
    vi.stubEnv('INTERNAL_CRON_SECRET', 'a-made-up-sweep-secret-of-32-chr');
    checkPaymentConfig();
    expect(exit).not.toHaveBeenCalled();
  });

  it('paid mode with the fake payments is refused', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('VC_PROVIDER', 'magnific');
    vi.stubEnv('VC_SESSION_SECRET', 'a-session-secret-of-at-least-32-characters');
    vi.stubEnv('VC_PAYMENTS', 'fake');
    vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET', secret);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await register();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('a valid fake configuration starts, and without VC_PAYMENTS (the demo ports) nothing is checked', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('VC_PAYMENTS', 'fake');
    vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET', secret);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await register();
    vi.stubEnv('VC_PAYMENTS', undefined as unknown as string);
    vi.stubEnv('VC_PAYMENTS_WEBHOOK_SECRET', '');
    await register();
    expect(exit).not.toHaveBeenCalled();
  });
});

it('refuses incomplete Resend configuration without printing environment values',async()=>{
 vi.stubEnv('NEXT_RUNTIME','nodejs');vi.stubEnv('VC_MAIL','resend');vi.stubEnv('RESEND_API_KEY','private-test-placeholder');vi.stubEnv('MAIL_FROM','no-reply@ishflow.com');vi.stubEnv('VC_MAIL_ALLOW','');
 const exit=vi.spyOn(process,'exit').mockImplementation((()=>undefined) as never),logged=vi.spyOn(console,'error').mockImplementation(()=>undefined);
 await register();expect(exit).toHaveBeenCalledWith(1);expect(logged.mock.calls.flat().join()).toContain('site-not-started: mail-allowlist-required');expect(logged.mock.calls.flat().join()).not.toContain('private-test-placeholder');
});
