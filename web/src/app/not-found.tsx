import { getI18n } from '@/core/i18n/server';
import { LinkButton, SkipLink } from '@/shared/ui';
import { SessionHeader } from '@/shared/ui/SessionHeader';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('notFound');

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <div className="page-gutter flex min-h-screen flex-col bg-bg pb-12 text-text">
      <SkipLink />
      <div className="mx-auto flex w-full max-w-330 flex-1 flex-col">
        <SessionHeader />
        <main id="main" className="flex flex-1 flex-col items-center justify-center gap-6 py-12 text-center">
          <p className="m-0 font-display text-[clamp(112px,8.4vw,128px)] leading-[0.8] font-extrabold tracking-[-0.05em] text-accent-text">404</p>
          <h1 className="m-0 heading-3">{t('common.notFound.title')}</h1>
          <p className="m-0 max-w-115 text-17 leading-normal text-text-2">{t('common.notFound.text')}</p>
          <LinkButton href="/gallery" size="l" className="self-stretch nav:self-auto">
            {t('common.notFound.back')}
          </LinkButton>
        </main>
      </div>
    </div>
  );
}
