/** Shared site/worker policy. No I/O and no secrets in errors. */
export type ProviderEnv = Record<string, string | undefined>;
export interface ProviderCaps { daily: number; job: number }
export function providerCaps(env: ProviderEnv): ProviderCaps | null {
  const integer = (name: string): number => {
    const raw = env[name] ?? '';
    if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('provider-cap-required');
    return Number(raw);
  };
  if (!env.VC_PROVIDER_DAILY_CAP && !env.VC_PROVIDER_JOB_CAP && env.VC_OWNER_TEST !== '1') return null;
  return { daily: integer('VC_PROVIDER_DAILY_CAP'), job: integer('VC_PROVIDER_JOB_CAP') };
}
export function ownerTestConfig(env: ProviderEnv): ProviderCaps | null {
  if (env.VC_OWNER_TEST === undefined || env.VC_OWNER_TEST === '') return null;
  if (env.VC_OWNER_TEST !== '1') throw new Error('invalid-owner-test-mode');
  if (env.VC_PROVIDER !== 'magnific') throw new Error('owner-test-requires-magnific');
  if (!['127.0.0.1', '::1'].includes(env.VC_BIND_HOST ?? '')) throw new Error('owner-test-requires-loopback');
  // the Cloudflare Tunnel is the one proxy the owner test runs behind (the site holds the same rule, web/src/core/paid-mode.ts): its header cannot be written by a caller
  if (env.VC_TRUST_PROXY !== undefined && env.VC_TRUST_PROXY !== '' && env.VC_TRUST_PROXY !== 'cloudflare') throw new Error('owner-test-forbids-trust-proxy');
  if (env.VC_DEMO_LINKS && (env.VC_MAIL !== 'resend' || !(env.VC_MAIL_ALLOW ?? '').trim())) throw new Error('owner-test-requires-mail-allowlist');
  return providerCaps(env);
}
