'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { Card, Icon, LinkButton, MediaImage } from '@/shared/ui';
import { ActionButton } from './ActionButton';
import { publishTemplate, rejectTemplate } from './actions';
import { formatName, formatReference } from '@/shared/lib/format';
import { noteLabel, secLabel } from './labels';
import type { WaitingCard as Waiting } from './load';
import { SampleButton } from './SampleButton';

/**
 * A template that waits to publish. Only the first card of the list passes `lead`, which makes its Publish the lime button.
 * A template still being prepared offers nothing yet; one whose preparation failed says why and can only be rejected.
 */
export function WaitingCard({ template, lead }: { template: Waiting; lead: boolean }) {
  const t = useT();
  const hasSample = template.image !== '';
  const meta = [template.category, secLabel(t, template.seconds), formatName(template.format, t), t('adminTemplates.inbox.product', { count: template.products })]
    .filter(Boolean)
    .join(' · ');
  const needsCategory = template.preparation !== 'preparing' && template.preparation !== 'failed' && hasSample && template.category.trim() === '';
  return (
    <Card as="div" className="flex min-w-0 flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <figure className="m-0 flex flex-col gap-2">
          <div className="relative flex aspect-[9/16] items-center justify-center overflow-hidden rounded-12 border border-line bg-raised text-center text-13 text-text-2">
            {template.referenceVideo ? <video controls preload="none" poster={template.referenceImage ?? undefined} src={template.referenceVideo} className="h-full w-full object-cover" aria-label={t('adminTemplates.inbox.reference')} /> : template.referenceImage ? <img src={template.referenceImage} alt={t('adminTemplates.inbox.reference')} className="h-full w-full object-cover" /> : t('adminTemplates.inbox.reference')}
          </div>
          <figcaption className="text-13 leading-snug text-text-3">{formatReference(template, t) && `${t('adminTemplates.inbox.reference')} · ${formatReference(template, t)}`}</figcaption>
        </figure>
        <figure className="m-0 flex flex-col gap-2">
          <div className="relative flex aspect-[9/16] items-center justify-center overflow-hidden rounded-12 border border-line bg-bg p-3 text-center text-13 text-text-2">
            {template.preparation === 'preparing' ? <span role="status" className="flex h-full w-full animate-pulse items-center justify-center rounded-12 bg-raised motion-reduce:animate-none">{t('adminTemplates.preparation.preparing')}</span> : hasSample ? <MediaImage src={template.image} alt="" fill sizes="200px" className="object-cover" /> : t(template.preparation === 'failed' ? 'adminTemplates.inbox.noSampleYet' : 'adminTemplates.inbox.noSample')}
          </div>
          <figcaption className="text-13 leading-snug text-text-3">{t('adminTemplates.inbox.sample')}</figcaption>
        </figure>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-17 leading-snug font-semibold">{template.title}</h3>
        <p className="m-0 text-13 leading-snug text-text-3">{meta}</p>
      </div>

      {template.preparation === 'failed' && (
        <p role="status" className="m-0 flex items-start gap-2 text-15 leading-normal text-text">
          <span className="mt-0.5 text-warn"><Icon name="warning" size={18} /></span>
          <span><strong className="font-semibold text-warn">{t('adminTemplates.preparation.failed')}</strong> {noteLabel(t, template.preparationNote)}</span>
        </p>
      )}
      {needsCategory && (
        <p role="status" className="m-0 flex items-center gap-2 text-15 leading-normal text-warn"><Icon name="warning" size={18} />{t('adminTemplates.reason.noCategory')}</p>
      )}
      {template.preparation !== 'preparing' && (
        <div className="flex gap-3">
          {template.preparation === 'failed' ? null : needsCategory ? (
            <div className="flex flex-1">
              <LinkButton href={`/admin/templates/${template.id}`} variant="secondary" fullWidth>{t('adminTemplates.inbox.chooseCategory')}</LinkButton>
            </div>
          ) : hasSample ? (
            <ActionButton action={publishTemplate} id={template.id} label={t('adminTemplates.inbox.publish')} variant={lead ? 'primary' : 'secondary'} fullWidth className="w-full" errorKey="adminTemplates.inbox.waitingFailed" />
          ) : (
            <SampleButton templateId={template.id} products={template.products} label={t('adminTemplates.inbox.generateSample')} running={template.sampleRunning} wrapClassName="flex-1" />
          )}
          <ActionButton action={rejectTemplate} id={template.id} label={t('adminTemplates.inbox.reject')} variant="secondary" className="px-8" errorKey="adminTemplates.inbox.waitingFailed" confirm={{ title: t('adminTemplates.confirm.reject.title'), text: t('adminTemplates.confirm.reject.text') }} />
        </div>
      )}
    </Card>
  );
}
