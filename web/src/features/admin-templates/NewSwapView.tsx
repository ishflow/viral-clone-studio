'use client';

import Link from 'next/link';
import { startTransition, useActionState, useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { PROVIDER_CAP_MESSAGE } from '@/core/provider-cap-message';
import { RULES } from '@/data/ports';
import { Button, Field, Icon, Input, PageHead } from '@/shared/ui';
import { addSwapVideo, type AddSwapState } from './swap-actions';
import { swapVideoRefusal, uploadSwapVideo, type SwapUploadCode } from './swap-upload';

const IDLE: AddSwapState = { status: 'idle' };
type Sending = { percent: number } | null;

/** `/admin/templates/new-swap`: a link, or a file sent to the upload route first (the action takes only the id the route kept). */
export function NewSwapView() {
  const t = useT();
  const [state, action, pending] = useActionState(addSwapVideo, IDLE);
  const [sending, setSending] = useState<Sending>(null);
  const [refused, setRefused] = useState<SwapUploadCode | null>(null);
  const limits = { min: RULES.swapSecondsMin, max: RULES.swapSecondsMax };
  const code = refused ?? (state.status === 'error' ? state.error ?? null : null);
  const error = refused === null && state.providerCap ? PROVIDER_CAP_MESSAGE : code ? t(`adminTemplates.swap.new.error.${code}`, limits) : undefined;
  const busy = pending || sending !== null;

  async function sendFile(file: File | undefined) {
    if (!file) return;
    const early = swapVideoRefusal(file);
    if (early) return setRefused(early);
    setRefused(null);
    setSending({ percent: 0 });
    const result = await uploadSwapVideo(file, (percent) => setSending({ percent }));
    setSending(null);
    if (!result.ok) return setRefused(result.code);
    const form = new FormData();
    form.set('kind', 'upload');
    form.set('uploadId', result.uploadId);
    startTransition(() => action(form));
  }

  return (
    <div className="flex flex-col gap-8">
      <Link href="/admin/templates" className="-mb-6 inline-flex min-h-11 w-fit items-center gap-2 text-15 text-text-2 no-underline hover:text-text">
        <Icon name="back" size={18} />
        {t('adminTemplates.swap.new.back')}
      </Link>
      <PageHead title={t('adminTemplates.swap.new.title')} lead={t('adminTemplates.swap.new.lead', limits)} />
      <div className="flex max-w-130 flex-col gap-6">
        <form action={action} noValidate onSubmit={() => setRefused(null)} className="flex flex-col gap-3">
          <input type="hidden" name="kind" value="link" />
          <div className="flex items-start gap-3 max-nav:flex-wrap">
            <Input
              type="url" name="url" aria-label={t('adminTemplates.swap.new.linkLabel')} placeholder={t('adminTemplates.swap.new.linkPlaceholder')}
              className="min-w-0 flex-[1_1_240px]"
            />
            <Button type="submit" variant="secondary" pending={pending} disabled={busy} className="whitespace-nowrap max-nav:w-full">{t('adminTemplates.swap.new.addLink')}</Button>
          </div>
        </form>
        <Field label={t('adminTemplates.swap.new.fileLabel')} hint={t('adminTemplates.swap.new.fileHint')}>
          <input
            type="file" accept=".mp4,.mov,video/mp4,video/quicktime" disabled={busy}
            onChange={(event) => {
              void sendFile(event.target.files?.[0]);
              event.target.value = '';
            }}
            className="text-15 text-text"
          />
        </Field>
        {error && <p role="alert" className="m-0 text-13 leading-snug text-warn">{error}</p>}
        <p role="status" className="m-0 flex flex-wrap items-center gap-x-3 text-15 text-accent-text empty:hidden">
          {sending ? t('adminTemplates.swap.new.uploading', { percent: sending.percent }) : state.status === 'done' ? (
            <>
              {t('adminTemplates.swap.new.added')}
              <Link href={`/admin/templates/${state.id}`} className="font-medium text-accent-text">{t('adminTemplates.swap.new.open')}</Link>
            </>
          ) : ''}
        </p>
      </div>
    </div>
  );
}
