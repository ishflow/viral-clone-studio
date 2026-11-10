'use client';
import { PROVIDER_CAP_MESSAGE } from '@/core/provider-cap-message';

import { useActionState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { Button } from '@/shared/ui';
import { addLink, type LinkState } from './actions';

const IDLE: LinkState = { status: 'idle' };

/**
 * "Paste a link: TikTok or YouTube video" + "Add candidate". Checked again on the server.
 * 520 px wide from the `nav` breakpoint, as on the board (`!`: PageHead sets its action children to `w-auto`).
 */
export function AddLinkForm() {
  const t = useT();
  const [state, action, pending] = useActionState(addLink, IDLE);
  const error = state.status === 'error' ? state.providerCap ? PROVIDER_CAP_MESSAGE : t(state.error === 'linkInvalid' ? 'adminTemplates.inbox.linkInvalid' : 'adminTemplates.inbox.linkFailed') : undefined;
  return (
    <form action={action} noValidate className="flex w-full min-w-0 flex-col gap-2 nav:w-130!">
      <div className="flex items-start gap-3 max-nav:flex-wrap">
        <input
          type="url" name="url" aria-label={t('adminTemplates.inbox.linkLabel')} placeholder={t('adminTemplates.inbox.linkPlaceholder')}
          aria-invalid={error ? true : undefined} aria-describedby={error ? 'link-error' : undefined}
          className="box-border min-h-13 min-w-0 flex-[1_1_240px] rounded-12 border border-edge-strong bg-bg px-4 text-15 text-text aria-invalid:border-[1.5px] aria-invalid:border-warn"
        />
        <Button type="submit" variant="secondary" pending={pending} className="whitespace-nowrap max-nav:w-full">{t('adminTemplates.inbox.addCandidate')}</Button>
      </div>
      {error && <p id="link-error" role="alert" className="m-0 text-13 leading-snug text-warn">{error}</p>}
      <p role="status" className="m-0 text-13 leading-snug text-accent-text empty:hidden">{state.status === 'done' ? t('adminTemplates.inbox.linkAdded') : ''}</p>
    </form>
  );
}
