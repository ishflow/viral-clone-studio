// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sourceLink } from './source-link';

describe('sourceLink: the links an admin may queue for the catalog', () => {
  it.each([
    ['https://www.tiktok.com/@shop/video/7301234567890123456', 'https://www.tiktok.com/@shop/video/7301234567890123456'],
    ['https://www.tiktok.com/@shop/video/7301234567890123456?is_from_webapp=1&sender_device=pc#x', 'https://www.tiktok.com/@shop/video/7301234567890123456'],
    ['https://vm.tiktok.com/ZMabc123/?utm_source=copy', 'https://vm.tiktok.com/ZMabc123'],
    ['https://www.instagram.com/reel/CODE123/?igsh=abc', 'https://www.instagram.com/reel/CODE123'],
    ['https://instagram.com/reels/CODE123/', 'https://www.instagram.com/reel/CODE123'],
    ['https://www.youtube.com/watch?v=abcDEF12345&si=track&t=3s', 'https://www.youtube.com/watch?v=abcDEF12345'],
    ['https://www.youtube.com/shorts/abcDEF12345?feature=share', 'https://www.youtube.com/shorts/abcDEF12345'],
    ['https://youtu.be/abcDEF12345?si=track', 'https://youtu.be/abcDEF12345'],
    ['  https://m.youtube.com/watch?v=abcDEF12345  ', 'https://m.youtube.com/watch?v=abcDEF12345'],
  ])('%s → %s', (given, url) => {
    expect(sourceLink(given)?.url).toBe(url);
  });

  it('the same video by any of its links has one key; another video another', () => {
    const key = (value: string) => sourceLink(value)?.key;
    expect(key('https://youtu.be/abcDEF12345?si=x')).toBe(key('https://www.youtube.com/shorts/abcDEF12345'));
    expect(key('https://m.youtube.com/watch?v=abcDEF12345&t=9')).toBe(key('https://youtu.be/abcDEF12345'));
    expect(key('https://instagram.com/reels/CODE123/')).toBe(key('https://www.instagram.com/reel/CODE123/?igsh=1'));
    expect(key('https://www.tiktok.com/@a/video/111?x=1')).toBe(key('https://m.tiktok.com/@a/video/111'));
    expect(key('https://www.tiktok.com/@a/video/111')).not.toBe(key('https://www.tiktok.com/@a/video/112'));
    expect(key('https://youtu.be/abcDEF12345')).not.toBe(key('https://youtu.be/abcDEF12346'));
  });

  it.each([
    ['http, not https', 'http://www.tiktok.com/@a/video/1'],
    ['a host that only ends like an allowed one', 'https://eviltiktok.com/@a/video/1'],
    ['a subdomain nobody listed', 'https://evil.tiktok.com/@a/video/1'],
    ['an allowed name inside another host', 'https://tiktok.com.evil.example/@a/video/1'],
    ['another site', 'https://example.com/watch?v=abc'],
    ['an address with a port', 'https://www.tiktok.com:8443/@a/video/1'],
    ['an address with a user', 'https://user:pw@www.tiktok.com/@a/video/1'],
    ['a backslash the downloader would read as another host', 'https://www.tiktok.com\\@evil.com/'],
    ['a space inside', 'https://www.tiktok.com/@a/video/1 2'],
    ['no page, only the site', 'https://www.tiktok.com/'],
    ['a watch page with no video', 'https://www.youtube.com/watch'],
    ['an address of a local machine', 'https://localhost/watch?v=abcDEF12345'],
    ['not an address', 'tiktok.com/@a/video/1'],
    ['empty', ''],
    ['too long', `https://www.tiktok.com/@a/video/${'1'.repeat(3000)}`],
  ])('refuses %s', (_why, value) => {
    expect(sourceLink(value)).toBeNull();
  });
});
