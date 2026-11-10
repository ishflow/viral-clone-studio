import { afterEach, expect, it, vi } from 'vitest';
import { ownerTestConfig } from './paid-mode';
afterEach(() => vi.unstubAllEnvs());
const env = { VC_OWNER_TEST: '1', VC_PROVIDER: 'magnific', VC_BIND_HOST: '127.0.0.1', VC_PROVIDER_DAILY_CAP: '20', VC_PROVIDER_JOB_CAP: '10' };
it('permits only explicit bounded loopback owner mode', () => {
  expect(ownerTestConfig(env)).toEqual({ daily: 20, job: 10 });
  for (const patch of [{ VC_BIND_HOST: '0.0.0.0' }, { VC_TRUST_PROXY: '0' }, { VC_PROVIDER_JOB_CAP: '' }, { VC_DEMO_LINKS: '1' }]) expect(() => ownerTestConfig({ ...env, ...patch })).toThrow();
});
it('the one proxy the owner test may stand behind is the Cloudflare Tunnel, and only on a loopback bind; every other VC_TRUST_PROXY is refused as before', () => {
  expect(ownerTestConfig({ ...env, VC_TRUST_PROXY: 'cloudflare' })).toEqual({ daily: 20, job: 10 });
  expect(ownerTestConfig({ ...env, VC_TRUST_PROXY: 'cloudflare', VC_BIND_HOST: '::1' })).toEqual({ daily: 20, job: 10 });
  for (const trust of ['1', '0', 'true', 'Cloudflare', 'cloudflare,1']) expect(() => ownerTestConfig({ ...env, VC_TRUST_PROXY: trust }), trust).toThrow('owner-test-forbids-trust-proxy');
  for (const host of ['0.0.0.0', '100.64.1.1', '']) expect(() => ownerTestConfig({ ...env, VC_TRUST_PROXY: 'cloudflare', VC_BIND_HOST: host }), host).toThrow('owner-test-requires-loopback');
});
it('forbids the owner test next to a mail list that lets strangers in: with `*` or a whole domain anyone could verify an address, take the free credit of the fake pay page and spend real Magnific money', () => {
  const mail = { ...env, VC_MAIL: 'resend' };
  for (const allow of ['*', 'gmail.com', 'owner@example.com,gmail.com', 'owner@example.com, *', '', undefined]) expect(() => ownerTestConfig({ ...mail, VC_MAIL_ALLOW: allow }), String(allow)).toThrow('owner-test-forbids-open-mail-allowlist');
});
it('a list of full addresses only is the invited people: the owner test goes on, and without real mail the list is not looked at', () => {
  expect(ownerTestConfig({ ...env, VC_MAIL: 'resend', VC_MAIL_ALLOW: 'owner@example.com' })).toEqual({ daily: 20, job: 10 });
  expect(ownerTestConfig({ ...env, VC_MAIL: 'resend', VC_MAIL_ALLOW: 'owner@example.com, Guest@Example.org' })).toEqual({ daily: 20, job: 10 });
  for (const mode of ['fake', undefined]) expect(ownerTestConfig({ ...env, VC_MAIL: mode, VC_MAIL_ALLOW: '*' }), String(mode)).toEqual({ daily: 20, job: 10 });
});
import { paymentConfig } from './payments/config';
it('allows fake payment config only with the validated owner policy', () => {
 const config = { ...env, VC_PAYMENTS: 'fake', VC_PAYMENTS_WEBHOOK_SECRET: 'offline-test-secret-0123456789-abcdef' };
 expect(paymentConfig(config).mode).toBe('fake');
 expect(() => paymentConfig({ ...config, VC_OWNER_TEST: undefined })).toThrow('fake-payments-in-paid-mode');
 expect(() => paymentConfig({ ...config, VC_BIND_HOST: '100.64.1.1' })).toThrow('owner-test-requires-loopback');
});
