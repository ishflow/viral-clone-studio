type Env = Record<string, string | undefined>;

/**
 * `VC_TRUST_PROXY=cloudflare`: a Cloudflare Tunnel stands in front of the site. Cloudflare writes the caller's address in
 * `cf-connecting-ip` itself and replaces whatever the caller sent under that name; to `x-forwarded-for` it only adds, so the first
 * part of that header stays the caller's own word and is never read here.
 *
 * The assumption this rests on: the tunnel is the only way in. The site listens on a loopback address (`VC_BIND_HOST`, the address
 * `ops/run.sh` starts it on) and `cloudflared` on the same Mac is the one program that sends it requests. A site bound to any other
 * address, or one that was not told its address, can be reached past Cloudflare, where the header is anybody's word: then it is not believed.
 */
export const CLOUDFLARE = 'cloudflare';

export function cloudflareInFront(env: Env = process.env): boolean {
  return env.VC_TRUST_PROXY === CLOUDFLARE && ['127.0.0.1', '::1'].includes(env.VC_BIND_HOST ?? '');
}

/** Cloudflare named as the proxy of a site it is not the only door of: the start-up check refuses this instead of quietly sharing one bucket. */
export function checkTrustedProxy(env: Env = process.env): void {
  if (env.VC_TRUST_PROXY === CLOUDFLARE && !cloudflareInFront(env)) throw new Error('cloudflare-proxy-requires-loopback');
}
