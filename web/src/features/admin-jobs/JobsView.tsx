'use client';

import Link from 'next/link';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { Translate } from '@/core/i18n/types';
import { cx } from '@/shared/lib/cx';
import { formatDate, formatDuration, formatName } from '@/shared/lib/format';
import { Card, DataTable, Icon, LinkButton, PageHead, Pager, Segmented, StatusLine, Tile, TileGrid } from '@/shared/ui';
import type { JobRow, JobsData } from './load';
import { JOB_KIND } from '../admin-common/status';
import { RetryButton, ReturnButton, SettleUnknownButton, type JobTarget } from './JobActions';
import { JOB_PERIODS, JOB_STATUSES, jobsHref, type JobFilter, type JobPeriod } from './query';

/** "11 min" from a minute up, else "45 sec": short enough for a tile. */
const averageLabel = (t: Translate, seconds: number) => formatDuration(seconds >= 60 ? Math.round(seconds / 60) * 60 : seconds, t);
const STEP_KEYS = ['adaptation', 'images', 'clips', 'music', 'edit', 'render'] as const;
const stepName = (t: Translate, key: string) => (STEP_KEYS as readonly string[]).includes(key) ? t(`adminJobs.step.${key}`) : key;
const DETAIL_TEXT = ['provider-credits', 'provider-cap', 'provider-refused', 'provider-setup', 'upload-failed', 'no-products'];
/** The detail says more than the reason, so it wins when it has a text of its own. */
const reasonText = (t: Translate, code: string | null, detail: string | null = null) =>
  detail && DETAIL_TEXT.includes(detail) ? t(`adminJobs.reason.detail.${detail}`)
  : code === 'clips-failed' ? t('adminJobs.reason.clips-failed')
  : code === 'content-rule' ? t('adminJobs.reason.content-rule')
  : code === 'submission-unknown' ? t('adminJobs.reason.submission-unknown') : t('adminJobs.reason.generic');
/** The same choice as `reasonText`, in a few words: the table cell shows this, the detail panel the full text. */
const reasonLabel = (t: Translate, code: string | null, detail: string | null = null) =>
  detail && DETAIL_TEXT.includes(detail) ? t(`adminJobs.reason.short.${detail}`)
  : code === 'submission-unknown' ? t('adminJobs.reason.short.submission-unknown')
  : code === 'content-rule' ? t('adminJobs.reason.short.content-rule') : reasonText(t, code, detail);
const languageName = (t: Translate, code: string) => (code === 'en' || code === 'tr' ? t(`adminJobs.language.${code}`) : code.toUpperCase());
const ROW_LINK =
  '-m-3 inline-flex min-h-11 min-w-11 justify-center cursor-pointer whitespace-nowrap items-center border-0 bg-transparent px-3 text-15 font-medium text-accent-text no-underline hover:text-text';
const rowFormat = (t: Translate, row: JobRow) => (row.format ? formatName(row.format, t) : '');

/** The step the status line points at: the stopped one, else the running one, else none. */
function currentStep(row: JobRow) {
  const index = row.steps.findIndex((step) => step.status === 'stopped' || step.status === 'running');
  const step = row.steps[index];
  return step ? { n: index + 1, step } : null;
}

/** What the confirmation of a retry or a return shows about the job. */
const targetOf = (row: JobRow): JobTarget => {
  const index = row.steps.findIndex((step) => step.status === 'stopped');
  const stopped = row.steps[index];
  return {
    id: row.id, email: row.email, templateTitle: row.templateTitle, credits: row.credits, creditsReturned: row.creditsReturned, balance: row.balance,
    missing: stopped ? { step: stopped.key, count: Math.max(1, stopped.total - stopped.done) } : null,
  };
};
/**
 * A stopped job the admin can run again. The server refuses the retry of a job stopped by the content rule (`restart` in the job
 * store: it would be stopped again), so such a job has no button; every other stop is let through.
 */
const canRetry = (row: JobRow) => row.status === 'stopped' && row.stoppedReason !== 'content-rule';
/** Credits can still be returned by hand on a finished, stopped or closed job that was charged and has not got them all back (Ruling). */
const canReturn = (row: JobRow) => (row.status === 'done' || row.status === 'stopped' || row.status === 'closed') && row.credits > row.creditsReturned;

