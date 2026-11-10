import { ownerTestConfig as sharedOwnerTestConfig, type ProviderCaps, type ProviderEnv } from '../../../viraleditor/src/robust/provider-policy';

/**
 * Paid mode: the worker and the site run with the same `VC_PROVIDER=magnific` (the runbook gives both the same env). Then real money
 * and real accounts are involved, and the demo stand-ins must not exist: the fake provider page and its Pay / Decline, the bare
 * "I opened the link" self-verification, and "Continue with Google" without a provider. Unset (the default: e2e, the demo) = fake mode.
 * Read on every call, not once at import, so a test can switch it.
 */
export function isPaidMode(): boolean {
  return process.env.VC_PROVIDER === 'magnific';
}

/**
 * The demo aids that stand in for a mail inbox: the reset link on the "sent" page and "I opened the link". They hand out a token
 * to whoever asks, so they exist only where nobody else can reach the site: never in paid mode, and not in a production build
 * unless the owner opts in with `VC_DEMO_LINKS=1` (the demo on the owner's own Mac). A test run / `next dev` has them.
 * The opt-in counts only on that Mac alone: the site is bound to a loopback address (`VC_BIND_HOST`, the address `ops/run.sh` starts
 * it on) and no proxy stands in front (`VC_TRUST_PROXY` is empty). An address the process was not told about counts as public.
 */
export function demoAidsAllowed(): boolean {
  if (process.env.VC_MAIL === 'resend' || isPaidMode()) return false;
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.VC_DEMO_LINKS === '1' && ['127.0.0.1', '::1'].includes(process.env.VC_BIND_HOST ?? '') && !process.env.VC_TRUST_PROXY;
}

/** Real mail with a list that lets strangers in: `*`, a whole domain, or nothing a full address stands in. */
const mailOpenToStrangers = (env: ProviderEnv): boolean => env.VC_MAIL === 'resend' && (env.VC_MAIL_ALLOW ?? '').split(',').some((entry) => !entry.includes('@'));

/**
 * The owner test on the site: the shared policy (the worker reads it too), and one rule of the site's own. The policy lets one proxy
 * stand in front, the Cloudflare Tunnel (`VC_TRUST_PROXY=cloudflare`), whose header a caller cannot write; the loopback bind it asks
 * for is the same one that header is believed on (`rate-limit/trusted-proxy.ts`).
 *
 * The site's own rule, one forbidden combination: the owner test spends real Magnific money and keeps the fake pay page open (Dodo's test card is as
 * free), so the mail list is the only door. It must name the invited people one by one; with `*` or a domain any stranger verifies
 * an address, takes credit nobody paid for and generates. Whatever `VC_PAYMENTS` says: no mode of it closes that page here.
 */
export function ownerTestConfig(env: ProviderEnv): ProviderCaps | null {
  const caps = sharedOwnerTestConfig(env);
  if (caps && mailOpenToStrangers(env)) throw new Error('owner-test-forbids-open-mail-allowlist');
  return caps;
}
export function isOwnerTestMode(): boolean { return process.env.VC_OWNER_TEST === '1'; }
