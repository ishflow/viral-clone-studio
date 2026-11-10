import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reelVideo, publicAddress } from './reels.ts';
const dir = () => mkdtempSync(join(tmpdir(), 've-reel-'));
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(20)]);
const response = (body: Buffer | string, status = 200, headers: Record<string, string> = {}) => ({ status, headers, body: Buffer.from(body) });
const page = '<meta property="og:video" content="https://scontent.cdninstagram.com/a.mp4?x=1&amp;y=2"><meta property="og:title" content="Public Reel">';
describe('offline public Reel admission', () => {
  it('canonicalises the page and accepts a local MP4', async () => {
    const calls: string[] = [];
    const got = await reelVideo('https://instagram.com/reels/CODE/?utm=x', dir(), async (url, limit) => {
      calls.push(url.href); expect(limit).toBeGreaterThan(0);
      return response(calls.length === 1 ? page : mp4);
    });
    expect(calls).toEqual(['https://www.instagram.com/reel/CODE/', 'https://scontent.cdninstagram.com/a.mp4?x=1&y=2']);
    expect(readFileSync(got.file)).toEqual(mp4);
    expect(got).toMatchObject({ title: 'Public Reel', views: null, likes: null });
  });
  it('rejects login/private pages, unsupported URLs, forbidden redirects and playlist masquerades', async () => {
    for (const url of ['http://instagram.com/reel/x/', 'https://evilinstagram.com/reel/x/', 'https://x:y@instagram.com/reel/x/', 'https://instagram.com/p/x/']) await expect(reelVideo(url, dir(), async () => response(page))).rejects.toThrow();
    await expect(reelVideo('https://instagram.com/reel/x/', dir(), async () => response('<title>Login • Instagram</title>'))).rejects.toThrow();
    for (const target of ['https://127.0.0.1/x', 'https://10.0.0.1/x', 'file:///etc/passwd', 'https://www.instagram.com/accounts/login/']) await expect(reelVideo('https://instagram.com/reel/x/', dir(), async () => response('', 302, { location: target }))).rejects.toThrow();
    let calls = 0;
    await expect(reelVideo('https://instagram.com/reel/x/', dir(), async () => response(++calls === 1 ? page : '#EXTM3U\nhttps://private/x'))).rejects.toThrow();
  });
  it('blocks private, loopback, metadata, reserved and ambiguous address families', () => {
    for (const ip of ['0.0.0.0','10.0.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','198.18.0.1','224.0.0.1','::1','::ffff:127.0.0.1']) expect(publicAddress(ip)).toBe(false);
    expect(publicAddress('8.8.8.8')).toBe(true);
  });
});
