'use client';

import { useState, useTransition } from 'react';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { Job, ResumeQuote, StopReason } from '@/data/ports';
import { formatCredits, formatDate } from '@/shared/lib/format';
import { cx } from '@/shared/lib/cx';
import { LinkButton, StatusLine } from '@/shared/ui';
import { closeJob, resumeJob } from './actions';
import { CloseDialog } from './CloseDialog';
import { ResumeDialog, type ResumeOption } from './ResumeDialog';
import { StageList } from './StageList';
import { counted, leadOf, stepOf } from './steps';
import { SummaryRows } from './SummaryRows';

// Every code has a title of its own; `clips-failed` also counts the clips and names what is saved. The compiler holds this to the
// whole union. A code the union does not know (an older or newer engine) gets the generic title.
const OWN_TITLE = {
  'adaptation-failed': true, 'images-failed': true, 'audio-failed': true, 'render-failed': true, 'submission-unknown': true,
  'estimate-exceeded': true, 'llm-invalid': true, 'template-missing': true, 'engine-error': true, 'content-rule': true,
} satisfies Record<Exclude<StopReason, 'clips-failed'>, true>;
const hasOwnTitle = (code: string | null) => code !== null && Object.hasOwn(OWN_TITLE, code);
// A person swap the provider refused the photograph of, or whose person was not found, is told in words of its own (a job of the same
// reason as any other would count clips it has not got). The data layer lets neither be continued by its owner: a new job is the way on.
const SWAP_OWN = { 'photo-refused': 'photoRefused', 'person-missing': 'personMissing' } as const;
const swapStopOf = (detail: Job['stoppedDetail']) => (detail && Object.hasOwn(SWAP_OWN, detail) ? SWAP_OWN[detail as keyof typeof SWAP_OWN] : null);

/**
 * `A-Is-Durdu`: what happened, what came back, and what the customer can do about it.
 * Neither continue option spends anything on the click: each opens the confirmation (what is generated, the cost, the balance), and only
 * "Confirm and continue" reaches the one resume path, with the cost that was shown. "Stop the job here" asks too. A job stopped by the
 * content rules cannot be continued (B12): it shows no option at all, only the way to the support. Neither can one that stopped on a
 * request the provider gave no clear answer to: we check it ourselves, and a paid click would only stop again at once. Nor can a person
 * swap while person swap is switched off (`swapOpen` false): the page says so, and that nothing more is charged.
 */
