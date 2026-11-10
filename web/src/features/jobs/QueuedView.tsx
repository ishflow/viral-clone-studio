'use client';

import { unstable_rethrow, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { RULES, type Job } from '@/data/ports';
import { Button, Icon, StatusLine } from '@/shared/ui';
import { closeJob } from './actions';
import { AutoRefresh } from './AutoRefresh';
import { JobNotice } from './JobNotice';
import { StageList } from './StageList';
import { leadOf } from './steps';

/**
 * A person swap whose photographs an admin looks at first: charged, and nothing is made before the admin's yes. The card says who is
 * waited for and for how long at most, and the owner can give the wait up: the job ends and everything it was charged comes back.
 */
function ReviewCard({ jobId }: { jobId: string }) {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'pending' | 'failed'>('idle');
  const cancel = async () => {
    setState('pending');
    try {
      const outcome = await closeJob(jobId);
      if (outcome.status !== 'ok') return setState('failed');
      router.refresh();
    } catch (error) {
      unstable_rethrow(error);
      setState('failed');
    }
  };
  return (
    <section
      aria-label={t('jobs.swap.review.section')}
      className="order-first box-border flex min-w-0 flex-[1_1_480px] flex-col gap-3 rounded-16 border border-edge bg-surface p-4 nav:order-none nav:p-6"
    >
      <h2 className="m-0 heading-5">{t('jobs.swap.review.title')}</h2>
      <p className="m-0 text-15 leading-normal text-text-2">{t('jobs.swap.review.body', { hours: RULES.swapReviewHours })}</p>
      <p className="m-0 text-15 leading-normal text-text-2">{t('jobs.swap.review.refund')}</p>
      <p className="m-0 text-13 leading-normal text-text-3">{t('jobs.swap.review.note')}</p>
      {state === 'failed' && (
        <p role="alert" className="m-0 flex items-start gap-2 text-13 leading-snug text-warn">
          <Icon name="warning" size={16} className="mt-px flex-none" />
          {t('jobs.swap.review.failed')}
        </p>
      )}
      <Button variant="secondary" pending={state === 'pending'} onClick={() => void cancel()} className="self-start max-nav:self-stretch">
        {t('jobs.swap.review.cancel')}
      </Button>
    </section>
  );
}

/** `A-Is-Kuyrukta`: charged and confirmed, waiting for a slot. Nothing to do; the page refreshes itself and turns into the progress page. */
export function QueuedView({ job, seconds }: { job: Job; seconds?: number }) {
  const t = useT();
  const line = job.status === 'running' ? job.engineQueue : null;
  const review = job.swap?.review === 'waiting';
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <StatusLine kind="queued">{t(review ? 'jobs.swap.review.status' : 'common.status.queued')}</StatusLine>
        <h1 className="m-0 heading-3">{job.templateTitle}</h1>
        <p className="m-0 text-15 text-text-2">
          {leadOf(t, job, seconds)}
        </p>
      </section>
      <AutoRefresh />
      {job.paused && (
        <JobNotice tone="warn" icon="warning">
          {t('jobs.notice.paused')}
        </JobNotice>
      )}
      <div className="flex flex-wrap items-start gap-x-12 gap-y-8">
        <StageList steps={job.steps} swap={Boolean(job.swap)} />
        {review ? <ReviewCard jobId={job.id} /> : <section
          aria-label={t('jobs.queued.section')}
          className="order-first box-border flex min-w-0 flex-[1_1_480px] flex-col gap-3 rounded-16 border border-edge bg-surface p-4 nav:order-none nav:p-6"
        >
          <h2 className="m-0 heading-5">{t('jobs.queued.title')}</h2>
          <p className="m-0 text-15 leading-normal text-text-2">{t('jobs.queued.body')}</p>
          {line && (
            <p className="m-0 font-display text-24 font-bold">
              {line.ahead === 0 || line.waitMinutes === 0 ? t('common.queue.soon') : t('common.queue.waiting', { count: line.ahead, minutes: line.waitMinutes })}
            </p>
          )}
          {job.queuePosition !== null && <p className="m-0 font-display text-24 font-bold">{t('jobs.queued.position', { position: job.queuePosition })}</p>}
          <p className="m-0 text-13 leading-normal text-text-3">{t('jobs.queued.note')}</p>
        </section>}
      </div>
    </div>
  );
}
