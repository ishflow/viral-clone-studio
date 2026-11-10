'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { RULES, type Job } from '@/data/ports';
import { formatCredits } from '@/shared/lib/format';
import { cx } from '@/shared/lib/cx';
import { Button, Icon, buttonClass } from '@/shared/ui';
import { AutoRefresh } from './AutoRefresh';
import { DeleteVideoDialog } from './DeleteVideoDialog';
import { RegenerateDialog } from './RegenerateDialog';
import { ReportDialog } from './ReportDialog';
import type { JobTemplate } from './RunningView';
import { DownloadFailed, useDownload } from './useDownload';

/** What the page knows besides the job: may the customer still report a problem, the balance, and what each stopped variant costs to make again. */
export type ResultExtras = { reportOpen: boolean; balance: number; variantCosts: Record<string, number> };
const NO_EXTRAS: ResultExtras = { reportOpen: false, balance: 0, variantCosts: {} };

function Player({ image, video, alt, downloadHref }: { image: string; video: string | null; alt: string; downloadHref: string | null }) {
  const t = useT();
  const [broken, setBroken] = useState(false);
  return (
    <div className="relative overflow-hidden rounded-16 bg-surface shadow-[0_0_0_1px_var(--media-edge)]">
      {video ? (
        <video key={video} controls playsInline preload="metadata" poster={image} src={video} onError={() => setBroken(true)} className="block aspect-[9/16] w-full bg-surface object-cover" />
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- the generated frame, served as a static file */}
          <img src={image} alt={alt} className="block aspect-[9/16] w-full object-cover" />
          <span aria-hidden="true" className="absolute top-1/2 left-1/2 flex size-18 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-scrim text-on-scrim">
            <Icon name="play" size={26} />
          </span>
        </>
      )}
      {video && broken && (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-scrim p-6 text-center text-on-scrim">
          <Icon name="warning" size={28} />
          <p className="m-0 text-15 leading-normal">{t('jobs.result.cannotPlay')}</p>
          {downloadHref && (
            <a href={downloadHref} download className={buttonClass('primary', 'm', false, 'gap-2 px-4')}>
              <Icon name="download" size={18} />
              {t('jobs.result.download')}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** `A-Sonuc` (one variant) and `A-Sonuc-Varyant` (several): the player, the downloads and the facts of the job. */
export function ResultView({ job, template, extras = NO_EXTRAS }: { job: Job; template: JobTemplate; extras?: ResultExtras }) {
  const t = useT();
  const firstDone = Math.max(0, job.variants.findIndex((v) => v.status === 'done'));
  const [picked, setPicked] = useState(firstDone);
  const [dialog, setDialog] = useState<'report' | 'delete' | { regenerate: string } | null>(null);
  const download = useDownload();
  const preparing = download.state === 'preparing';
  const many = job.variants.length > 1;
  const current = job.variants[Math.min(picked, job.variants.length - 1)];
  if (!current) return null;
  const resolution = t(`jobs.resolution.${job.input.quality}`);
  const files = job.variants.flatMap((v) => (v.video ? [v.video] : []));
  const done = job.variants.filter((v) => v.status === 'done');
  const stopped = job.variants.filter((v) => v.status === 'stopped');
  const partial = many && done.length < job.variants.length;
  const working = job.variants.some((v) => v.status === 'generating' || v.status === 'waiting');
  const stored = job.videoStored;
  const again = `/templates/${job.templateId}/generate?from=${encodeURIComponent(job.id)}`; // the form opens with this job's entries
  const downloadLabel = many ? t('jobs.result.downloadVariant', { n: picked + 1 }) : t('jobs.result.download');
  const heading = partial ? (done.length === 1 ? t('jobs.result.oneVariant') : t('jobs.result.many', { count: done.length })) : many ? t('jobs.result.many', { count: job.variants.length }) : t('jobs.result.single');
  const regenerating = typeof dialog === 'object' && dialog !== null ? job.variants.findIndex((v) => v.id === dialog.regenerate) : -1;
  return (
    <div className={cx('flex flex-wrap justify-center gap-6 nav:items-center nav:gap-x-18 nav:gap-y-8', many ? 'items-start gap-x-4' : 'items-center')}>
      <div className={cx('min-w-0', many ? '-order-2 flex-1 nav:order-none nav:max-w-97.5 nav:flex-[1_1_280px]' : 'flex-[0_0_270px] nav:max-w-97.5 nav:flex-[1_1_280px]')}>
        {stored ? (
          <Player image={current.image} video={current.video} alt={many ? t('jobs.result.frameOf', { n: picked + 1 }) : t('jobs.result.frame')} downloadHref={current.video} />
        ) : (
          <div className="aspect-[9/16] w-full rounded-16 border-[1.5px] border-dashed border-edge-strong" aria-hidden="true" />
        )}
      </div>

      <div className={cx(many ? 'contents nav:flex nav:max-w-130 nav:flex-[1_1_380px] nav:flex-col nav:gap-8' : 'flex min-w-0 flex-[1_1_100%] flex-col gap-6 nav:max-w-130 nav:flex-[1_1_380px] nav:gap-8')}>
        <div className={cx('flex flex-col gap-3', many && 'basis-full nav:basis-auto')}>
          <h1 className="m-0 font-display text-[clamp(42px,6.4vw,92px)] leading-[0.95] font-extrabold tracking-[-0.035em]">
            {stored ? heading : t('jobs.result.expiredTitle')} {stored && <span className="text-accent-text">{t('jobs.result.ready')}</span>}
          </h1>
          <p className="m-0 text-15 text-text-2 nav:text-17">
            {stored ? (template.seconds > 0 ? t('jobs.result.lead', { template: job.templateTitle, seconds: Math.round(template.seconds), resolution }) : t('jobs.result.leadNoLength', { template: job.templateTitle, resolution })) : t('jobs.result.expiredText', { months: RULES.videosKeptMonths })}
          </p>
          {!stored && <p className="m-0 text-15 text-text-3">{t('jobs.result.expiredNew')}</p>}
        </div>

        {!stored && (
          <Link href={again} className={buttonClass('primary', 'l', false, 'self-start px-8')}>
            {t('jobs.result.expiredAction')}
          </Link>
        )}
        {stored && many && (
          <div role="group" aria-label={t('jobs.result.variants')} className="-order-1 flex flex-[0_0_72px] flex-col justify-between self-stretch nav:order-none nav:flex-none nav:flex-row nav:flex-wrap nav:justify-start nav:gap-4 nav:self-auto">
            {job.variants.map((variant, index) => {
              const ready = variant.status === 'done';
              const thumb = cx('block aspect-[9/16] w-18 rounded-8 object-cover shadow-[0_0_0_1px_var(--media-edge)] outline-offset-[3px]', index === picked ? 'outline-2 outline-accent-text' : 'outline-0', !ready && partial && 'opacity-50');
              return (
                <button
                  key={variant.id}
                  type="button"
                  aria-pressed={index === picked}
                  aria-label={t('jobs.result.variant', { n: index + 1 })}
                  disabled={!ready && partial}
                  onClick={() => setPicked(index)}
                  className="flex cursor-pointer flex-col items-center gap-2 border-0 bg-transparent p-0 text-text disabled:cursor-default"
                >
                  {/* A variant that stopped before it had a picture: an empty `src` makes the browser fetch the page again and leaves a broken box. */}
                  {variant.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- small static thumbnails
                    <img src={variant.image} alt="" className={thumb} />
                  ) : (
                    <div aria-hidden="true" className={cx(thumb, 'bg-raised')} />
                  )}
                  <span className={cx('text-13', index === picked ? 'font-semibold text-text' : 'text-text-3')}>{t('jobs.result.variant', { n: index + 1 })}</span>
                  {partial && <span className={cx('text-13', variant.status === 'stopped' ? 'font-semibold text-warn' : 'text-text-3')}>{t(`jobs.result.state.${variant.status}`)}</span>}
                </button>
              );
            })}
          </div>
        )}

        {stored && (
          <div className={cx('flex flex-wrap gap-3', many && 'basis-full')}>
            {current.video ? (
              <a
                href={current.video}
                download
                aria-disabled={preparing || undefined}
                onClick={(event) => {
                  event.preventDefault();
                  if (!preparing && current.video) void download.run([current.video], job.templateTitle, job.id);
                }}
                className={buttonClass('primary', 'l', false, cx('flex-[1_1_200px] gap-2 px-4', preparing && 'pointer-events-none opacity-50'))}
              >
                <Icon name="download" size={20} />
                {downloadLabel}
              </a>
            ) : (
              <Button size="l" disabled className="flex-[1_1_200px] gap-2 px-4">
                <Icon name="download" size={20} />
                {downloadLabel}
              </Button>
            )}
            {many ? (
              <Button variant="secondary" size="l" disabled={files.length === 0 || preparing} onClick={() => void download.run(files, job.templateTitle, job.id)} className="flex-[1_1_200px] px-4">
                {partial && done.length === 2 ? t('jobs.result.downloadBoth') : t('jobs.result.downloadAll', { count: partial ? done.length : job.variants.length })}
              </Button>
            ) : (
              template.openable !== false && (
                <Link href={again} className={buttonClass('secondary', 'l', false, 'flex-[1_1_200px] px-4')}>
                  {t('jobs.result.again')}
                </Link>
              )
            )}
            {preparing && (
              <p role="status" className="m-0 basis-full text-13 leading-normal text-text-3">
                {t('jobs.result.preparing')}
              </p>
            )}
            {download.state === 'failed' && <DownloadFailed onRetry={() => void download.retry()} />}
            {!current.video && !working && <p className="m-0 basis-full text-13 leading-normal text-text-3">{t('jobs.result.noFile')}</p>}
            {many && template.openable !== false && (
              <Link href={again} className="flex min-h-11 items-center text-15 font-medium">
                {t('jobs.result.again')}
              </Link>
            )}
            <p className="m-0 basis-full text-13 leading-normal text-text-3">{job.swap ? t('jobs.swap.kept', { days: RULES.swapVideosKeptDays }) : t('jobs.result.kept', { months: RULES.videosKeptMonths })}</p>
          </div>
        )}

        {stored && stopped.map((variant) => {
          const n = job.variants.findIndex((v) => v.id === variant.id) + 1;
          const cost = extras.variantCosts[variant.id];
          return (
            <section key={variant.id} aria-label={t('jobs.result.variant', { n })} className="box-border flex flex-col gap-3 rounded-16 border border-warn-edge bg-surface p-4 basis-full">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="m-0 text-15 font-semibold">{t('jobs.result.variant', { n })}</h2>
                <span className="text-15 font-semibold text-warn">{t('jobs.result.state.stopped')}</span>
              </div>
              {job.imagesStored && cost !== undefined ? (
                <>
                  <p className="m-0 text-15 leading-normal text-text-2">{t('jobs.result.stoppedText', { credits: formatCredits(cost, t) })}</p>
                  <button type="button" onClick={() => setDialog({ regenerate: variant.id })} className={buttonClass('secondary', 'm', false, 'flex-col gap-0.5 self-start py-2')}>
                    <span>{t('jobs.result.regenerate')}</span>
                    <span className="text-13 font-normal text-text-2">{formatCredits(cost, t)}</span>
                  </button>
                </>
              ) : (
                <>
                  <p className="m-0 text-15 leading-normal text-text-2">{t('jobs.result.imagesGone')}</p>
                  <Link href={`/templates/${job.templateId}`} className={buttonClass('secondary', 'm', false, 'self-start')}>
                    {t('jobs.result.openTemplate')}
                  </Link>
                </>
              )}
            </section>
          );
        })}

        {stored && (
          <dl className={cx('m-0 flex flex-col', many && 'basis-full')}>
            {!job.swap && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line py-3 text-15">
                <dt className="flex-[0_0_110px] text-text-3">{t('jobs.result.products')}</dt>
                <dd className="m-0 min-w-0 flex-[1_1_240px] wrap-anywhere">{job.input.products.map((p) => p.name).join(', ')}</dd>
              </div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-y border-line py-3 text-15">
              <dt className="flex-[0_0_110px] text-text-3">{t('jobs.result.quality')}</dt>
              <dd className="m-0 flex-[1_1_240px]">{t('jobs.quality', { quality: t(`common.quality.${job.input.quality}`), resolution })}</dd>
            </div>
          </dl>
        )}

        <div className={cx('flex flex-wrap items-center gap-x-6 gap-y-1', many && 'basis-full')}>
          {stored && template.video && (
            <Link
              href={many ? `/jobs/${job.id}/compare?v=${encodeURIComponent(current.id)}` : `/jobs/${job.id}/compare`}
              className={cx('flex min-h-11 items-center gap-2 text-15 font-medium no-underline', many && 'basis-full nav:basis-auto')}
            >
              {t('jobs.result.compare')}
              <Icon name="forward" size={18} />
            </Link>
          )}
          {stored && extras.reportOpen && (
            <button type="button" onClick={() => setDialog('report')} className="flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-15 font-medium text-text-2 hover:text-text">
              {t('jobs.result.report.open')}
            </button>
          )}
          <button type="button" onClick={() => setDialog('delete')} className="flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-15 font-medium text-text-2 hover:text-warn">
            {t('jobs.result.delete.open')}
          </button>
        </div>
      </div>
      {working && <AutoRefresh />}
      {dialog === 'report' && <ReportDialog jobId={job.id} swap={Boolean(job.swap)} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <DeleteVideoDialog jobId={job.id} variants={done.length || job.variants.length} onClose={() => setDialog(null)} />}
      {regenerating >= 0 && (
        <RegenerateDialog
          jobId={job.id}
          variantId={job.variants[regenerating]!.id}
          n={regenerating + 1}
          cost={extras.variantCosts[job.variants[regenerating]!.id] ?? 0}
          balance={extras.balance}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
