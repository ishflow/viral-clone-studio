'use client';

import { useState } from 'react';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { StepKey } from '@/data/ports';
import { Button, Icon } from '@/shared/ui';
import { AdminActionDialog } from '../admin-common/AdminActionDialog';
import { retryJob, returnCredits, settleUnknown } from './actions';

export type JobTarget = {
  id: string; email: string; templateTitle: string; credits: number; creditsReturned: number; balance: number;
  /** The stopped step: what the retry still has to make. */
  missing: { step: StepKey; count: number } | null;
};

/** "Retry job": runs a stopped job again. The customer is not charged. Asks first (the job, what is missing, the reason). */
export function RetryButton({ job, detail }: { job: JobTarget; detail?: boolean }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const missing = job.missing
    ? job.missing.step === 'clips'
      ? t('adminActions.value.clips', { count: job.missing.count })
      : t(`adminJobs.step.${job.missing.step}`)
    : null;
  return (
    <>
      <Button variant={detail ? 'primary' : 'secondary'} className={detail ? 'gap-2 max-nav:w-full' : 'gap-2'} onClick={() => setAsking(true)}>
        <Icon name="retry" size={20} />
        {t('adminActions.retry.confirm')}
      </Button>
      {asking && (
        <AdminActionDialog
          onClose={() => setAsking(false)}
          title={t('adminActions.retry.title')}
          rows={[
            { label: t('adminActions.row.user'), value: job.email },
            { label: t('adminActions.row.job'), value: job.templateTitle },
            ...(missing ? [{ label: t('adminActions.row.missing'), value: missing }] : []),
          ]}
          info={t('adminActions.retry.info')}
          confirmLabel={t('adminActions.retry.confirm')}
          perform={(reason) => retryJob({ jobId: job.id, reason })}
          doneNote={() => t('adminActions.retry.done')}
        />
      )}
    </>
  );
}

/** "Return credits": the credits the job was charged and not returned go back to the balance. No money is refunded. */
export function ReturnButton({ job, detail }: { job: JobTarget; detail?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  const [asking, setAsking] = useState(false);
  const toReturn = Math.max(0, job.credits - job.creditsReturned);
  return (
    <>
      <Button variant="secondary" className={detail ? 'max-nav:w-full' : undefined} onClick={() => setAsking(true)}>{t('adminActions.returnCredits.confirm')}</Button>
      {asking && (
        <AdminActionDialog
          onClose={() => setAsking(false)}
          title={t('adminActions.returnCredits.title')}
          rows={[
            { label: t('adminActions.row.job'), value: job.templateTitle },
            { label: t('adminActions.row.charged'), value: number.format(job.credits) },
            { label: t('adminActions.row.toReturn'), value: number.format(toReturn) },
            { label: t('adminActions.row.balanceAfter'), value: number.format(job.balance + toReturn) },
          ]}
          info={t('adminActions.returnCredits.info')}
          reasonHint="long"
          confirmLabel={t('adminActions.returnCredits.confirm')}
          perform={(reason, key) => returnCredits({ jobId: job.id, reason, key })}
          doneRows={(done) => [
            { label: t('adminActions.row.creditsReturned'), value: number.format(done.credits) },
            { label: t('adminActions.row.balanceAfter'), value: number.format(done.balanceAfter) },
          ]}
        />
      )}
    </>
  );
}

/** "Request never reached the provider": only on a job stopped with `submission-unknown`. The admin must have looked at the provider's task list; the confirmation says what a mistake costs. */
export function SettleUnknownButton({ job }: { job: JobTarget }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button variant="secondary" className="max-nav:w-full" onClick={() => setAsking(true)}>{t('adminActions.settleUnknown.confirm')}</Button>
      {asking && (
        <AdminActionDialog
          onClose={() => setAsking(false)}
          title={t('adminActions.settleUnknown.title')}
          rows={[
            { label: t('adminActions.row.user'), value: job.email },
            { label: t('adminActions.row.job'), value: job.templateTitle },
          ]}
          info={t('adminActions.settleUnknown.info')}
          confirmLabel={t('adminActions.settleUnknown.confirm')}
          confirmVariant="warn"
          perform={(reason) => settleUnknown({ jobId: job.id, reason })}
          doneNote={() => t('adminActions.settleUnknown.done')}
        />
      )}
    </>
  );
}
