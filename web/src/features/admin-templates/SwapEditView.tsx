'use client';

import Link from 'next/link';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { Template } from '@/data/ports';
import { formatDate } from '@/shared/lib/format';
import { Icon, StatusLine } from '@/shared/ui';
import { noteLabel, secLabel } from './labels';
import { PeopleEditor } from './PeopleEditor';
import { SwapTag } from './SwapTag';

/** `/admin/templates/[id]` of a person-swap video: where it stands, and where each person in it stands. */
export function SwapEditView({ template }: { template: Template }) {
  const t = useT();
  const locale = useLocale();
  const kind = template.status === 'published' ? 'done' : template.status === 'waiting' ? 'waiting' : 'stopped';
  const ready = template.preparation !== 'preparing' && template.preparation !== 'failed';
  return (
    <div className="flex flex-col gap-8">
      <Link href="/admin/templates" className="-mb-6 inline-flex min-h-11 w-fit items-center gap-2 text-15 text-text-2 no-underline hover:text-text">
        <Icon name="back" size={18} />
        {t('adminTemplates.edit.back')}
      </Link>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <h1 className="m-0 heading-3">{template.title}</h1>
          <StatusLine kind={kind}>{t(`adminTemplates.status.${template.status}`)}</StatusLine>
          <SwapTag />
        </div>
        <p className="m-0 text-15 leading-normal text-text-2">
          {t('adminTemplates.swap.edit.meta', { category: template.category || '—', length: secLabel(t, template.seconds), edited: formatDate(template.editedAt, locale) })}
        </p>
        {template.preparation === 'preparing' && <StatusLine kind="waiting">{t('adminTemplates.preparation.preparing')}</StatusLine>}
        {template.preparationNote !== null && (
          <p role="status" className="m-0 flex items-start gap-2 text-15 leading-normal text-text">
            <span className="mt-0.5 text-warn"><Icon name="warning" size={18} /></span>
            <span>
              {template.preparation === 'failed' && <strong className="font-semibold text-warn">{t('adminTemplates.preparation.failed')} </strong>}
              {noteLabel(t, template.preparationNote)}
            </span>
          </p>
        )}
      </div>
      {ready && <PeopleEditor template={template} />}
    </div>
  );
}
