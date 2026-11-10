import { getI18n } from '@/core/i18n/server';
import { LinkButton } from '@/shared/ui';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('notFound');

/** Inside the admin layout that already draws the header and `<main>`: only the body of the page, in the words of the admin panel. */
export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-12 text-center">
      <p className="m-0 font-display text-[clamp(112px,8.4vw,128px)] leading-[0.8] font-extrabold tracking-[-0.05em] text-accent-text">404</p>
      <h1 className="m-0 heading-3">{t('common.notFound.title')}</h1>
      <p className="m-0 max-w-115 text-17 leading-normal text-text-2">{t('common.notFound.adminText')}</p>
      <LinkButton href="/admin" size="l" className="self-stretch nav:self-auto">
        {t('common.notFound.adminBack')}
      </LinkButton>
    </div>
  );
}