/** "2 videos ahead · starts in about 14 min", or "Starting shortly" when nothing is in the way. */
const waitingText = (line: NonNullable<JobRow['engineQueue']>, t: Translate) =>
  line.ahead === 0 || line.waitMinutes === 0 ? t('common.queue.soon') : t('common.queue.waiting', { count: line.ahead, minutes: line.waitMinutes });

/** What a job in the queue says about its wait: the engine's line, else its place in the site queue, else nothing. */
const queueLine = (row: JobRow, t: Translate) =>
  row.engineQueue ? waitingText(row.engineQueue, t) : row.queuePosition !== null ? t('adminJobs.position', { count: row.queuePosition }) : null;

function StatusCell({ row }: { row: JobRow }) {
  const t = useT();
  const current = currentStep(row);
  const sub =
    row.status === 'stopped' ? reasonLabel(t, row.stoppedReason, row.stoppedDetail)
    : row.status === 'queued' ? queueLine(row, t)
    : row.status === 'running' && current ? t('adminJobs.stepOf', { n: current.n, total: row.steps.length, step: stepName(t, current.step.key) })
    : null;
  return (
    <span className="flex flex-col gap-1">
      <StatusLine kind={JOB_KIND[row.status]} className="whitespace-nowrap">{t(`adminActions.jobStatus.${row.status}`)}</StatusLine>
      {sub && <span className="w-max max-w-36 pl-5 text-13 leading-snug font-normal text-pretty text-text-3">{sub}</span>}
    </span>
  );
}

