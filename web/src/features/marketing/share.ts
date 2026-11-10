import type { Metadata } from 'next';
import { SITE } from '@/core/config';
import { getI18n } from '@/core/i18n/server';

/** The site's `app/opengraph-image`. A page that sets its own card does not inherit the picture of the root, so each card names it. */
const PICTURE = '/opengraph-image';

/**
 * What a link to a public page shows when it is shared: the description (search and chat previews) and the Open Graph and Twitter
 * cards. The picture is the site's `opengraph-image`. Nothing here promises a free video or a way in: a visitor may not be able to sign up.
 */
export async function shareMetadata(page: 'home' | 'pricing'): Promise<Metadata> {
  const { t } = await getI18n();
  const title = page === 'home' ? `${SITE.name}: ${t('marketing.home.heroLead')} ${t('marketing.home.heroAccent')}` : `${t('titles.pricing')} · ${SITE.name}`;
  const description = t(`marketing.meta.${page}`);
  return {
    description,
    openGraph: { type: 'website', siteName: SITE.name, title, description, images: [{ url: PICTURE, width: 1200, height: 630, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: [PICTURE] },
  };
}
