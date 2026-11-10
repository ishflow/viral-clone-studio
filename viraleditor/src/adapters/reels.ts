// Public Reels use a small HTTPS-only downloader rather than yt-dlp's unrestricted redirect/manifest stack.
import { resolve4 } from 'node:dns/promises';
import { get } from 'node:https';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isIP } from 'node:net';
import type { Downloader } from '../ports.ts';

interface Reply { status: number; headers: Record<string, string>; body: Buffer }
export type ReelRequest = (url: URL, maxBytes: number) => Promise<Reply>;
const PAGE_BYTES = 2 * 1024 * 1024;
const VIDEO_BYTES = 100 * 1024 * 1024;
const PAGE_HOSTS = ['instagram.com', 'www.instagram.com'];
const CDN_HOSTS = ['cdninstagram.com', 'fbcdn.net'];

/** Resolve IPv4 only, deny every private/reserved range. Unsupported address families fail closed. */
export function publicAddress(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
function allowed(url: URL, page: boolean): boolean {
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (page) return PAGE_HOSTS.includes(url.hostname) && /^\/reels?\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
  return CDN_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

/** DNS answers are checked and pinned into the connection's lookup; DNS rebinding cannot select a different destination. */
export const requestReel: ReelRequest = async (url, maxBytes) => {
  const addresses = await resolve4(url.hostname, { ttl: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('reel-forbidden-address');
  const address = addresses[0]!.address;
  return new Promise<Reply>((resolve, reject) => {
    const request = get(url, { agent: false, family: 4, headers: { 'User-Agent': 'viraleditor-public-reel/1', 'Accept-Encoding': 'identity' },
      lookup: (_hostname, options, callback) => options.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4),
    }, response => {
      const status = response.statusCode ?? 0;
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(response.headers)) if (typeof value === 'string') headers[key] = value;
      if (status >= 300 && status < 400) { response.destroy(); resolve({ status, headers, body: Buffer.alloc(0) }); return; }
      if (status !== 200 || Number(headers['content-length']) > maxBytes || (headers['content-encoding'] && headers['content-encoding'] !== 'identity')) {
        response.destroy(); reject(new Error('reel-response-refused')); return;
      }
      const chunks: Buffer[] = []; let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) { response.destroy(); reject(new Error('reel-response-too-large')); }
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({ status, headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('reel-response-aborted')));
    });
    const deadline = setTimeout(() => request.destroy(new Error('reel-request-timeout')), 15_000);
    request.once('close', () => clearTimeout(deadline));
    request.once('error', reject);
  });
};

const decode = (text: string): string => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function meta(html: string, name: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) attributes.set(match[1]!.toLowerCase(), decode(match[3]!));
    if ((attributes.get('property') ?? attributes.get('name')) === name) return attributes.get('content') ?? null;
  }
  return null;
}

export async function reelVideo(value: string, toDir: string, request: ReelRequest = requestReel): Promise<Awaited<ReturnType<Downloader['video']>>> {
  let url = new URL(value);
  if (!allowed(url, true)) throw new Error('reel-unsupported');
  url = new URL(`https://www.instagram.com/reel/${url.pathname.split('/')[2]}/`);
  const bounded = async (first: URL, page: boolean): Promise<Buffer> => {
    let next = first;
    const limit = page ? PAGE_BYTES : VIDEO_BYTES;
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!allowed(next, page)) throw new Error('reel-forbidden-redirect');
      const reply = await request(next, limit);
      if (reply.body.length > limit) throw new Error('reel-response-too-large');
      if (reply.status >= 300 && reply.status < 400) {
        if (!reply.headers.location) throw new Error('reel-redirect-without-location');
        next = new URL(reply.headers.location, next); continue;
      }
      if (reply.status !== 200) throw new Error('reel-unavailable');
      return reply.body;
    }
    throw new Error('reel-too-many-redirects');
  };
  const html = (await bounded(url, true)).toString('utf8');
  const direct = meta(html, 'og:video:secure_url') ?? meta(html, 'og:video');
  if (!direct) throw new Error('reel-private-login-or-unavailable');
  const bytes = await bounded(new URL(direct), false);
  if (bytes.length < 12 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') throw new Error('reel-not-local-container');
  mkdirSync(toDir, { recursive: true });
  const file = join(toDir, 'source.mp4'); writeFileSync(file, bytes);
  return { file, title: meta(html, 'og:title') ?? '', seconds: 0, views: null, likes: null };
}
