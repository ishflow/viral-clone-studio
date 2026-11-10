import { getI18n } from '@/core/i18n/server';
import { LinkButton, SkipLink } from '@/shared/ui';
import { SessionHeader } from '@/shared/ui/SessionHeader';
import { StatusPage } from '@/shared/ui/StatusPage';

/**
 * A-Yetki-Yok: a signed-in customer on a page that is not for them. Used by `forbidden()`, which needs `experimental.authInterrupts` in
 * next.config.ts (not in this task's paths) and a call in `requireAdmin` (core/session/guards.ts, not either): until then `requireAdmin`
 * answers 404 and this page is not reached.
 */
export default async function Forbidden() {
  const { t } = await getI18n();
  return (
    <div className="page-gutter flex min-h-screen flex-col bg-bg pb-12 text-text">
      <SkipLink />
      <div className="mx-auto flex w-full max-w-330 flex-1 flex-col">
        <SessionHeader />
        <main id="main" className="flex flex-1 flex-col items-center justify-center py-12">
          <StatusPage icon="private" title={t('common.forbidden.title')}>
            <LinkButton href="/gallery" size="l">{t('common.forbidden.back')}</LinkButton>
          </StatusPage>
        </main>
      </div>
    </div>
  );
}
