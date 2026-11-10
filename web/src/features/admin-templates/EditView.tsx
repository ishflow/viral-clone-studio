'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { Template } from '@/data/ports';
import { formatDate, formatName } from '@/shared/lib/format';
import { Icon, StatusLine } from '@/shared/ui';
import { noteLabel, secLabel } from './labels';
import type { RunningSample } from './sample';
import { ActionButton } from './ActionButton';
import { publishTemplate } from './actions';
import { SamplePanel } from './SamplePanel';
import { TemplateEditor, type EditNotice } from './TemplateEditor';

/** `/admin/templates/[id]`. The editor is keyed by the last-edit time, so a saved template starts from its saved values; the confirmation lives here, so it stays. */
export function EditView({ template, categories, sampleRunning = null }: { template: Template; categories: string[]; sampleRunning?: RunningSample | null }) {
  const t = useT();
  const locale = useLocale();
  const [notice, setNotice] = useState<EditNotice>(null);
  const canPublish = (template.status === 'waiting' || template.status === 'hidden') && template.sample === 'current' && template.image && template.preparation !== 'preparing' && template.preparation !== 'failed' && !sampleRunning;
  const kind = template.status === 'published' ? 'done' : template.status === 'waiting' ? 'waiting' : 'stopped';
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
        </div>
        <p className="m-0 text-15 leading-normal text-text-2">
          {t('adminTemplates.edit.meta', {
            category: template.category || '—', format: formatName(template.format, t), length: secLabel(t, template.seconds), edited: formatDate(template.editedAt, locale),
          })}
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
      {template.sample === 'outdated' && (
        <div role="status" data-outdated-notice className="flex flex-col gap-1 rounded-12 border border-warn-edge p-4">
          <p className="m-0 flex items-center gap-2 text-15 font-semibold text-warn"><Icon name="warning" size={18} />{t('adminTemplates.edit.outdated.title')}</p>
          <p className="m-0 text-15 leading-normal text-text-2">{t('adminTemplates.edit.outdated.text')}</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-x-8 gap-y-8 nav:grid-cols-[300px_minmax(0,1fr)]">
        <SamplePanel template={template} running={sampleRunning} />
        <div className="flex min-w-0 flex-col gap-6">
          <TemplateEditor key={template.editedAt} template={template} categories={categories} notice={notice} onNotice={setNotice} />
          {canPublish && template.category.trim() === '' && (
            <p role="status" className="m-0 flex items-center gap-2 text-15 leading-normal text-warn"><Icon name="warning" size={18} />{t('adminTemplates.reason.noCategory')}</p>
          )}
          {canPublish && template.category.trim() !== '' && (
            <ActionButton action={publishTemplate} id={template.id} label={t('adminTemplates.edit.publish')} variant="secondary" errorKey="adminTemplates.edit.error.failed" fullWidth className="w-full min-w-0 px-3" />
          )}
        </div>
      </div>
    </div>
  );
}
