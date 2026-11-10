'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import { formatDate } from '@/shared/lib/format';
import { Button, Card, EmptyState, Icon, LinkButton, MediaImage, PageHead } from '@/shared/ui';
import { ConfirmDangerDialog } from '@/shared/ui/ConfirmDangerDialog';
import { answerSwap } from './review-actions';
import type { SwapPhotoView, SwapQueueData, SwapQueueRow } from './review-load';

type Verdict = 'approved' | 'rejected';
/** What the data layer said to an answer that changed nothing: it came second (`already`), or it did not go through (`failed`). */
type Outcome = { kind: 'already'; at: string } | { kind: 'failed' };
const TILE = 'relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-12 border border-line bg-raised';

/** One photograph of the customer: the picture from the admin route, or the words for why there is none. */
function Photo({ photo, email }: { photo: SwapPhotoView; email: string }) {
  const t = useT();
  const [gone, setGone] = useState(false);
  const kind = t(`adminJobs.review.kind.${photo.kind}`);
  const words = photo.state === 'decided' ? t('adminJobs.review.decided')
    : photo.state === 'deleted' ? t('adminJobs.review.deleted')
    : gone ? t('adminJobs.review.gone')
    : photo.src === null ? t('adminJobs.review.noFile') : null;
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      <div className={TILE}>
        {words === null && photo.src !== null ? (
          <MediaImage src={photo.src} alt={t('adminJobs.review.photoAlt', { kind, email })} fill unoptimized sizes="(min-width: 960px) 240px, 50vw" className="object-contain" onError={() => setGone(true)} />
        ) : (
          <span className="flex flex-col items-center gap-1 p-3 text-center text-13 leading-snug text-text-2">
            {words}
            {photo.state === 'shown' && !gone && photo.name && <span className="font-medium text-text wrap-anywhere">{photo.name}</span>}
          </span>
        )}
      </div>
      <figcaption className="text-13 leading-snug text-text-2">{kind}</figcaption>
    </figure>
  );
}

function timeLeft(t: ReturnType<typeof useT>, minutesLeft: number) {
  const hours = Math.floor(minutesLeft / 60);
  return hours > 0 ? t('adminJobs.review.leftHours', { hours, minutes: minutesLeft % 60 }) : t('adminJobs.review.leftMinutes', { minutes: minutesLeft });
}

/**
 * `/admin/jobs/review`: the person-swap jobs that wait for an admin's look at their photographs, the longest wait first. Approve is one
 * click; reject asks first. An answer that worked reads the line again (the job leaves it); one that changed nothing is said as the
 * data layer said it. Who may be here, and whether a photograph is shown at all, is decided by the data layer, not by this page.
 */
