'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { Translate } from '@/core/i18n/types';
import { RULES, type EngineQueue } from '@/data/ports';
import { cx } from '@/shared/lib/cx';
import { formatDate, formatDuration } from '@/shared/lib/format';
import { Button, DeleteVideoDialog, EmptyState, Icon, LinkButton, StatusLine, type StatusKind, MediaImage } from '@/shared/ui';
import { deleteVideo } from './actions';
import type { VideoFilter, VideoRow } from './rows';

const STATUS: Record<VideoRow['status'], { kind: StatusKind; label: string }> = {
  running: { kind: 'running', label: 'common.status.running' },
  done: { kind: 'done', label: 'common.status.done' },
  stopped: { kind: 'stopped', label: 'common.status.stopped' },
  queued: { kind: 'queued', label: 'common.status.queued' },
  closed: { kind: 'closed', label: 'common.status.closed' },
};
const ACTION = {
  running: 'videos.action.watch',
  done: 'videos.action.open',
  stopped: 'videos.action.options',
  queued: 'videos.action.open',
  closed: 'videos.action.open',
} as const;

/** A job stopped by the content rules or on an unclear request has no option to see: the row opens the job, where the page explains. */
const hasNoOptions = (row: VideoRow) => row.reason === 'content-rule' || row.reason === 'submission-unknown';

function stoppedDetail(row: VideoRow, t: Translate): string {
  const back = row.free && row.returned === 0;
  if (hasNoOptions(row)) {
    const kind = row.reason === 'content-rule' ? 'Rule' : 'Checking';
    return t(`videos.detail.stopped${kind}${back ? 'Free' : ''}`);
  }
  return row.step ? t(back ? 'videos.detail.stoppedFree' : 'videos.detail.stopped', { done: row.step.done, total: row.step.total }) : '';
}

/** "2 videos ahead · starts in about 14 min", or "Starting shortly" when nothing is in the way. */
const waitingText = (line: EngineQueue, t: Translate) =>
  line.ahead === 0 || line.waitMinutes === 0 ? t('common.queue.soon') : t('common.queue.waiting', { count: line.ahead, minutes: line.waitMinutes });

