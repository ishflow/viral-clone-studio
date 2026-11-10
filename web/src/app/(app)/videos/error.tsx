'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { Button, EmptyState, LinkButton } from '@/shared/ui';

// How many times "Try again" was pressed and the list failed again. From the second failure on, "Contact support" is offered next to it.
// Module state: it lives until the page is reloaded, which is also when a new attempt starts fresh.
let retries = 0;

/** `A-Uretimlerim-Durumlar`, the list could not be loaded: what happened, that nothing was lost, and the way to try again. */
export default function VideosError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  return (
    <EmptyState
      title={t('videos.error.title')}
      text={t('videos.error.text')}
      action={
        <div className="flex flex-wrap justify-center gap-3 max-nav:self-stretch">
          <Button
            onClick={() => {
              retries += 1;
              reset();
            }}
          >
            {t('videos.error.retry')}
          </Button>
          {retries >= 1 && (
            <LinkButton href="/contact" variant="secondary">
              {t('videos.error.contact')}
            </LinkButton>
          )}
        </div>
      }
    />
  );
}
