'use client';

import { useActionState, useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { dropAllDrafts } from '@/shared/lib/session-draft';
import { Button, Dialog, Field, Input } from '@/shared/ui';
import { Notice } from '@/shared/ui/Notice';
import { deleteAccount, type DeleteState } from './actions';
import { DELETE_WORD } from './schema';

export function DeleteAccount({ balanceLabel, jobRunning = false }: { balanceLabel: string; jobRunning?: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteAccount, { status: 'idle' });
  const running = jobRunning || state.status === 'running';
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const close = () => {
    setOpen(false);
    setTyped('');
  };
  const rows: [string, string][] = [
    [t('account.delete.videos'), t('account.delete.videosValue')],
    [t('account.delete.credits'), t('account.delete.creditsValue', { credits: balanceLabel })],
  ];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-15 text-warn">
        {t('account.delete.open')}
      </button>
      <Dialog open={open} onClose={close} title={t('account.delete.title')} className="nav:max-w-148">
        <form action={action} onSubmit={dropAllDrafts} className="flex flex-col gap-6">
          <p className="m-0 -mt-4 text-15 leading-normal text-text-2">{t('account.delete.intro')}</p>
          <dl className="m-0 flex flex-col border-b border-edge">
            {rows.map(([label, value]) => (
              <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-edge py-3 text-15">
                <dt className="text-text-2">{label}</dt>
                <dd className="m-0 ml-auto text-right font-semibold wrap-anywhere">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0 -mt-3 text-13 leading-snug text-text-3">{t('account.delete.invoicesNote')}</p>
          {running && (
            <Notice>
              <strong className="font-semibold">{t('account.delete.running')}</strong> {t('account.delete.runningText')}
            </Notice>
          )}
          {state.status === 'failed' && (
            <Notice>
              <strong className="font-semibold">{t('account.delete.failed')}</strong> {t('account.delete.failedText')}
            </Notice>
          )}
          <Field label={t('account.delete.confirm')}>
            <Input name="confirm" type="text" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={close} disabled={pending} className="flex-[2_1_240px]">{t('account.delete.keep')}</Button>
            <Button type="submit" variant="warn" pending={pending} disabled={running || typed !== DELETE_WORD} className="flex-[1_1_160px]">{pending ? t('account.delete.deleting') : t('account.delete.submit')}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
