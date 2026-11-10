// @vitest-environment node
import { describe, expect, it } from 'vitest';
import nextConfig, { securityHeaders } from '../next.config';

const byKey = (headers: { key: string; value: string }[]) => Object.fromEntries(headers.map(({ key, value }) => [key, value]));
const csp = (production: boolean): Record<string, string[]> => Object.fromEntries(
  byKey(securityHeaders(production))['Content-Security-Policy']!.split(';').map((part) => part.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]),
);

describe('security headers (I3)', () => {
  it('forbid framing, sniffing and referrers to other sites, and switch the browser features off', () => {
    const headers = byKey(securityHeaders(true));
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('same-origin');
    // "Empty": every feature the site does not use is given an empty allow-list.
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'display-capture']) expect(headers['Permissions-Policy']).toContain(`${feature}=()`);
    expect(headers['Permissions-Policy']).not.toMatch(/=\((?!\))/);
  });

  it('the policy starts closed: default-src self, and nothing may frame the site, embed objects or change base / form targets', () => {
    const policy = csp(true);
    expect(policy['default-src']).toEqual(["'self'"]);
    expect(policy['frame-ancestors']).toEqual(["'none'"]);
    expect(policy['object-src']).toEqual(["'none'"]);
    expect(policy['base-uri']).toEqual(["'self'"]);
    expect(policy['form-action']).toEqual(["'self'"]);
    for (const kind of ['img-src', 'media-src', 'font-src']) expect(policy[kind], kind).toEqual(["'self'", 'data:', 'blob:']);
  });

  it('no source list lets in a whole scheme or host from the outside', () => {
    for (const [name, sources] of Object.entries(csp(true))) {
      for (const source of sources) expect(source, name).not.toMatch(/^(https?:|\*|ws:|wss:)/);
    }
  });

  it('production allows inline scripts (Next\'s own bootstrap) but never eval; development also needs eval for React\'s debugging', () => {
    expect(csp(true)['script-src']).toContain("'unsafe-inline'");
    expect(csp(true)['script-src']).not.toContain("'unsafe-eval'");
    expect(csp(false)['script-src']).toContain("'unsafe-eval'");
  });

  it('the config sends them on every route', async () => {
    const rules = await nextConfig('phase-production-build').headers?.();
    expect(rules).toHaveLength(1);
    expect(rules?.[0]?.source).toBe('/:path*');
    expect(rules?.[0]?.headers.map((header) => header.key)).toEqual(securityHeaders(process.env.NODE_ENV === 'production').map((header) => header.key));
  });
});
