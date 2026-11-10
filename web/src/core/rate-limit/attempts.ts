import { headers } from 'next/headers';
import { LIMITS, limiter, rulesFor, type LimitedAction, type Rule } from './rate-limit';
import { callerBucket } from './caller-bucket';
import { cloudflareInFront } from './trusted-proxy';

/**
 * Who is calling. The forwarding headers are the caller's own words unless a proxy of ours sets them, so they are trusted only with
 * `VC_TRUST_PROXY=1` (the site runs behind `tailscale serve` / a reverse proxy that overwrites them) or, behind a Cloudflare Tunnel,
 * with `VC_TRUST_PROXY=cloudflare`: then only `cf-connecting-ip` is read (`trusted-proxy.ts` says why, and what it assumes).
 * Otherwise every caller is 'local': one shared bucket, which `attemptAllowed` gives wider limits (a flood guard) so one script
 * cannot lock everyone out.
 */
export async function clientKey(): Promise<{ key: string; shared: boolean }> {
  const cloudflare = cloudflareInFront();
  if (!cloudflare && process.env.VC_TRUST_PROXY !== '1') return { key: 'local', shared: true };
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
    const key = cloudflare ? callerBucket(h.get('cf-connecting-ip')) : forwarded || h.get('x-real-ip')?.trim();
    return key ? { key, shared: false } : { key: 'local', shared: true };
  } catch {
    return { key: 'local', shared: true };
  }
}

/** The shared bucket sees every caller: ten times the per-caller numbers. */
const SHARED_FACTOR = 10;
/**
 * The shared caller rule of an attempt that also has an address rule: a ceiling, not the limit. A hundred times the per-caller numbers
 * (log-in 1000 in ten minutes, reset / new password / resend 1000 an hour): far past what the people of one site send, so the first
 * small script does not lock them out, and low enough that the limiter's memory (`MAX_KEYS`, 10 000) is never filled from here:
 * at most about 4 100 keys can be alive, so nobody's address rule is pushed out by a script that rotates addresses.
 */
const SHARED_CEILING_FACTOR = 100;

/** Log-in attempts on one address by all callers together, when callers are told apart: the same number as `RULES.loginEmailAttempts`. */
const LOGIN_ADDRESS_CEILING = 20;

/**
 * The log-in rules when callers are told apart (RP1 Ö2). The address rule is counted per caller, so the attempts of a stranger stop
 * the stranger and not the owner of the address; the address itself keeps a wider count for all callers together, the ceiling against
 * guessing from many callers. An address is lower case, so the capitals can only be the separator: no address is another one's pair.
 */
function ownLogInRules(rules: Rule[], caller: string): Rule[] {
  const [own, address] = rules;
  if (!own || !address) return rules;
  return [own, { ...address, key: `${address.key} FROM ${caller.slice(0, 128)}` }, { ...address, max: LOGIN_ADDRESS_CEILING }];
}

/**
 * Sign-ups of all callers together, whether callers are told apart or not. The caller rule bounds one caller, so somebody with many
 * addresses could otherwise try the guest list (`invite.ts`) without end. Fifty an hour: the number the shared bucket already allows
 * where callers are not told apart, and room for ten people who each use up their own five in the same hour. The price: whoever fills
 * it closes sign-up (not log-in, not reset) for everybody until the hour moves on. Pinned: the limiter's hard cap drops the oldest
 * keys, and this one is among the oldest, so log-in attempts from many addresses would otherwise empty it.
 */
const SIGN_UP_CEILING: Rule = { key: 'signUp:all', max: LIMITS.signUp.key.max * SHARED_FACTOR, windowMs: LIMITS.signUp.key.windowMs, pinned: true };

/**
 * May this anonymous attempt go on? False: answer with the "too many attempts" state and call nothing else.
 * In the shared bucket the caller rule is widened, never dropped: a caller picks the address (and a reset link is no address at all),
 * so the address rule alone bounds nothing. An attempt with an address rule gets the ceiling: the address rule already stops the
 * guessing, and one script filling a narrow shared bucket would stop everybody's log-in and reset. The contact form is the
 * exception: its address is typed by the sender and every message is kept, so it keeps the narrower flood guard.
 * A sign-up is also asked against `SIGN_UP_CEILING`, in the same call: a caller refused by its own rule adds nothing to the ceiling.
 */
export async function attemptAllowed(action: LimitedAction, email?: string): Promise<boolean> {
  const { key, shared } = await clientKey();
  const rules = rulesFor(action, key, email);
  const ceiling = action === 'signUp' ? [SIGN_UP_CEILING] : [];
  if (!shared) return limiter.allow([...(action === 'logIn' ? ownLogInRules(rules, key) : rules), ...ceiling]);
  const factor = rules.length > 1 && action !== 'contact' ? SHARED_CEILING_FACTOR : SHARED_FACTOR;
  return limiter.allow([...rules.map((r, i) => (i === 0 ? { ...r, max: r.max * factor } : r)), ...ceiling]);
}
