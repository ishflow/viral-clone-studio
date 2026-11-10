// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseVideoLink } from './video-link';

describe('parseVideoLink', () => {
  it.each(['https://tiktok.com\\@evil.com/x', 'https://www.tiktok.com/@a/video/1\n--exec', 'https://youtu.be/abc def', 'https://youtu.be/a\u0000b'])(
    'rejects a spelling the downloader could read as another host or as more arguments: %j',
    (url) => {
      expect(parseVideoLink(url)).toEqual({ ok: false });
    },
  );
  it('hands on the canonical href (host lower-cased)', () => {
    expect(parseVideoLink('  https://WWW.YouTube.com/watch?v=1  ')).toEqual({ ok: true, url: 'https://www.youtube.com/watch?v=1' });
  });
  it.each([
    'https://www.tiktok.com/@a/video/1', 'https://vm.tiktok.com/abc', 'https://youtube.com/shorts/x', 'https://www.youtube.com/watch?v=1', 'https://youtu.be/abc',
  ])('accepts %s', (url) => {
    expect(parseVideoLink(url)).toEqual({ ok: true, url });
  });
  it.each(['https://user:pw@www.tiktok.com/@a/video/1', 'https://user@youtu.be/abc', 'https://www.tiktok.com:8443/@a/video/1', 'https://youtu.be:80/abc'])(
    'rejects a link with credentials or a port: %s',
    (url) => {
      expect(parseVideoLink(url)).toEqual({ ok: false });
    },
  );
  it('refuses a link longer than 2048 characters, and takes one of exactly that length', () => {
    const url = (length: number) => `https://www.youtube.com/watch?v=${'a'.repeat(length - 'https://www.youtube.com/watch?v='.length)}`;
    expect(parseVideoLink(url(3000))).toEqual({ ok: false });
    expect(parseVideoLink(url(2048))).toEqual({ ok: true, url: url(2048) });
  });
  it.each(['', 'tiktok.com/x','http://tiktok.com/x', 'https://evil-youtube.com/x', 'https://youtube.com.evil.io/x', 'https://example.com', 'javascript:alert(1)'])(
    'rejects %s',
    (url) => {
      expect(parseVideoLink(url)).toEqual({ ok: false });
    },
  );
});
