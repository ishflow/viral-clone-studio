'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { formatReference } from '@/shared/lib/format';
import { cx } from '@/shared/lib/cx';
import { Icon, PageHead, Segmented, StatusLine } from '@/shared/ui';
import { ActionButton } from './ActionButton';
import { addCandidateToGallery, rejectCandidateAction } from './actions';
import { AddLinkForm } from './AddLinkForm';
import { LinkListForm } from './LinkListForm';
import { secLabel, reasonLabel } from './labels';
import type { InboxData } from './load';
import { inboxHref, SOURCE_FILTERS, type SourceFilter } from './query';
import { TemplatesNav } from './TemplatesNav';
import { WaitingCard } from './WaitingCard';

const EMPTY = 'm-0 rounded-16 border border-dashed border-edge-strong px-8 py-8 text-15 leading-normal text-text';

/** `/admin/templates/inbox`. */
export function InboxView({ waiting, candidates, source, threshold, scanTimes, next, tomorrow, stoppedSources }: InboxData) {
  const t = useT();
  const when = t(tomorrow ? 'adminTemplates.when.tomorrow' : 'adminTemplates.when.today', { time: next });
  return (
    <div className="flex flex-col gap-8">
      <TemplatesNav current="inbox" />
      <PageHead
        title={t('adminTemplates.inbox.title')}
        lead={t('adminTemplates.inbox.lead', { count: scanTimes.length, next: when })}
        actions={<AddLinkForm />}
      />
      <LinkListForm />
      {stoppedSources.map(({ source: stopped, reason }) => (
        <p key={stopped} role="status" className="m-0 flex items-start gap-3 rounded-12 border border-warn-edge bg-surface px-4 py-3 text-15 leading-normal text-text">
          <span className="mt-0.5 text-warn"><Icon name="warning" size={20} /></span>
          <span>
            <strong className="font-semibold text-warn">{t('adminTemplates.inbox.scanStopped', { source: t(`adminTemplates.source.${stopped}`) })}</strong>{' '}
            {reasonLabel(t, reason)}
          </span>
        </p>
      ))}
      <section aria-labelledby="h-waiting" className="flex flex-col gap-4">
        <h2 id="h-waiting" className="m-0 heading-6">{t('adminTemplates.inbox.waitingTitle')}</h2>
        {waiting.length === 0 ? (
          <p className={EMPTY}>{t('adminTemplates.inbox.waitingEmpty')}</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))] gap-4">
            {waiting.map((template, i) => <WaitingCard key={template.id} template={template} lead={i === 0} />)}
          </div>
        )}
      </section>
      <section aria-labelledby="h-candidates" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex flex-col gap-1">
            <h2 id="h-candidates" className="m-0 heading-6">{t('adminTemplates.inbox.candidatesTitle')}</h2>
            <p className="m-0 text-13 leading-snug text-text-3">{t('adminTemplates.inbox.threshold', { threshold })}</p>
          </div>
          <Segmented
            label={t('adminTemplates.inbox.sourceFilter.label')}
            value={source}
            options={SOURCE_FILTERS.map((value) => ({ value, label: t(`adminTemplates.inbox.sourceFilter.${value}`) }))}
            hrefFor={(value) => inboxHref(value as SourceFilter)}
            className="max-nav:w-full"
          />
        </div>
        {candidates.length === 0 ? (
          <p className={EMPTY}>{t(source === 'all' ? 'adminTemplates.inbox.candidatesEmpty' : 'adminTemplates.inbox.candidatesNone', { next: when })}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col overflow-hidden rounded-16 border border-line bg-surface p-0">
            {candidates.map((c) => {
              const above = c.score > threshold;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-4 py-3.5 last:border-b-0">
                  <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-0.5 max-nav:basis-full">
                    <span className="text-15 leading-snug font-medium text-text">{c.title}</span>
                    <span className="text-13 leading-snug text-text-3">
                      {[t(`adminTemplates.source.${c.source}Short`), formatReference(c, t), secLabel(t, c.seconds)].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 max-nav:flex-1" role="img" aria-label={`${t('adminTemplates.inbox.score')} ${c.score}`}>
                    <span aria-hidden="true" className={cx('w-9 text-right heading-5 tabular-nums', above ? 'text-accent-text' : 'text-text-3')}>{c.score}</span>
                    <span aria-hidden="true" className="h-1.5 w-29 overflow-hidden rounded-full bg-raised">
                      <span className={cx('block h-full rounded-full', above ? 'bg-accent' : 'bg-text-3')} style={{ width: `${Math.max(0, Math.min(100, c.score))}%` }} />
                    </span>
                  </div>
                  <div className="flex flex-[0_1_220px] items-center justify-end gap-3 nav:min-w-36 max-nav:flex-none">
                    {above ? (
                      <StatusLine kind="waiting" className="!text-text-2">{t('adminTemplates.inbox.queued')}</StatusLine>
                    ) : (
                      <>
                        <ActionButton action={addCandidateToGallery} id={c.id} label={t('adminTemplates.inbox.addToGallery')} variant="link" errorKey="adminTemplates.inbox.candidateFailed" />
                        <ActionButton action={rejectCandidateAction} id={c.id} label={t('adminTemplates.inbox.reject')} variant="link" errorKey="adminTemplates.inbox.candidateFailed" confirm={{ title: t('adminTemplates.confirm.rejectCandidate.title'), text: t('adminTemplates.confirm.rejectCandidate.text') }} />
                      </>
                    )}
                  </div>
                  {c.scoreNotes && c.scoreNotes.length > 0 && (
                    <details className="basis-full text-13 leading-snug text-text-2">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-accent-text hover:text-text">{t('adminTemplates.inbox.whyScore')}</summary>
                      <div className="flex flex-col gap-1.5 pb-1">
                        {c.scoreNotes.map((note, i) => <p key={i} className="m-0 max-w-prose whitespace-pre-line [overflow-wrap:anywhere]">{note}</p>)}
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
