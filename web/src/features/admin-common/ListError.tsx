'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { Button, Icon } from '@/shared/ui';

/** "Could not load this list." with "Try again": nothing was changed. For a table's `error` and for the admin error page. */
export function ListError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-col items-center gap-4">
      <p className="m-0 flex items-center gap-2 text-15 font-semibold text-warn">
        <Icon name="warning" size={18} />
        {t('adminActions.list.errorTitle')}
      </p>
      <p className="m-0 max-w-md text-15 leading-normal text-text-2 text-pretty">{t('adminActions.list.errorText')}</p>
      <Button variant="secondary" onClick={onRetry}>{t('adminActions.list.retry')}</Button>
    </div>
  );
}
