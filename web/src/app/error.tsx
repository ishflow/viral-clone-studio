'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { Button, LinkButton, SkipLink } from '@/shared/ui';
import { HeaderVisitor } from '@/shared/ui/HeaderVisitor';
import { StatusPage } from '@/shared/ui/StatusPage';

/**
 * A-Hata-Servis: a page threw. The visitor header (a client component) because the session is not known to be readable after an error; for the same reason its phone menu makes no first-video-free promise (`freeOffer={false}`): the admin setting is not read here.
 * The note says what to check first when money or a video may be in flight. It never says "nothing was charged" (R6).
 */
export default function ServiceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  return (
    <div className="page-gutter flex min-h-screen flex-col bg-bg pb-12 text-text">
      <SkipLink />
      <div className="mx-auto flex w-full max-w-330 flex-1 flex-col">
        <HeaderVisitor freeOffer={false} />
        <main id="main" className="flex flex-1 flex-col items-center justify-center py-12">
          <StatusPage icon="warning" title={t('common.serviceError.title')} note={t('common.serviceError.note')}>
            <Button size="l" onClick={reset}>{t('common.serviceError.retry')}</Button>
            <LinkButton href="/contact" variant="secondary" size="l">{t('common.serviceError.support')}</LinkButton>
          </StatusPage>
        </main>
      </div>
    </div>
  );
}
