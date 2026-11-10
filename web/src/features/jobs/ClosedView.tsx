'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { RULES, type Job } from '@/data/ports';
import { formatCredits } from '@/shared/lib/format';
import { LinkButton, StatusLine } from '@/shared/ui';
import { SummaryRows } from './SummaryRows';

/**
 * `A-Is-Kapatildi`: the job was closed by the customer ("Stop the job here") or closed itself after 30 days. The credits came back when it
 * stopped, nothing else is charged; there is no stage list. A free job names the free video instead of credits.
 * A person swap that never started (`swap.review` rejected) is not "closed" to its customer: it was not approved (by the admin, or
 * by nobody in time) or the customer cancelled it, and every credit came back. While person swap is switched off (`swapOpen` false) it
 * links to no page of person swap: there is none.
 */
export function ClosedView({ job, balance, swapOpen = true }: { job: Job; balance: number; swapOpen?: boolean }) {
  const t = useT();
  const expired = job.closedReason === 'expired';
  const free = job.freeVideo && job.creditsReturned === 0;
  const count = job.creditsReturned;
  const refused = job.swap?.review === 'rejected' ? (job.closedReason === 'customer' ? 'customer' : expired ? 'expired' : 'admin') : null;
  const title = refused ? t(`jobs.swap.rejected.title.${refused}`) : t('jobs.closed.title');
  const body = refused
    ? t(`jobs.swap.rejected.body.${refused}`, { count, hours: RULES.swapReviewHours })
    : free
    ? t(expired ? 'jobs.closed.expiredFree' : 'jobs.closed.bodyFree', { days: RULES.stoppedKeptDays })
    : t(expired ? 'jobs.closed.expired' : 'jobs.closed.body', { count, days: RULES.stoppedKeptDays });
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <StatusLine kind="closed">{refused ? title : t('common.status.closed')}</StatusLine>
        <h1 className="m-0 heading-3">{job.templateTitle}</h1>
      </section>
      <section aria-label={title} className="box-border flex max-w-160 flex-col gap-6 rounded-16 border border-edge bg-surface p-4 nav:p-6">
        <div className="flex flex-col gap-2">
          <h2 className="m-0 heading-5">{title}</h2>
          <p className="m-0 text-15 leading-normal text-text-2">{body}</p>
        </div>
        {!free && (
          <SummaryRows
            rows={[
              [t('jobs.summary.charged'), formatCredits(job.credits, t)],
              [t('jobs.summary.returned'), formatCredits(job.creditsReturned, t)],
              [t('jobs.closed.balanceNow'), formatCredits(balance, t)],
            ]}
          />
        )}
        <p className="m-0 text-13 leading-normal text-text-3">{t(refused ? 'jobs.swap.rejected.deleted' : 'jobs.closed.deleted')}</p>
        {(!refused || swapOpen) && (
          <LinkButton href={refused ? '/swap' : '/gallery'} variant="secondary" className="self-start max-nav:self-stretch">
            {t(refused ? 'jobs.swap.rejected.another' : 'jobs.closed.another')}
          </LinkButton>
        )}
      </section>
    </div>
  );
}
