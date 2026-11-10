'use client';

import { useState } from 'react';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import { formatDate } from '@/shared/lib/format';
import { Button } from '@/shared/ui';
import { AdminActionDialog } from '../admin-common/AdminActionDialog';
import { refundPurchase } from './actions';

export type RefundTarget = { id: string; at: string; packName: string; credits: number; amount: string | null; invoiceNumber: string | null; balance: number;
  /** The total that was charged, where the provider added tax to the pack price: a refund gives back the whole payment. */
  total?: string | null;
  /** The gate's mark on the purchase. `refund-outside`: the whole payment went back at the provider already, so this refund sends no money and closes the purchase. */
  review?: string | null;
  /** What is left of the pack: the credits the refund takes out. Absent: the whole pack. */
  creditsLeft?: number };

/**
 * "Refund" on a purchase with an open request, "Try the refund again" on one that failed: a quiet button, then the confirmation
 * (what is removed, what is refunded, the reason). Nothing is sent before the dialog's own confirm button.
 */
export function RefundButton({ purchase, again }: { purchase: RefundTarget; again?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  const [asking, setAsking] = useState(false);
  const closing = purchase.review === 'refund-outside';
  const amount = purchase.total ?? purchase.amount ?? t('adminRevenue.placeholder.amount');
  // Credits of the pack that were spent are gone already: the refund removes what is left of it.
  const removed = purchase.creditsLeft ?? purchase.credits;
  const credits = t('common.credits.count', { count: removed });
  // The credits of an open request are held already; a failed refund gave them back to the balance, so they leave it now.
  const balanceAfter = again ? purchase.balance - removed : purchase.balance;
  return (
    <div className="inline-flex flex-col items-end">
      <Button type="button" variant="quiet" className="-mx-2 -my-3 px-2 whitespace-nowrap" onClick={() => setAsking(true)}>
        {t(again ? 'adminActions.refund.retryConfirm' : 'adminActions.refund.confirm')}
      </Button>
      {asking && (
        <AdminActionDialog
          onClose={() => setAsking(false)}
          title={t(again ? 'adminActions.refund.retryTitle' : 'adminActions.refund.title')}
          rows={[
            { label: t('adminActions.row.purchase'), value: t('adminActions.value.pack', { pack: purchase.packName, date: formatDate(purchase.at, locale) }) },
            { label: t('adminActions.row.invoice'), value: purchase.invoiceNumber ?? t('adminActions.row.noInvoice') },
            { label: t('adminActions.row.creditsRemoved'), value: credits },
            { label: t('adminActions.row.balanceAfter'), value: number.format(balanceAfter) },
            { label: t(closing ? 'adminActions.row.amountAtProvider' : 'adminActions.row.amount'), value: amount },
          ]}
          info={t(closing ? 'adminActions.refund.closeInfo' : 'adminActions.refund.info', { credits })}
          reasonHint="long"
          confirmLabel={t(again ? 'adminActions.refund.retryConfirm' : 'adminActions.refund.confirm')}
          confirmVariant="warn"
          perform={(reason, key) => refundPurchase({ purchaseId: purchase.id, reason, key })}
          doneRows={(done) => [
            { label: t(done.closed ? 'adminActions.row.amountAtProvider' : 'adminActions.row.amountRefunded'), value: done.amount ?? t('adminRevenue.placeholder.amount') },
            { label: t('adminActions.row.creditsRemoved'), value: t('common.credits.count', { count: done.credits }) },
            { label: t('adminActions.row.balanceAfter'), value: number.format(done.balanceAfter) },
          ]}
          doneNote={(done) => t(done.closed ? 'adminActions.refund.closed' : done.confirmed ? 'adminActions.refund.sent' : 'adminActions.refund.unconfirmed')}
          refusedNote={(why) => t(why === 'no-funds' ? 'adminActions.refund.refusedNoFunds' : 'adminActions.refund.refused')}
        />
      )}
    </div>
  );
}
