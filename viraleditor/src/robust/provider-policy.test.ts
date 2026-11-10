import { describe, expect, it } from 'vitest';
import { ownerTestConfig } from './provider-policy.ts';

const env = { VC_OWNER_TEST: '1', VC_PROVIDER: 'magnific', VC_BIND_HOST: '127.0.0.1', VC_PROVIDER_DAILY_CAP: '100', VC_PROVIDER_JOB_CAP: '60' };

describe('the owner test and a proxy in front of the site (VC_TRUST_PROXY)', () => {
  it('no proxy: the owner test is on, with its caps', () => {
    expect(ownerTestConfig(env)).toEqual({ daily: 100, job: 60 });
    expect(ownerTestConfig({ ...env, VC_TRUST_PROXY: '' })).toEqual({ daily: 100, job: 60 });
  });

  it('the Cloudflare Tunnel is the one proxy it runs behind', () => {
    expect(ownerTestConfig({ ...env, VC_TRUST_PROXY: 'cloudflare' })).toEqual({ daily: 100, job: 60 });
  });

  it('every other value is refused, "1" and near spellings of cloudflare included', () => {
    for (const trust of ['1', '0', 'true', 'Cloudflare', 'cloudflare,1', ' cloudflare', 'cloudflare ']) {
      expect(() => ownerTestConfig({ ...env, VC_TRUST_PROXY: trust }), trust).toThrow('owner-test-forbids-trust-proxy');
    }
  });

  it('behind the tunnel the other conditions still hold: a bind that is not loopback is refused', () => {
    expect(() => ownerTestConfig({ ...env, VC_TRUST_PROXY: 'cloudflare', VC_BIND_HOST: '0.0.0.0' })).toThrow('owner-test-requires-loopback');
  });
});
