import type { MetadataRoute } from 'next';
import { SITE } from '@/core/config';
import { siteOrigin } from '@/core/site-origin';
import { LEGAL_DOCS } from '@/features/marketing/legal';

/** The pages anyone can open without signing in. The language follows the visitor (cookie, then browser), so one address serves both. */
const PUBLIC_PATHS = ['/', '/pricing', '/gallery', '/contact', ...LEGAL_DOCS.map((doc) => `/legal/${doc}`)];

/** `/sitemap.xml`, on the host the visitor used: the same address the share card is served at. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = (await siteOrigin())?.origin ?? `https://${SITE.domain}`;
  return PUBLIC_PATHS.map((path) => ({ url: `${origin}${path}` }));
}
