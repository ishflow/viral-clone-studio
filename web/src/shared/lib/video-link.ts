import { z } from 'zod';

const HOSTS = ['tiktok.com', 'youtube.com', 'youtu.be'];
/** The longest link taken: a link a person copies from the app is far shorter, and the field must not carry a page of text on to the check. */
const MAX_LENGTH = 2048;

const link = z
  .string()
  .trim()
  .pipe(z.url({ protocol: /^https$/ }))
  .refine((value) => {
    try {
      const url = new URL(value);
      // A link with a user, a password or a port is not one a person copies from the app (the default port 443 is dropped by `URL`).
      if (url.username !== '' || url.password !== '' || url.port !== '') return false;
      const host = url.hostname.toLowerCase();
      return HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
    } catch {
      return false;
    }
  });

/** A video the site can read: an https link whose host is (a subdomain of) tiktok.com, youtube.com or youtu.be. */
export function parseVideoLink(value: string): { ok: true; url: string } | { ok: false } {
  const parsed = link.safeParse(value);
  // A backslash or a control character is read differently by `URL` and by the downloader's parser (`https://tiktok.com\@evil.com/`
  // is host tiktok.com to one and evil.com to the other): refuse them, and hand on the canonical `href`, never the raw string.
  if (!parsed.success || value.trim().length > MAX_LENGTH || /[\\\u0000-\u0020\u007f]/.test(value.trim())) return { ok: false };
  return { ok: true, url: new URL(parsed.data).href };
}
