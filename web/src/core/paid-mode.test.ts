// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoAidsAllowed } from './paid-mode';

afterEach(() => vi.unstubAllEnvs());

/** A production build with these values; a name that is left out is not set at all. */
function production(env: Record<string, string>): boolean {
  vi.unstubAllEnvs();
  vi.stubEnv('NODE_ENV', 'production');
  for (const name of ['VC_DEMO_LINKS', 'VC_BIND_HOST', 'VC_TRUST_PROXY', 'VC_PROVIDER', 'VC_MAIL']) vi.stubEnv(name, env[name]);
  return demoAidsAllowed();
}

describe('demoAidsAllowed in a production build (SEC B7)', () => {
  it('needs VC_DEMO_LINKS=1 and a loopback bind address the process was told about', () => {
    expect(production({ VC_DEMO_LINKS: '1', VC_BIND_HOST: '127.0.0.1' })).toBe(true);
    expect(production({ VC_DEMO_LINKS: '1', VC_BIND_HOST: '::1' })).toBe(true);
    expect(production({ VC_BIND_HOST: '127.0.0.1' })).toBe(false);
  });

  it('a site that others can reach hands out no reset link: a tailnet or wildcard address, or an address nobody named', () => {
    for (const host of ['100.101.102.103', '0.0.0.0', '::', '192.168.1.10', 'localhost', '127.0.0.1.evil.example', '']) {
      expect(production({ VC_DEMO_LINKS: '1', VC_BIND_HOST: host }), host).toBe(false);
    }
    expect(production({ VC_DEMO_LINKS: '1' })).toBe(false);
  });

  it('a proxy in front makes the loopback site public: any VC_TRUST_PROXY turns the aids off', () => {
    for (const trust of ['1', '0', 'true', 'cloudflare']) expect(production({ VC_DEMO_LINKS: '1', VC_BIND_HOST: '127.0.0.1', VC_TRUST_PROXY: trust }), trust).toBe(false);
    expect(production({ VC_DEMO_LINKS: '1', VC_BIND_HOST: '127.0.0.1', VC_TRUST_PROXY: '' })).toBe(true);
  });

  it('paid mode and real mail still switch them off', () => {
    expect(production({ VC_DEMO_LINKS: '1', VC_BIND_HOST: '127.0.0.1', VC_PROVIDER: 'magnific' })).toBe(false);
    expect(production({ VC_DEMO_LINKS: '1', VC_BIND_HOST: '127.0.0.1', VC_MAIL: 'resend' })).toBe(false);
  });
});

describe('demoAidsAllowed outside a production build', () => {
  it('a test run and `next dev` have the aids without any of this', () => {
    expect(demoAidsAllowed()).toBe(true);
    vi.stubEnv('VC_BIND_HOST', '0.0.0.0');
    expect(demoAidsAllowed()).toBe(true);
  });
});