function Row({ row, onDelete }: { row: VideoRow; onDelete: (row: VideoRow) => void }) {
  const t = useT();
  const expired = row.status === 'done' && !row.stored;
  const status = STATUS[row.status];
  const quality = t(`common.quality.${row.quality}`);
  const variants = t('videos.variants', { count: row.variants });
  const spec = row.seconds
    ? t('videos.specLong', { quality, variants, duration: formatDuration(row.seconds, t) })
    : t('videos.spec', { quality, variants });
  // A person swap has no products and one variant: its line says what it is and how long it is, and it is kept for days, not months.
  const kind = row.seconds ? t('videos.swap.kindLength', { duration: formatDuration(row.seconds, t) }) : t('videos.swap.kind');
  const resolution = t(`videos.resolution.${row.quality}`);
  const detail = expired
    ? row.swap
      ? t('videos.swap.expired', { days: RULES.swapVideosKeptDays })
      : t('videos.detail.expired', { months: RULES.videosKeptMonths })
    : row.status === 'done'
      ? row.swap
        ? t('videos.swap.done', { format: t('common.format.mp4'), resolution, days: RULES.swapVideosKeptDays })
        : t('videos.detail.done', { format: t('common.format.mp4'), resolution })
      : row.status === 'queued'
        ? row.engineQueue
          ? waitingText(row.engineQueue, t)
          : row.queuePosition !== null
            ? t('videos.detail.queued', { position: row.queuePosition })
            : ''
        : row.status === 'closed'
          ? row.free && row.returned === 0
            ? t('videos.detail.closedFree')
            : t('videos.detail.closed', { count: row.returned })
          : row.status === 'stopped'
            ? row.swap
              ? row.returned > 0 ? t('videos.swap.stopped') : ''
              : stoppedDetail(row, t)
            : !row.step
              ? ''
              : t('videos.detail.running', { step: t(row.swap ? `jobs.swap.step.${row.step.key}.name` : `videos.step.${row.step.key}`), done: row.step.done, total: row.step.total, minutes: row.minutesLeft });
  return (
    <li className="flex flex-wrap items-start gap-4 rounded-16 border border-line bg-surface p-4 nav:items-center nav:gap-x-6 nav:rounded-none nav:border-0 nav:border-t nav:bg-transparent nav:px-0">
      <div className={cx('relative h-32 w-18 flex-none overflow-hidden rounded-12 bg-raised shadow-[0_0_0_1px_var(--media-edge)]', expired && 'opacity-60')}>
        {row.image && <MediaImage src={row.image} alt="" fill sizes="72px" className="object-cover" />}
      </div>
      <div className="flex min-w-40 flex-[9999_1_160px] flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-[9999_1_280px] flex-col gap-1">
          <h2 className="m-0 text-17 font-semibold leading-tight text-pretty nav:text-20">{row.title}</h2>
          {row.swap ? (
            <p className="m-0 text-13 leading-snug text-text-3">{kind}</p>
          ) : (
            <>
              <p className="m-0 text-13 leading-snug text-text-3 wrap-anywhere">{t('videos.products', { count: row.productNames.length, names: row.productNames.join(', ') })}</p>
              <p className="m-0 text-13 leading-snug text-text-3">{spec}</p>
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
          {expired ? (
            <span className="flex items-center gap-2 text-15 font-semibold text-text-2">
              <Icon name="clock" size={18} />
              {t('videos.detail.expiredLabel')}
            </span>
          ) : (
            <StatusLine kind={status.kind}>{t(status.label)}</StatusLine>
          )}
          {detail && <span className="text-13 leading-snug text-text-3">{detail}</span>}
          {expired && !row.swapClosed && <span className="text-13 leading-snug text-text-3">{t(row.swap ? 'videos.swap.expiredNote' : 'videos.detail.expiredNote')}</span>}
        </div>
      </div>
      <div className="flex flex-[1_1_240px] flex-wrap gap-2 nav:flex-[0_1_240px]">
        {expired ? (
          // person swap is switched off: its pages are not there, and the row links to none of them
          !row.swapClosed && (
            <LinkButton href={row.swap ? `/swap/${row.templateId}` : `/templates/${row.templateId}/generate`} variant="secondary" className="flex-[1_1_160px]">
              {t('videos.action.again')}
            </LinkButton>
          )
        ) : (
          <>
            <LinkButton href={`/jobs/${row.id}`} variant="secondary" className="flex-[2_1_120px]">
              {t(row.status === 'stopped' && hasNoOptions(row) ? 'videos.action.open' : ACTION[row.status])}
            </LinkButton>
            {row.status === 'done' && (
              <Button variant="secondary" onClick={() => onDelete(row)} className="flex-[1_1_80px]">
                {t('videos.action.delete')}
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function VideosView({ rows, filter, total, freeAvailable }: { rows: VideoRow[]; filter: VideoFilter; total: number; freeAvailable: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [deleting, setDeleting] = useState<VideoRow | null>(null);
  const [notice, setNotice] = useState<'deleted' | 'failed' | null>(null);
  const [pending, start] = useTransition();
  const confirmDelete = () =>
    start(async () => {
      if (!deleting) return;
      const outcome = await deleteVideo(deleting.id);
      if (outcome.status === 'ok') {
        setDeleting(null);
        setNotice('deleted');
      } else setNotice('failed');
    });
  const hrefFor = (value: string) => (value === 'all' ? '/videos' : `/videos?status=${value}`);
  const options = [
    { value: 'all', label: t('videos.filter.all') },
    { value: 'running', label: t('common.status.running') },
    { value: 'done', label: t('common.status.done') },
    { value: 'stopped', label: t('common.status.stopped') },
  ];
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <h1 className="m-0 flex-[9999_1_auto] heading-2">{t('videos.title')}</h1>
        <div role="group" aria-label={t('videos.filter.label')} className="box-border flex max-w-full min-w-0 flex-[1_1_auto] overflow-x-auto rounded-full border border-edge bg-surface px-1">
          {options.map((o) => {
            const on = o.value === filter;
            return (
              <Link
                key={o.value}
                href={hrefFor(o.value)}
                aria-current={on ? 'page' : undefined}
                className={`box-border flex min-h-11 flex-[1_0_auto] py-1 text-15 no-underline ${on ? 'text-text' : 'text-text-3 hover:text-text'}`}
              >
                <span className={`flex flex-[1_1_auto] items-center justify-center rounded-full px-3.5 whitespace-nowrap ${on ? 'bg-raised' : ''}`}>{o.label}</span>
              </Link>
            );
          })}
        </div>
      </section>
      {notice === 'deleted' && (
        <p role="status" className="m-0 flex items-center gap-3 rounded-12 border border-edge bg-surface px-4 py-3 text-15 text-text-2">
          <Icon name="done" size={20} className="flex-none text-accent-text" />
          {t('videos.notice.deleted')}
        </p>
      )}
      {rows.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0 nav:gap-0">
          {rows.map((row) => (
            <Row key={row.id} row={row} onDelete={(target) => { setNotice(null); setDeleting(target); }} />
          ))}
        </ul>
      ) : total === 0 ? (
        <EmptyState
          title={t(freeAvailable ? 'videos.empty.title' : 'videos.empty.usedTitle')}
          text={t(freeAvailable ? 'videos.empty.text' : 'videos.empty.usedText')}
          action={
            <LinkButton href="/gallery" size="l" className="max-nav:self-stretch">
              {t(freeAvailable ? 'videos.empty.action' : 'videos.empty.usedAction')}
            </LinkButton>
          }
        />
      ) : (
        <EmptyState
          title={t('videos.emptyFilter.title')}
          text={t('videos.emptyFilter.text')}
          action={<LinkButton href="/videos" variant="secondary">{t('videos.emptyFilter.action')}</LinkButton>}
        />
      )}
      {deleting && (
        <DeleteVideoDialog
          count={deleting.delivered}
          what={[deleting.title, deleting.productNames.join(', '), formatDate(deleting.startedAt, locale)].filter(Boolean).join(' · ')}
          failed={notice === 'failed'}
          pending={pending}
          onKeep={() => {
            setDeleting(null);
            setNotice(null);
          }}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