function StepList({ row }: { row: JobRow }) {
  const t = useT();
  return (
    <ol aria-label={t('adminJobs.detail.steps')} className="m-0 grid list-none grid-cols-1 gap-2 p-0 nav:grid-cols-6">
      {row.steps.map((step, i) => {
        const stopped = step.status === 'stopped';
        return (
          <li key={step.key} className={cx('flex items-center gap-3 rounded-12 border bg-bg p-3', stopped ? 'border-warn-edge' : 'border-line')}>
            <span
              aria-hidden="true"
              className={cx(
                'flex size-9 shrink-0 items-center justify-center text-15 font-medium',
                step.status === 'done' && 'rounded-full border-[1.5px] border-accent-text text-accent-text',
                stopped && 'rounded-8 border-[1.5px] border-warn text-warn',
                step.status === 'running' && 'rounded-full border-[1.5px] border-accent-text text-accent-text',
                step.status === 'waiting' && 'rounded-full border-[1.5px] border-dashed border-edge-strong text-text-3',
              )}
            >
              {step.status === 'done' ? <Icon name="done" size={20} /> : String(i + 1)}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-15 leading-snug font-semibold">{stepName(t, step.key)}</span>
              <span className={cx('text-13 leading-snug', step.status === 'done' || step.status === 'running' ? 'text-accent-text' : stopped ? 'text-warn' : 'text-text-3')}>
                {stopped ? t('adminJobs.detail.stopped') : t(`common.status.${step.status}`)}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Detail card below the table. Each step shows its own status from the data; nothing is inferred from its position. */
function JobDetail({ row }: { row: JobRow }) {
  const t = useT();
  const locale = useLocale();
  const stopped = row.status === 'stopped';
  const current = currentStep(row);
  // With no step in progress the job is finished only when it is done; a job in the queue says it waits, any other says its status.
  const currentText = current ? t('adminJobs.stepOf', { n: current.n, total: row.steps.length, step: stepName(t, current.step.key) })
    : row.status === 'done' ? t('adminJobs.detail.finished')
    : row.status === 'queued' ? (queueLine(row, t) ?? t('adminJobs.filter.queued'))
    : t(`adminActions.jobStatus.${row.status}`);
  const saved = [
    ...row.steps.filter((s) => s.status === 'done').map((s) => stepName(t, s.key).toLowerCase()),
    ...row.steps.filter((s) => s.status === 'stopped' && s.done > 0).map((s) => t('adminJobs.detail.savedPartial', { done: s.done, total: s.total, step: t(`adminJobs.stepPlural.${s.key}`) })),
  ];
  const savedText = saved.length ? saved.join(', ').replace(/^./, (c) => c.toUpperCase()) : t('adminJobs.none');
  const facts: [string, string][] = stopped
    ? [
        [t('adminJobs.detail.stoppedAt'), current ? t('adminJobs.stepOf', { n: current.n, total: row.steps.length, step: stepName(t, current.step.key) }) : '—'],
        [t('adminJobs.detail.reason'), reasonText(t, row.stoppedReason, row.stoppedDetail)],
        [t('adminJobs.detail.saved'), savedText],
        [t('adminJobs.detail.credits'), row.credits > 0 ? String(row.credits) : t('adminJobs.freeVideo')],
        [t('adminJobs.detail.returned'), String(row.creditsReturned)],
      ]
    : [
        [t('adminJobs.detail.currentStep'), currentText],
        [t('adminJobs.detail.saved'), savedText],
        [t('adminJobs.detail.credits'), row.credits > 0 ? String(row.credits) : t('adminJobs.freeVideo')],
        ...(row.creditsReturned > 0 ? [[t('adminJobs.detail.returned'), String(row.creditsReturned)] as [string, string]] : []),
      ];
  return (
    <section id="job-detail" aria-labelledby="h-job" className="flex flex-col gap-4">
      <h2 id="h-job" className="m-0 heading-6">{t(stopped ? 'adminJobs.detail.titleStopped' : 'adminJobs.detail.title')}</h2>
      <Card className={cx('flex flex-col gap-6', stopped && 'border-warn-edge')}>
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-17 leading-snug font-semibold">{row.templateTitle}</h3>
          <p className="m-0 text-15 leading-normal text-text-2">
            {t('adminJobs.detail.meta', {
              email: row.email, format: rowFormat(t, row), quality: t(`common.quality.${row.quality}`), language: languageName(t, row.language),
              started: formatDate(row.startedAt, locale),
            })}
          </p>
        </div>
        <StepList row={row} />
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-4 nav:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
          {facts.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-1">
              <dt className="text-13 leading-snug text-text-3">{label}</dt>
              <dd className="m-0 text-15 leading-snug font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6 max-nav:flex-col max-nav:items-stretch">
          {row.stoppedReason === 'submission-unknown' && stopped && <SettleUnknownButton job={targetOf(row)} />}
          {canRetry(row) && <RetryButton job={targetOf(row)} detail />}
          {canReturn(row) && <ReturnButton job={targetOf(row)} detail />}
          <LinkButton href={`/admin/users/${row.userId}`} variant="secondary">{t('adminJobs.detail.openUser')}</LinkButton>
          {canRetry(row) && <p className="m-0 text-13 leading-snug text-text-3 nav:ml-2">{t('adminJobs.detail.note')}</p>}
        </div>
      </Card>
    </section>
  );
}

/** `/admin/jobs`. Status, search and period live in the URL. `reviewWaiting`: the person-swap jobs that wait for the look at their photos, on the link to them. */
export function JobsView({ rows, total, selected, status, q, period, tiles, reviewWaiting }: JobsData & { reviewWaiting?: number }) {
  const t = useT();
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  const keep = { status, q, period };
  return (
    <div className="flex flex-col gap-8">
      <PageHead
        title={t('adminJobs.title')}
        lead={t('adminJobs.lead')}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {reviewWaiting !== undefined && <LinkButton href="/admin/jobs/review" variant="secondary">{t('adminJobs.review.link', { count: number.format(reviewWaiting) })}</LinkButton>}
            <Segmented
              label={t('adminJobs.period.label')}
              value={period}
              options={JOB_PERIODS.map((value) => ({ value, label: t(`adminJobs.period.${value}`) }))}
              hrefFor={(value) => jobsHref({ ...keep, period: value as JobPeriod })}
            />
          </div>
        }
      />
      <TileGrid lead>
        <Tile label={t('adminJobs.tile.running.label')} value={number.format(tiles.running)} sub={t('adminJobs.tile.running.sub')} />
        <Tile label={t('adminJobs.tile.done.label')} value={number.format(tiles.done)} sub={t('adminJobs.tile.done.sub')} />
        <Tile label={t('adminJobs.tile.stopped.label')} value={number.format(tiles.stopped)} sub={t('adminJobs.tile.stopped.sub')} />
        <Tile label={t('adminJobs.tile.average.label')} value={tiles.averageSeconds === null ? '—' : averageLabel(t, tiles.averageSeconds)} sub={t('adminJobs.tile.average.sub')} />
        <Tile label={t('adminJobs.tile.cost.label')} value={tiles.cost ?? t('adminJobs.placeholder.amount')} sub={t('adminJobs.tile.cost.sub')} />
      </TileGrid>
      <section aria-label={t('adminJobs.list.label')} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <form method="get" action="/admin/jobs" role="search" className="relative flex max-w-105 min-w-0 flex-[1_1_320px] items-center max-nav:max-w-none">
            {status !== 'all' && <input type="hidden" name="status" value={status} />}
            {period !== '30d' && <input type="hidden" name="period" value={period} />}
            <label htmlFor="job-search" className="sr-only">{t('adminJobs.search.label')}</label>
            <span aria-hidden="true" className="pointer-events-none absolute left-4 flex text-text-3"><Icon name="search" size={20} /></span>
            <input
              id="job-search"
              type="search"
              name="q"
              defaultValue={q}
              placeholder={t('adminJobs.search.placeholder')}
              className="box-border min-h-13 w-full rounded-12 border border-edge-strong bg-bg py-0 pr-4 pl-12 text-15 text-text"
            />
          </form>
          <Segmented
            label={t('adminJobs.filter.label')}
            value={status}
            options={JOB_STATUSES.map((value) => ({ value, label: t(`adminJobs.filter.${value}`) }))}
            hrefFor={(value) => jobsHref({ ...keep, status: value as JobFilter })}
            className="max-nav:w-full"
          />
        </div>
        <DataTable
          caption={t('adminJobs.table.caption')}
          minWidth={1000}
          dense
          columns={[
            { key: 'started', header: t('adminJobs.table.started') },
            { key: 'user', header: t('adminJobs.table.user') },
            { key: 'template', header: t('adminJobs.table.template') },
            { key: 'video', header: t('adminJobs.table.video') },
            { key: 'credits', header: t('adminJobs.table.credits'), numeric: true },
            { key: 'returned', header: t('adminJobs.table.returned'), numeric: true },
            { key: 'cost', header: t('adminJobs.table.cost'), numeric: true },
            { key: 'status', header: t('adminJobs.table.status') },
            { key: 'actions', header: t('adminJobs.table.actions'), numeric: true, srOnlyHeader: true },
          ]}
          rows={rows.map((row) => ({
            id: row.id,
            cells: {
              started: <span className="whitespace-nowrap">{formatDate(row.startedAt, locale)}</span>,
              user: (
                <Link href={`/admin/users/${row.userId}`} title={row.email} className="-my-3 block max-w-44 truncate py-3 font-medium text-text underline underline-offset-4">
                  {row.email}
                </Link>
              ),
              template: <span className="block min-w-34 font-medium text-text">{row.templateTitle}</span>,
              video: <span className="block min-w-32">{[rowFormat(t, row), t(`common.quality.${row.quality}`), languageName(t, row.language)].filter(Boolean).join(' · ')}</span>,
              credits: <span className="whitespace-nowrap">{row.credits > 0 ? number.format(row.credits) : t('adminJobs.freeVideo')}</span>,
              returned: <span className="whitespace-nowrap">{row.status === 'stopped' || row.status === 'closed' || row.creditsReturned > 0 ? number.format(row.creditsReturned) : ''}</span>,
              cost: <span className="whitespace-nowrap">{row.cost ?? t('adminJobs.placeholder.amount')}</span>,
              status: <StatusCell row={row} />,
              // pr-1.5: the link's -m-3 hit area would otherwise spill past the last column and make the table scroll sideways.
              actions: (
                <span className="inline-flex flex-col items-end gap-1 pr-1.5">
                  <Link href={`${jobsHref({ ...keep, job: row.id })}#job-detail`} scroll={false} aria-current={selected?.id === row.id ? 'true' : undefined} className={ROW_LINK}>
                    {t('adminJobs.open')}
                  </Link>
                  {canRetry(row) && (
                    <span className="inline-flex flex-col items-end gap-1">
                      <RetryButton job={targetOf(row)} />
                      <span className="max-w-40 text-right text-13 leading-snug text-text-3">{t('adminActions.retry.info')}</span>
                    </span>
                  )}
                </span>
              ),
            },
          }))}
          empty={{
            text: t('adminJobs.empty.text'),
            action: <LinkButton href="/admin/jobs" variant="secondary">{t('adminJobs.empty.clear')}</LinkButton>,
          }}
        />
        <Pager shown={rows.length} total={total} />
      </section>
      {selected && <JobDetail row={selected} />}
    </div>
  );
}
