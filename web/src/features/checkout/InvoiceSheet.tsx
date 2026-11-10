'use client';

import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { Invoice } from '@/data/ports';
import { formatDate, taxOf } from '@/shared/lib/format';
import { Button, Icon, Logo } from '@/shared/ui';

/** Print rules: A4 without browser margins (the sheet keeps its A4 padding and side-by-side layout through `print:` classes); the site chrome and the print button disappear; the paper stays white. */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 0 }
  html, body { background: none !important }
  body header:not(.invoice-sheet header), .invoice-no-print, a[href="#main"] { display: none !important }
  .page-gutter { padding-inline: 0 !important }
  main { padding: 0 !important }
  .invoice-page { gap: 0 !important }
  .invoice-scroll { overflow: visible !important; padding: 0 !important }
  .invoice-sheet { box-shadow: none !important; width: 210mm !important; min-height: 297mm !important; border: 0 !important }
}`;

const TH = 'border-b border-text pb-4 text-13 leading-snug font-semibold text-text-3';
const CELL = 'border-b border-edge-strong py-6 align-baseline';

export function InvoiceSheet({ invoice, customerName = '', customerEmail }: { invoice: Invoice; customerName?: string; customerEmail: string }) {
  const t = useT();
  const locale = useLocale();
  const date = formatDate(invoice.date, locale);
  // The amount the buyer paid, as the data layer prints it ('$54.00'); a pack without a price keeps the board placeholder.
  const price = invoice.amount ?? t('checkout.invoice.price');
  // Tax the payment provider added on top of the pack price: a line of its own, and the total is what was charged.
  const taxed = taxOf(invoice);
  return (
    <div className="invoice-page flex flex-col gap-6">
      <style>{PRINT_CSS}</style>
      <div className="invoice-no-print">
        <Button variant="secondary" onClick={() => window.print()}>
          <Icon name="download" size={18} className="mr-2" />
          {t('checkout.invoice.print')}
        </Button>
      </div>
      <div className="invoice-scroll overflow-x-auto">
        <article
          data-theme="light"
          className="invoice-sheet mx-auto box-border flex w-full max-w-198.5 flex-col bg-surface p-6 text-text shadow-[0_0_0_1px_var(--edge)] nav:min-h-280.75 nav:p-18 print:min-h-280.75 print:p-18"
        >
          <header className="flex items-baseline justify-between gap-8 border-b border-text pb-12">
            <Logo href="/account" className="-my-2.5 py-2.5" />
            <div className="flex flex-col items-end gap-3">
              <h1 className="m-0 heading-4">{t('checkout.invoice.title')}</h1>
              <dl className="m-0 flex flex-col gap-1 text-15 leading-normal">
                <div className="flex justify-end gap-2"><dt className="text-text-2">{t('checkout.invoice.no')}</dt><dd className="m-0 font-semibold">{invoice.number}</dd></div>
                <div className="flex justify-end gap-2"><dt className="text-text-2">{t('checkout.invoice.date')}</dt><dd className="m-0 font-semibold">{date}</dd></div>
              </dl>
            </div>
          </header>

          <div className="flex flex-col pb-6 pt-6 nav:pt-18 print:pt-18">
            <section aria-label={t('checkout.invoice.parties')} className="flex flex-col gap-6 nav:flex-row print:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-2 pr-8">
                <h2 className="m-0 text-13 leading-snug font-semibold text-text-3">{t('checkout.invoice.from')}</h2>
                <address className="text-15 leading-normal text-text-2 not-italic">
                  <span className="block text-17 font-semibold text-text">{t('checkout.invoice.company')}</span>
                  <span className="block">{t('checkout.invoice.address')}</span>
                  <span className="block">{t('checkout.invoice.email')}</span>
                </address>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2 pr-8">
                <h2 className="m-0 text-13 leading-snug font-semibold text-text-3">{t('checkout.invoice.billedTo')}</h2>
                <address className="text-15 leading-normal text-text-2 not-italic">
                  {customerName ? (
                    <>
                      <span className="block text-17 font-semibold text-text">{customerName}</span>
                      <span className="block">{customerEmail}</span>
                    </>
                  ) : (
                    <span className="block text-17 font-semibold text-text">{customerEmail}</span>
                  )}
                </address>
              </div>
            </section>

            <table className="mt-18 w-full table-fixed border-collapse text-15 leading-normal">
              <caption className="sr-only">{t('checkout.invoice.items')}</caption>
              <thead>
                <tr>
                  <th scope="col" className={`${TH} w-1/2 text-left`}>{t('checkout.invoice.description')}</th>
                  <th scope="col" className={`${TH} w-[10%] text-right tabular-nums`}>{t('checkout.invoice.qty')}</th>
                  <th scope="col" className={`${TH} w-1/5 text-right tabular-nums`}>{t('checkout.invoice.unit')}</th>
                  <th scope="col" className={`${TH} w-1/5 text-right tabular-nums`}>{t('checkout.invoice.amount')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" className={`${CELL} text-left font-normal`}>
                    <span className="block text-17 font-semibold">{t('checkout.success.packName', { name: invoice.packName })}</span>
                    <span className="block text-13 leading-snug text-text-2">{t('checkout.invoice.line', { credits: invoice.credits })}</span>
                  </th>
                  <td className={`${CELL} text-right tabular-nums`}>1</td>
                  <td className={`${CELL} text-right tabular-nums`}>{price}</td>
                  <td className={`${CELL} text-right tabular-nums`}>{price}</td>
                </tr>
              </tbody>
            </table>

            <section aria-label={t('checkout.invoice.totals')} className="mt-6 ml-auto flex w-1/2 flex-col text-15 leading-normal">
              <dl className="m-0 flex flex-col">
                <div className="flex items-baseline justify-between gap-4 py-3"><dt className="text-text-2">{t('checkout.invoice.subtotal')}</dt><dd className="m-0 text-right tabular-nums">{invoice.amount ?? t('checkout.invoice.subtotalValue')}</dd></div>
                {taxed && <div className="flex items-baseline justify-between gap-4 py-3"><dt className="text-text-2">{t('checkout.invoice.tax')}</dt><dd className="m-0 text-right tabular-nums">{taxed.tax}</dd></div>}
                <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-text pt-6">
                  <dt className="heading-6">{t('checkout.invoice.total')}</dt>
                  <dd className="m-0 text-right tabular-nums heading-5">{taxed?.total ?? invoice.amount ?? t('checkout.invoice.totalValue')}</dd>
                </div>
              </dl>
              <p className="m-0 mt-3 text-13 leading-snug text-text-2">{t('checkout.invoice.paid', { date })}</p>
            </section>
          </div>

          <footer className="mt-auto flex flex-col gap-1 border-t border-edge-strong pt-4 text-13 leading-snug text-text-2">
            <p className="m-0">{t('checkout.invoice.note')}</p>
            <p className="m-0 flex justify-between gap-4">
              <span>{t('checkout.invoice.support')}</span>
              <span>{t('checkout.invoice.page')}</span>
            </p>
          </footer>
        </article>
      </div>
    </div>
  );
}
