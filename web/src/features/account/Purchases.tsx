'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import { RULES, type Purchase } from '@/data/ports';
import { formatDate, taxOf } from '@/shared/lib/format';
import { Button, Card, Dialog } from '@/shared/ui';
import { Notice } from '@/shared/ui/Notice';
import { cancelRefund, requestRefund, type RefundState } from './actions';

const IDLE: RefundState = { status: 'idle' };

/** What a refund gives back: the whole payment, so the total that was charged where the provider added tax to the pack price. */
const refundAmount = (purchase: Purchase) => taxOf(purchase)?.total ?? purchase.amount ?? '';

/** A-Hesap-Iade-Onay: nothing is sent until "Request refund"; the safe button is the wide one. One request per press (the button is busy meanwhile). */
function RequestRefund({ purchase, open, onClose }: { purchase: Purchase; open: boolean; onClose: () => void }) {
  const t = useT();
  const [state, action, pending] = useActionState(requestRefund, IDLE);
  return (
    <Dialog open={open} onClose={onClose} title={t('account.purchases.dialog.title', { pack: purchase.packName, credits: purchase.credits, amount: refundAmount(purchase) })} className="nav:max-w-148">
      <form action={action} className="flex flex-col gap-6">
        <input type="hidden" name="purchaseId" value={purchase.id} />
        <p className="m-0 -mt-4 text-15 leading-normal text-text-2">{t('account.purchases.dialog.text', { credits: purchase.credits })}</p>
        {state.status === 'error' && <Notice>{t('account.purchases.refund.error')}</Notice>}
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={onClose} disabled={pending} className="flex-[2_1_240px]">{t('account.purchases.dialog.keep')}</Button>
          <Button type="submit" variant="warn" pending={pending} className="flex-[1_1_160px]">{t('account.purchases.dialog.submit')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function Refund({ purchase }: { purchase: Purchase }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [cancelled, cancelAction, cancelling] = useActionState(cancelRefund, IDLE);
  const credits = purchase.credits;
  switch (purchase.status) {
    case 'paid': {
      const refundable = purchase.refundable;
      return (
        <>
          {cancelled.status === 'cancelled' && <Notice tone="info" icon="done">{t('account.purchases.refund.cancelled', { credits })}</Notice>}
          {refundable?.ok ? (
            <>
              <Button variant="secondary" onClick={() => setOpen(true)} className="self-start">{t('account.purchases.refund.request')}</Button>
              <RequestRefund purchase={purchase} open={open} onClose={() => setOpen(false)} />
            </>
          ) : refundable ? (
            <p className="m-0 text-13 leading-snug text-text-3">
              {refundable.reason === 'used' ? t('account.purchases.refund.used') : t('account.purchases.refund.tooOld', { days: RULES.refundDays })}
            </p>
          ) : null}
        </>
      );
    }
    case 'refund-requested':
      return (
        <>
          <p className="m-0 text-13 leading-snug text-text-2">{t('account.purchases.refund.requested', { reply: RULES.supportReplyDays, credits })}</p>
          <form action={cancelAction} className="flex flex-col gap-2">
            <input type="hidden" name="purchaseId" value={purchase.id} />
            <Button type="submit" variant="secondary" pending={cancelling} className="self-start">{t('account.purchases.refund.cancel')}</Button>
            {cancelled.status === 'error' && <Notice>{t('account.purchases.refund.error')}</Notice>}
          </form>
        </>
      );
    case 'refund-sent':
      return <p className="m-0 text-13 leading-snug text-text-2">{t('account.purchases.refund.sent', { credits })}</p>;
    case 'refunded':
      return (
        <p className="m-0 text-13 leading-snug text-text-2">
          {t('account.purchases.refund.refunded', { date: formatDate(purchase.refund?.settledAt ?? purchase.at, locale), amount: refundAmount(purchase) })}
        </p>
      );
    case 'refund-failed':
      return (
        <>
          <p className="m-0 text-13 leading-snug text-warn">{t('account.purchases.refund.failed', { credits })}</p>
          <Link href="/contact?topic=refund" className="flex min-h-11 items-center self-start text-15 font-semibold no-underline">{t('account.purchases.refund.support')}</Link>
        </>
      );
    default:
      return null;
  }
}

/** The purchases of the account (A-Hesap): one row per pack with its state and, where it applies, the refund action. */
export function Purchases({ purchases, className }: { purchases: Purchase[]; className?: string }) {
  const t = useT();
  const locale = useLocale();
  return (
    <Card as="section" aria-labelledby="h-purchases" className={`${className ?? ''} flex flex-col gap-2`}>
      <h2 id="h-purchases" className="m-0 mb-2 heading-5">{t('account.purchases.title')}</h2>
      {purchases.length === 0 ? (
        <p className="m-0 border-t border-line pt-3 text-15 text-text-2">{t('account.purchases.empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {purchases.map((purchase) => {
            // Tax the payment provider added: the line says the total that was charged and what it is made of.
            const taxed = taxOf(purchase);
            const line = { status: t(`account.purchases.status.${purchase.status}`), date: formatDate(purchase.at, locale), amount: purchase.amount ?? '' };
            return (
            <li key={purchase.id} className="flex flex-col gap-2 border-t border-line py-3">
              <div className="flex items-center justify-between gap-4">
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-15 font-semibold">{t('account.activity.pack', { name: purchase.packName })}</span>
                  <span className="text-13 text-text-3">
                    {taxed ? t('account.purchases.lineTaxed', { ...line, ...taxed }) : t('account.purchases.line', line)}
                  </span>
                </span>
                <span className="flex flex-none flex-col items-end nav:flex-row nav:gap-4">
                  {purchase.invoiceUrl && (
                    // The payment provider is the seller, and its invoice is on its own site: the site's own page stays beside it, so one is left if the other does not open.
                    <a href={purchase.invoiceUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center text-15 font-semibold no-underline">
                      {t('account.purchases.invoiceDodo')}
                    </a>
                  )}
                  {purchase.invoiceId && (
                    <Link href={`/invoices/${purchase.invoiceId}`} className="flex min-h-11 items-center text-15 font-semibold no-underline">
                      {t('account.purchases.download')}
                    </Link>
                  )}
                </span>
              </div>
              <Refund purchase={purchase} />
            </li>
            );
          })}
        </ul>
      )}
      <p className="m-0 border-t border-line pt-3 text-13 text-text-3">
        {t('account.purchases.help')}{' '}
        <Link href="/contact" className="font-semibold">{t('account.purchases.helpLink')}</Link>
      </p>
    </Card>
  );
}
