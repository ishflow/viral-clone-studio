'use client';

import { useActionState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { RULES, type LinkRowStatus } from '@/data/ports';
import { Button, Textarea } from '@/shared/ui';
import { prepareLinkList, type LinkListState } from './actions';

const IDLE: LinkListState = { status: 'idle', rows: [] };
const STATUSES: LinkRowStatus[] = ['queued', 'exists', 'invalid', 'limit', 'failed'];

/**
 * "Prepare from a list of links": a box with one link per line, and below it what became of each line. Checked again on the server.
 * A row reads in words, not only in colour: the status is the text beside the link.
 */
export function LinkListForm() {
  const t = useT();
  const [state, action, pending] = useActionState(prepareLinkList, IDLE);
  const counts = Object.fromEntries(STATUSES.map((status) => [status, state.rows.filter((row) => row.status === status).length]));
  return (
    <details className="rounded-16 border border-line bg-surface px-4 open:pb-4">
      <summary className="flex min-h-13 cursor-pointer items-center text-15 font-medium text-accent-text hover:text-text">{t('adminTemplates.inbox.linkList.title')}</summary>
      <form action={action} noValidate className="flex flex-col gap-3">
        <p className="m-0 max-w-prose text-13 leading-snug text-text-3">{t('adminTemplates.inbox.linkList.lead', { max: RULES.linkBatchMax })}</p>
        <Textarea
          name="links" rows={6} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          aria-label={t('adminTemplates.inbox.linkList.label')} placeholder={t('adminTemplates.inbox.linkList.placeholder')}
          aria-invalid={state.status === 'error' ? true : undefined} aria-describedby={state.status === 'error' ? 'link-list-error' : undefined}
          className="font-mono text-13 aria-invalid:border-[1.5px] aria-invalid:border-warn"
        />
        <div>
          <Button type="submit" variant="secondary" pending={pending} className="max-nav:w-full">{t('adminTemplates.inbox.linkList.submit')}</Button>
        </div>
        {state.status === 'error' && (
          <p id="link-list-error" role="alert" className="m-0 text-13 leading-snug text-warn">{t(`adminTemplates.inbox.linkList.${state.error ?? 'failed'}`, { max: RULES.linkBatchMax })}</p>
        )}
        {state.status === 'done' && (
          <div className="flex flex-col gap-2">
            <p role="status" className="m-0 text-13 leading-snug text-accent-text">{t('adminTemplates.inbox.linkList.summary', counts)}</p>
            <ul aria-label={t('adminTemplates.inbox.linkList.results')} className="m-0 flex list-none flex-col overflow-hidden rounded-12 border border-line p-0">
              {state.rows.map((row, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-3 py-2 text-13 leading-snug last:border-b-0">
                  <span className="min-w-0 flex-[1_1_240px] [overflow-wrap:anywhere] text-text">{row.line}</span>
                  <span className={row.status === 'queued' ? 'font-medium text-accent-text' : row.status === 'exists' ? 'text-text-3' : 'font-medium text-warn'}>{t(`adminTemplates.inbox.linkList.status.${row.status}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </details>
  );
}
