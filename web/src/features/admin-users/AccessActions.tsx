'use client';

import { useActionState, useState } from 'react';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import { formatDate } from '@/shared/lib/format';
import { Button, Icon } from '@/shared/ui';
import { AdminActionDialog } from '../admin-common/AdminActionDialog';
import { sendPasswordReset, setAccess, type ResetState } from './actions';

/**
 * "Access": password reset email and block / unblock. Both asks first (a dialog with the facts and a required reason);
 * a blocked user shows the block (when and why). The admin's own page has no Block button.
 */
export function AccessActions({ userId, blocked, block, balance, videos, isSelf }: { userId: string; blocked: boolean; block: { at: string; reason: string } | null; balance: number; videos: number; isSelf: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [asking, setAsking] = useState(false);
  const [reset, resetAction, resetting] = useActionState<ResetState, FormData>(sendPasswordReset, { status: 'idle' });
  return (
    <div role="group" aria-labelledby="h-access" className="flex min-w-0 flex-[2_1_360px] flex-col gap-4 max-nav:border-t max-nav:border-line max-nav:pt-6">
      <h3 id="h-access" className="m-0 text-17 leading-snug font-semibold">{t('adminUsers.detail.access.title')}</h3>
      {blocked && (
        <div data-blocked-card className="flex flex-col gap-1 rounded-12 border border-warn-edge p-4 text-15 leading-snug">
          <p className="m-0 flex items-center gap-2 font-semibold text-warn">
            <Icon name="warning" size={18} />
            {t('adminUsers.status.blocked')}
          </p>
          {block && <p className="m-0 text-text-2">{t('adminUsers.detail.access.blockedOn', { date: formatDate(block.at, locale) })}</p>}
          {block?.reason && <p className="m-0 text-text-2">{t('adminUsers.detail.access.blockReason', { reason: block.reason })}</p>}
        </div>
      )}
      <div className="mt-auto flex flex-col items-stretch gap-3 nav:flex-row nav:flex-wrap">
        <form action={resetAction} className="flex flex-col">
          <input type="hidden" name="userId" value={userId} />
          <Button type="submit" variant="secondary" pending={resetting}>{t('adminUsers.detail.access.reset')}</Button>
        </form>
        {blocked && <Button type="button" variant="primary" onClick={() => setAsking(true)}>{t('adminUsers.detail.access.unblock')}</Button>}
        {!blocked && !isSelf && <Button type="button" variant="warn" onClick={() => setAsking(true)}>{t('adminUsers.detail.access.block')}</Button>}
      </div>
      {asking && (
        <AdminActionDialog
          onClose={() => setAsking(false)}
          title={t(blocked ? 'adminActions.unblock.title' : 'adminActions.block.title')}
          rows={
            blocked
              ? [
                  ...(block ? [{ label: t('adminActions.row.blockedOn'), value: formatDate(block.at, locale) }] : []),
                  ...(block?.reason ? [{ label: t('adminActions.row.blockReason'), value: block.reason }] : []),
                ]
              : [
                  { label: t('adminActions.row.creditsKept'), value: t('adminActions.value.creditsKept', { count: balance }) },
                  { label: t('adminActions.row.videosKept'), value: t('adminActions.value.videosKept', { count: videos }) },
                ]
          }
          info={t(blocked ? 'adminActions.unblock.info' : 'adminActions.block.info')}
          confirmLabel={t(blocked ? 'adminActions.unblock.confirm' : 'adminActions.block.confirm')}
          confirmVariant={blocked ? 'primary' : 'warn'}
          perform={(reason) => setAccess({ userId, blocked: !blocked, reason })}
          doneRows={() => []}
          doneNote={() => t(blocked ? 'adminUsers.detail.access.unblocked' : 'adminUsers.detail.access.blocked')}
        />
      )}
      <p role="status" className="m-0 text-15 text-accent-text empty:hidden">{reset.status === 'sent' ? t('adminUsers.detail.access.resetSent') : ''}</p>
      {reset.status === 'error' && <p role="alert" className="m-0 text-15 text-warn">{t('adminUsers.detail.access.resetFailed')}</p>}
      <p className="m-0 text-13 leading-snug text-text-3">{t('adminUsers.detail.access.note')}</p>
    </div>
  );
}
