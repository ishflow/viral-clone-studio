// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cloudflareInFront } from './trusted-proxy';

describe('cloudflareInFront', () => {
  it('only the value "cloudflare" on a loopback bind counts: the tunnel is then the only way in', () => {
    expect(cloudflareInFront({ VC_TRUST_PROXY: 'cloudflare', VC_BIND_HOST: '127.0.0.1' })).toBe(true);
    expect(cloudflareInFront({ VC_TRUST_PROXY: 'cloudflare', VC_BIND_HOST: '::1' })).toBe(true);
  });
  it('a site that listens on another address, or was not told its address, can be reached past Cloudflare: the header is anybody\'s word', () => {
    for (const host of ['0.0.0.0', '192.168.1.20', '100.64.1.1', '', undefined]) expect(cloudflareInFront({ VC_TRUST_PROXY: 'cloudflare', VC_BIND_HOST: host }), String(host)).toBe(false);
  });
  it('no other value means Cloudflare', () => {
    for (const trust of ['1', '0', 'true', 'Cloudflare', 'cloudflare ', '', undefined]) expect(cloudflareInFront({ VC_TRUST_PROXY: trust, VC_BIND_HOST: '127.0.0.1' }), String(trust)).toBe(false);
  });
});
