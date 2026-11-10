'use client';

import { useState } from 'react';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import { Button, Field, Input } from '@/shared/ui';
import { AdminActionDialog } from '../admin-common/AdminActionDialog';
import { addCredits } from './actions';
import { MAX_CREDITS } from './schema';

/**
 * "Add credits": the number and a button. The button opens the confirmation (balance now / credits to add / balance after + the reason);
 * nothing is sent before that dialog's own confirm button.
 */
export function AddCreditsForm({ userId, balance }: { userId: string; balance: number }) {
  const t = useT();
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [asking, setAsking] = useState<number | null>(null);
  const credits = Number(value);
  const open = () => {
    if (value.trim() === '' || !Number.isInteger(credits) || credits < 1 || credits > MAX_CREDITS) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setAsking(credits);
  };
  return (
    <div role="group" aria-labelledby="h-add" className="flex min-w-0 flex-[3_1_560px] flex-col gap-4">
      <h3 id="h-add" className="m-0 text-17 leading-snug font-semibold">{t('adminUsers.detail.add.title')}</h3>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          open();
        }}
        className="flex flex-wrap items-start gap-4"
      >
        <Field label={t('adminUsers.detail.add.credits')} error={invalid ? t('adminUsers.detail.add.error.credits') : undefined} className="min-w-0 flex-[0_1_200px] max-nav:flex-[1_1_100%]">
          <Input name="credits" type="number" min={1} step={1} inputMode="numeric" placeholder="0" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary" className="max-nav:w-full nav:mt-7">{t('adminUsers.detail.add.submit')}</Button>
      </form>
      {asking !== null && (
        <AdminActionDialog
          onClose={() => setAsking(null)}
          title={t('adminActions.addCredits.title')}
          rows={[
            { label: t('adminActions.row.balanceNow'), value: number.format(balance) },
            { label: t('adminActions.row.toAdd'), value: number.format(asking) },
            { label: t('adminActions.row.balanceAfter'), value: number.format(balance + asking) },
          ]}
          reasonHint="long"
          confirmLabel={t('adminActions.addCredits.confirm')}
          perform={(reason, key) => addCredits({ userId, credits: asking, reason, key })}
          doneRows={(done) => [
            { label: t('adminActions.row.toAdd'), value: number.format(done.credits) },
            { label: t('adminActions.row.balanceAfter'), value: number.format(done.balanceAfter) },
          ]}
        />
      )}
    </div>
  );
}
