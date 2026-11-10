'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { Button } from '@/shared/ui';
import { sendEmailAgain } from './actions';

/** One row of the delivery page: puts a failed or blocked email back in the queue. */
export function SendAgainButton({ emailId }: { emailId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => start(async () => {
          try { await sendEmailAgain(emailId); setError(false); router.refresh(); } catch { setError(true); }
        })}
      >
        {t('emails.delivery.sendAgain')}
      </Button>
      {error && <span role="alert" className="text-13 text-warn">{t('emails.delivery.sendAgainFailed')}</span>}
    </span>
  );
}