export function StoppedView({ job, quote: given, seconds, swapOpen = true }: { job: Job; quote: ResumeQuote; seconds?: number; swapOpen?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [option, setOption] = useState<ResumeOption | null>(null);
  const [closing, setClosing] = useState<'asking' | 'failed' | null>(null);
  const [notice, setNotice] = useState<'changed' | 'error' | 'provider-cap' | null>(null);
  // The server's latest word on the cost and the balance, once it has answered; until then, what the page was rendered with.
  const [answer, setAnswer] = useState<{ cost: number; balance: number } | null>(null);
  const quote: ResumeQuote = answer
    ? {
        ...given,
        cost: answer.cost,
        balance: answer.balance,
        enough: answer.balance >= answer.cost,
        coveredByFreeVideo: given.coveredByFreeVideo && answer.cost === 0,
        freeUsedElsewhere: given.freeUsedElsewhere || (given.coveredByFreeVideo && answer.cost > 0),
      }
    : given;
  const clips = stepOf(job, 'clips');
  const missing = Math.max(1, clips.total - clips.done);
  const known = job.stoppedReason === 'clips-failed';
  const contentRule = job.stoppedReason === 'content-rule';
  const checking = job.stoppedReason === 'submission-unknown';
  const resumable = quote.resumable && !contentRule && !checking;
  const free = given.coveredByFreeVideo;
  const swapStop = swapStopOf(job.stoppedDetail);
  const swapOff = Boolean(job.swap) && !swapOpen;
  const title = swapOff
    ? t('jobs.swap.stopped.off.title')
    : swapStop
    ? t(`jobs.swap.stopped.${swapStop}.title`)
    : known
    ? counted(t, 'jobs.reason.clips-failed.title', missing)
    : t(hasOwnTitle(job.stoppedReason) ? `jobs.reason.${job.stoppedReason}.title` : 'jobs.reason.generic.title');
  const clipsText = t('jobs.unit.clip', { count: missing });
  const missingText = t('jobs.unit.missingClip', { count: missing });
  const returned = free ? t('jobs.stopped.freeBack') : given.returned > 0 ? t(contentRule ? 'jobs.stopped.backYour' : 'jobs.stopped.back', { count: given.returned }) : '';
  const providerSide = job.stoppedDetail === 'provider-credits' || job.stoppedDetail === 'provider-cap' || job.stoppedDetail === 'provider-setup';
  const saved = providerSide
    ? t('jobs.reason.provider.body')
    : known && !free
      ? t('jobs.reason.clips-failed.body', {
          images: t('jobs.unit.finishedImage', { count: stepOf(job, 'images').done }),
          clips: t('jobs.unit.clipReady', { count: clips.done }),
        })
      : contentRule
        ? t('jobs.reason.content-rule.body')
        : free
          ? t('jobs.stopped.finishedSaved')
          : t('jobs.reason.generic.body');
  // While we are checking, "saved, try again later" is the wrong promise: the one sentence says what happens next.
  const body = swapOff ? t('jobs.swap.stopped.off.body') : swapStop ? t(`jobs.swap.stopped.${swapStop}.body`) : checking ? t('jobs.reason.submission-unknown.body') : saved;
  const open = (next: ResumeOption) => {
    setNotice(null);
    setOption(next);
  };
  const confirm = () =>
    start(async () => {
      const outcome = await resumeJob(job.id, quote.cost);
      if (outcome.status === 'ok' || (outcome.status === 'error' && outcome.swapClosed)) return setOption(null);   // switched off meanwhile: the page is read again and says so
      if (outcome.status === 'error') return setNotice(outcome.providerCap ? 'provider-cap' : 'error');
      setAnswer({ cost: outcome.cost, balance: outcome.balance });
      setNotice(outcome.status === 'price-changed' ? 'changed' : null);
    });
  const close = () =>
    start(async () => {
      const outcome = await closeJob(job.id);
      setClosing(outcome.status === 'ok' ? null : 'failed');
    });
  const pricing = `/pricing?returnTo=${encodeURIComponent(`/jobs/${job.id}`)}`;
  const BIG = 'box-border flex min-h-18 w-full cursor-pointer flex-col justify-center gap-1 rounded-12 px-4 py-3 text-left font-[inherit] disabled:cursor-not-allowed disabled:opacity-60';
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <StatusLine kind="stopped">{t('common.status.stopped')}</StatusLine>
        <h1 className="m-0 heading-3">{job.templateTitle}</h1>
        <p className="m-0 text-15 text-text-2">
          {leadOf(t, job, seconds)}
        </p>
      </section>

      <div className="flex flex-wrap items-start gap-x-12 gap-y-8">
        <StageList steps={job.steps} swap={Boolean(job.swap)} />
        <section
          aria-label={t('jobs.stopped.section')}
          className="order-first box-border flex min-w-0 flex-[1_1_480px] flex-col gap-6 rounded-16 border border-warn-edge bg-surface p-4 nav:order-none nav:p-6"
        >
          <div className="flex flex-col gap-2">
            <h2 className="m-0 heading-5">{title}</h2>
            <p className="m-0 text-15 leading-normal text-text-2">{[returned, body].filter(Boolean).join(' ')}</p>
            {resumable && quote.continueUntil && (
              <p className="m-0 text-15 font-semibold">{t('jobs.stopped.until', { date: formatDate(quote.continueUntil, locale) })}</p>
            )}
          </div>
          {resumable && !free && (
            <SummaryRows
              rows={[
                [t('jobs.summary.charged'), formatCredits(given.charged, t)],
                [t('jobs.summary.returned'), formatCredits(given.returned, t)],
                [t('jobs.summary.toContinue'), formatCredits(quote.cost, t)],
              ]}
            />
          )}
          {contentRule || !resumable ? (
            <div className="flex flex-wrap gap-3 max-nav:flex-col">
              {swapStop && swapOpen && <LinkButton href={`/swap/${encodeURIComponent(job.templateId)}`}>{t('jobs.swap.stopped.another')}</LinkButton>}
              <LinkButton href={`/contact?topic=video&job=${encodeURIComponent(job.id)}`} variant="secondary" className="self-start max-nav:self-stretch">
                {t('jobs.stopped.contact')}
              </LinkButton>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <button type="button" disabled={pending} onClick={() => open('continue')} className={cx(BIG, 'border-0 bg-accent text-on-accent')}>
                <span className="text-15 font-semibold">{t('jobs.stopped.continue')}</span>
                <span className="text-13">{t('jobs.stopped.continueSub')}</span>
              </button>
              <button type="button" disabled={pending} onClick={() => open('retry')} className={cx(BIG, 'border border-edge-strong bg-transparent text-text')}>
                <span className="text-15 font-semibold">{t('jobs.stopped.retry')}</span>
                <span className="text-13 text-text-3">{t('jobs.stopped.retrySub', { missing: missingText })}</span>
              </button>
              <button type="button" disabled={pending} onClick={() => setClosing('asking')} className={cx(BIG, 'border border-edge bg-transparent text-text')}>
                <span className="text-15 font-semibold">{t('jobs.stopped.stop')}</span>
                <span className="text-13 text-text-3">
                  {free || given.returned === 0 ? t('jobs.stopped.stopSubFree') : t('jobs.stopped.stopSub', { credits: formatCredits(given.returned, t) })}
                </span>
              </button>
            </div>
          )}
        </section>
      </div>
      {option && (
        <ResumeDialog
          option={option}
          quote={quote}
          clips={clipsText}
          missingClips={missingText}
          notice={notice}
          pricingHref={pricing}
          pending={pending}
          onCancel={() => setOption(null)}
          onConfirm={confirm}
        />
      )}
      {closing && <CloseDialog finished={{ images: stepOf(job, 'images').done, clips: clips.done }} failed={closing === 'failed'} pending={pending} onKeep={() => setClosing(null)} onConfirm={close} />}
    </div>
  );
}
