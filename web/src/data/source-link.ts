/**
 * The links an admin may queue for the catalog in bulk. Stricter than a customer's link (`shared/lib/video-link.ts`): the host must be
 * one of these exactly (a look-alike or an unlisted subdomain is refused), because the worker fetches the address the admin pasted.
 * Plain data and no Node module: the data layer and the admin's action both read it.
 */
const HOSTS = {
  tiktok: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
  instagram: ['instagram.com', 'www.instagram.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
} as const;
type Site = keyof typeof HOSTS;
const MAX_LENGTH = 2048;
const ID = '[A-Za-z0-9_-]+';

const siteOf = (host: string): Site | null => (Object.keys(HOSTS) as Site[]).find((site) => (HOSTS[site] as readonly string[]).includes(host)) ?? null;

/**
 * The link as the catalog keeps it (`url`: https, no tracking parameter, no fragment) and what two links of one video share (`key`),
 * or null when it is not a link the catalog takes.
 */
export function sourceLink(value: string): { url: string; key: string } | null {
  const text = value.trim();
  // A backslash or a control character is read differently by `URL` and by the downloader's parser: refuse them.
  if (text === '' || text.length > MAX_LENGTH || /[\\\u0000- \u007f]/.test(text)) return null;
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return null;
  const host = url.hostname.toLowerCase();
  const site = siteOf(host);
  if (site === null) return null;
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '') return null;

  if (site === 'youtube') {
    const id = host === 'youtu.be' ? new RegExp(`^/(${ID})$`).exec(path)?.[1]
      : path === '/watch' ? url.searchParams.get('v')?.match(new RegExp(`^${ID}$`))?.[0]
        : new RegExp(`^/shorts/(${ID})$`).exec(path)?.[1];
    if (!id) return null;
    const canonical = host === 'youtu.be' ? `https://youtu.be/${id}` : path === '/watch' ? `https://${host}/watch?v=${id}` : `https://${host}/shorts/${id}`;
    return { url: canonical, key: `youtube:${id}` };
  }
  if (site === 'instagram') {
    const id = new RegExp(`^/(?:reels?|p)/(${ID})$`).exec(path)?.[1];
    return id ? { url: `https://www.instagram.com/reel/${id}`, key: `instagram:${id}` } : null;
  }
  const id = new RegExp(`^/@[^/]+/video/(\\d+)$`).exec(path)?.[1];
  // A short address (`vm.tiktok.com/…`) names no video in itself: its path is its identity.
  return { url: `https://${host}${path}`, key: id ? `tiktok:${id}` : `tiktok:${host}${path}` };
}
