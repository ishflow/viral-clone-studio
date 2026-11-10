'use client';

import { useActionState, useRef, useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import type { Template } from '@/data/ports';
import { Button } from '@/shared/ui';
import { ConfirmDialog } from './ConfirmDialog';
import { publishSwapVideo, withdrawSwapVideo, type SwapStatusError, type SwapStatusState } from './swap-actions';

const IDLE: SwapStatusState = { status: 'idle' };
/** What keeps a video from being published now: the fields hold what is not saved, or the people are not set / not written yet. */
export type PublishBlock = 'dirty' | 'unset' | 'pending' | null;

const ERROR_KEY: Record<SwapStatusError, string> = {
  peopleUnset: 'adminTemplates.swap.status.error.peopleUnset', transition: 'adminTemplates.swap.status.error.transition', failed: 'adminTemplates.swap.status.error.failed',
  notReady: 'adminTemplates.swap.edit.error.notReady', gone: 'adminTemplates.swap.edit.error.gone',
};

/** Publish (closed, with the reason, while `blocked`) for a video that waits or is hidden; Withdraw, after a question, for a published one. */
export function PublishBar({ template, blocked }: { template: Template; blocked: PublishBlock }) {
  const t = useT();
  const [publishState, publish, publishing] = useActionState(publishSwapVideo, IDLE);
  const [withdrawState, withdraw, withdrawing] = useActionState(withdrawSwapVideo, IDLE);
  const [asking, setAsking] = useState(false);
  const withdrawForm = useRef<HTMLFormElement>(null);
  const error = [publishState, withdrawState].find((state) => state.status === 'error')?.error;
  const done = publishState.status === 'done' ? 'published' : withdrawState.status === 'done' ? 'withdrawn' : null;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-6">
      {template.status === 'published' ? (
        <>
          <form ref={withdrawForm} action={withdraw} className="contents">
            <input type="hidden" name="id" value={template.id} />
            <Button variant="warn" pending={withdrawing} onClick={() => setAsking(true)} className="w-fit max-nav:w-full">{t('adminTemplates.swap.status.withdraw')}</Button>
          </form>
          <ConfirmDialog
            open={asking} title={t('adminTemplates.swap.status.confirm.title')} text={t('adminTemplates.swap.status.confirm.text')} confirmLabel={t('adminTemplates.swap.status.withdraw')}
            onCancel={() => setAsking(false)}
            onConfirm={() => {
              setAsking(false);
              withdrawForm.current?.requestSubmit();
            }}
          />
        </>
      ) : (
        <form action={publish} className="contents">
          <input type="hidden" name="id" value={template.id} />
          <Button type="submit" variant="secondary" pending={publishing} disabled={blocked !== null} className="w-fit max-nav:w-full">{t('adminTemplates.swap.status.publish')}</Button>
        </form>
      )}
      {blocked && template.status !== 'published' && <p className="m-0 text-13 leading-snug text-text-3">{t(`adminTemplates.swap.status.blocked.${blocked}`)}</p>}
      <p role="status" className="m-0 text-15 leading-normal text-accent-text empty:hidden">{done ? t(`adminTemplates.swap.status.${done}`) : ''}</p>
      {error && <p role="alert" className="m-0 text-15 text-warn">{t(ERROR_KEY[error])}</p>}
    </div>
  );
}