export function SwapQueueView({ rows, lookOn }: SwapQueueData) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [sending, send] = useTransition();
  const [sent, setSent] = useState<{ id: string; verdict: Verdict } | null>(null);
  const [asking, setAsking] = useState<SwapQueueRow | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome | null>>({});
  const [note, setNote] = useState('');

  // No catch: an error the action throws (the 403 of a session that is no admin's any more) belongs to the page's boundary.
  const answer = (row: SwapQueueRow, verdict: Verdict) => {
    setSent({ id: row.id, verdict });
    send(async () => {
      const result = await answerSwap({ jobId: row.id, verdict });
      const outcome: Outcome | null = result.status === 'done' ? null : result.status === 'already' ? { kind: 'already', at: result.at } : { kind: 'failed' };
      setOutcomes((before) => ({ ...before, [row.id]: outcome }));
      if (result.status !== 'done') return;
      setNote(t(`adminJobs.review.${verdict}`, { email: row.email }));
      router.refresh();
    });
  };
  const going = (row: SwapQueueRow, verdict: Verdict) => sending && sent?.id === row.id && sent.verdict === verdict;

  return (
    <div className="flex flex-col gap-8">
      <PageHead title={t('adminJobs.review.title')} lead={t('adminJobs.review.lead')} actions={<LinkButton href="/admin/jobs" variant="secondary">{t('adminJobs.review.back')}</LinkButton>} />
      <p role="status" className="m-0 text-15 leading-normal text-accent-text empty:hidden">{note}</p>
      {rows.length === 0 ? (
        <EmptyState title={t('adminJobs.review.empty.title')} text={t(lookOn ? 'adminJobs.review.empty.on' : 'adminJobs.review.empty.off')} />
      ) : (
        <ul aria-label={t('adminJobs.review.list')} className="m-0 flex list-none flex-col gap-4 p-0">
          {rows.map((row) => {
            const outcome = outcomes[row.id];
            return (
              <li key={row.id} aria-label={`${row.email} · ${row.templateTitle}`}>
                <Card className="flex flex-col gap-6">
                  <div className="flex flex-col gap-1">
                    <h2 className="m-0 text-17 leading-snug font-semibold">{row.templateTitle}</h2>
                    <Link href={`/admin/users/${row.userId}`} className="w-fit max-w-full truncate text-15 font-medium text-text underline underline-offset-4">{row.email}</Link>
                    <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-13 leading-snug text-text-2">
                      <span>{t('adminJobs.review.since', { date: formatDate(row.since, locale) })}</span>
                      <span className="font-semibold text-text">{timeLeft(t, row.minutesLeft)}</span>
                      <span>{t('adminJobs.review.credits', { count: row.credits })}</span>
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-6 nav:grid-cols-2">
                    <section aria-label={t('adminJobs.review.photos')} className="flex min-w-0 flex-col gap-2">
                      <h3 className="m-0 text-13 leading-snug font-normal text-text-3">{t('adminJobs.review.photos')}</h3>
                      <div className="grid grid-cols-2 gap-3">
                        {row.photos.map((photo) => <Photo key={`${photo.slot}-${photo.kind}`} photo={photo} email={row.email} />)}
                      </div>
                    </section>
                    <section aria-label={t('adminJobs.review.frame')} className="flex min-w-0 flex-col gap-2">
                      <h3 className="m-0 text-13 leading-snug font-normal text-text-3">{t('adminJobs.review.frame')}</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div className={TILE}>
                          {row.frame
                            ? <MediaImage src={row.frame} alt={t('adminJobs.review.frameAlt', { title: row.templateTitle })} fill unoptimized sizes="(min-width: 960px) 240px, 50vw" className="object-contain" />
                            : <span className="p-3 text-center text-13 leading-snug text-text-2">{t('adminJobs.review.noFrame')}</span>}
                        </div>
                        <div className="flex flex-col gap-2 text-13 leading-snug text-text-2">
                          {row.hints.map((hint) => <p key={hint} className="m-0">{t('adminJobs.review.person', { hint })}</p>)}
                        </div>
                      </div>
                    </section>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6 max-nav:flex-col max-nav:items-stretch">
                    {outcome?.kind === 'already' ? (
                      <>
                        <p role="status" className="m-0 text-15 leading-normal text-text-2">{t('adminJobs.review.already', { date: formatDate(outcome.at, locale) })}</p>
                        <Button variant="secondary" onClick={() => router.refresh()}>{t('adminJobs.review.refresh')}</Button>
                      </>
                    ) : (
                      <>
                        <Button disabled={sending} pending={going(row, 'approved')} className="max-nav:w-full" onClick={() => answer(row, 'approved')}>{t('adminJobs.review.approve')}</Button>
                        <Button variant="secondary" disabled={sending} pending={going(row, 'rejected')} className="max-nav:w-full" onClick={() => setAsking(row)}>{t('adminJobs.review.reject')}</Button>
                        {outcome?.kind === 'failed' && (
                          <p role="alert" className="m-0 flex items-center gap-2 text-15 leading-snug text-warn"><Icon name="warning" size={18} className="shrink-0" />{t('adminJobs.review.failed')}</p>
                        )}
                      </>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {asking && (
        <ConfirmDangerDialog
          title={t('adminJobs.review.rejectDialog.title')}
          what={`${asking.email} · ${asking.templateTitle}`}
          body={t('adminJobs.review.rejectDialog.body')}
          keepLabel={t('adminJobs.review.rejectDialog.keep')}
          confirmLabel={t('adminJobs.review.rejectDialog.confirm')}
          onKeep={() => setAsking(null)}
          onConfirm={() => {
            setAsking(null);
            answer(asking, 'rejected');
          }}
        />
      )}
    </div>
  );
}
