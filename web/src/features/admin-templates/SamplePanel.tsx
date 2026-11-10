'use client';

import { formatReference } from '@/shared/lib/format';
import { useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { Icon, MediaImage } from '@/shared/ui';
import type { Template } from '@/data/ports';
import { canSample, type RunningSample } from './sample';
import { SampleButton } from './SampleButton';

const SAMPLE_BUTTON = { none: 'adminTemplates.edit.generate', current: 'adminTemplates.edit.regenerate', outdated: 'adminTemplates.edit.generateNew' } as const;
const SAMPLE_BUTTON_NOTE = { none: 'adminTemplates.edit.generateNote', current: 'adminTemplates.edit.regenerateNote', outdated: 'adminTemplates.edit.generateNewNote' } as const;

/** Left column of the edit page: the sample, where the reference came from, and "Regenerate sample" (asks for the paid requests first; not on a template that cannot have a sample). */
export function SamplePanel({ template, running = null }: {
  template: Pick<Template, 'id' | 'title' | 'image' | 'video' | 'source' | 'referenceViews' | 'referenceMetric' | 'referenceImage' | 'referenceVideo' | 'status' | 'preparation' | 'sample' | 'products'>;
  running?: RunningSample | null;
}) {
  const t = useT();
  const [playing, setPlaying] = useState(false);
  return (
    <aside aria-labelledby="h-sample" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="h-sample" className="m-0 heading-6">{t('adminTemplates.edit.sample')}</h2>
        {template.sample !== 'none' && (
          <span data-sample-state={template.sample} className={template.sample === 'outdated' ? 'flex items-center gap-1.5 text-13 font-semibold text-warn' : 'flex items-center gap-1.5 text-13 text-text-2'}>
            <Icon name={template.sample === 'outdated' ? 'warning' : 'done'} size={16} />
            {t(`adminTemplates.edit.sampleState.${template.sample}`)}
          </span>
        )}
      </div>
      {/* Phone (board A-Sablon-Duzenle-M): a 132 px frame, the reference and the button beside it, the notes under both. Desktop: one column. */}
      <div data-sample-layout className="grid grid-cols-[132px_minmax(0,1fr)] gap-4 nav:flex nav:flex-col">
        <div className="relative row-span-2 aspect-[9/16] w-full overflow-hidden rounded-12 bg-raised shadow-[0_0_0_1px_var(--media-edge)] nav:rounded-16">
          {playing && template.video ? (
            <video src={template.video} poster={template.image} controls autoPlay muted playsInline className="size-full object-cover" />
          ) : (
            <>
              {template.image ? <MediaImage src={template.image} alt="" fill sizes="300px" className="object-cover" /> : template.referenceVideo ? <video src={template.referenceVideo} poster={template.referenceImage ?? undefined} controls preload="none" className="size-full object-cover" /> : template.referenceImage ? <img src={template.referenceImage} alt="" className="size-full object-cover" /> : <span className="flex size-full items-center justify-center p-3 text-center text-13 text-text-3">{t(template.preparation === 'preparing' ? 'adminTemplates.preparation.preparing' : 'adminTemplates.inbox.noSampleYet')}</span>}
              {template.video && (
                <button
                  type="button" aria-label={t('adminTemplates.edit.play')} onClick={() => setPlaying(true)}
                  className="absolute top-1/2 left-1/2 flex size-13 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-scrim text-on-scrim nav:size-18"
                >
                  <Icon name="play" size={28} />
                </button>
              )}
            </>
          )}
        </div>
        <p className="m-0 text-13 leading-snug text-text-3 max-nav:order-3 max-nav:col-span-2">{t(template.sample === 'none' ? 'adminTemplates.edit.noSampleNote' : 'adminTemplates.edit.sampleNote')}</p>
        <dl className="m-0 flex flex-col gap-1 border-line nav:border-y nav:py-4">
          <dt className="text-13 leading-snug text-text-3">{t('adminTemplates.edit.reference')}</dt>
          <dd className="m-0 text-15 leading-snug font-semibold">{t(`adminTemplates.source.${template.source}`)}</dd>
          <dd className="m-0 text-15 leading-snug font-semibold">{formatReference(template, t)}</dd>
        </dl>
        {canSample(template) && (
          <>
            <SampleButton
              templateId={template.id} products={template.products} label={t(SAMPLE_BUTTON[template.sample])} running={running}
              variant={template.sample === 'outdated' ? 'primary' : 'secondary'} icon className="gap-2 max-nav:px-3" wrapClassName="max-nav:self-end"
            />
            <p className="m-0 text-13 leading-snug text-text-3 max-nav:order-4 max-nav:col-span-2">{t(SAMPLE_BUTTON_NOTE[template.sample])}</p>
          </>
        )}
      </div>
    </aside>
  );
}
