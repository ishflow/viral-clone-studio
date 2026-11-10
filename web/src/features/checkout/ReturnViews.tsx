'use client';

import { useT } from '@/core/i18n/I18nProvider';
import type { Checkout } from '@/data/ports';
import { Button, Icon, LinkButton } from '@/shared/ui';
import type { Draft } from './draft';
import { OrderCard, WaitingCard } from './OrderCard';
import { checkPayment } from './actions';
import { PollRefresh } from './PollRefresh';

function Head({ tone, label, title, text }: { tone: 'info' | 'warn'; label: string; title: string; text: string }) {
  return (
    <section className="flex flex-col gap-3">
      <span className={`flex items-center gap-2 text-15 font-semibold ${tone === 'warn' ? 'text-warn' : 'text-accent-text'}`}>
        <span aria-hidden="true" className={`size-2 rounded-[2px] ${tone === 'warn' ? 'bg-warn' : 'bg-accent'}`} />
        {label}
      </span>
      <h1 className="m-0 heading-3">{title}</h1>
      <p className="m-0 max-w-155 text-17 leading-normal text-text-2 text-pretty">{text}</p>
    </section>
  );
}

/** A-Odeme-Dogrulaniyor: back from the provider, no answer yet. No button on purpose (nothing to press; paying again is the thing to avoid). */
export function ConfirmingView({ checkout, returnTo, draft }: { checkout: Checkout; returnTo: string; draft: Draft | null }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-12 pt-4">
      <PollRefresh />
      <Head tone="info" label={t('checkout.verifying.status')} title={t('checkout.verifying.title')} text={t('checkout.verifying.text')} />
      <div className="flex flex-wrap items-start gap-8">
        <OrderCard checkout={checkout} status={t('checkout.verifying.state')} />
        <WaitingCard draft={draft} returnTo={returnTo} />
      </div>
    </div>
  );
}

/** A-Odeme-Gecikti: still pending after `RULES.checkoutWaitSeconds`. Nothing here takes a payment. */
export function DelayedView({ checkout, returnTo, draft }: { checkout: Checkout; returnTo: string; draft: Draft | null }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-12 pt-4">
      <Head tone="warn" label={t('checkout.delayed.status')} title={t('checkout.delayed.title')} text={t('checkout.delayed.text')} />
      <div className="flex flex-col gap-3 nav:flex-row">
        <form action={checkPayment}>
          <input type="hidden" name="checkoutId" value={checkout.id} />
          <Button type="submit" size="l" variant="secondary">
            <Icon name="retry" size={18} className="mr-2" />
            {t('checkout.delayed.check')}
          </Button>
        </form>
        <LinkButton href="/contact?topic=payment" size="l" variant="secondary">{t('checkout.delayed.support')}</LinkButton>
      </div>
      <div className="flex flex-wrap items-start gap-8">
        <OrderCard checkout={checkout} status={t('checkout.verifying.state')} reference={checkout.reference} />
        <WaitingCard draft={draft} returnTo={returnTo} />
      </div>
    </div>
  );
}

/** A-Odeme-Durumlar: the customer left the provider page, or the checkout ran out. Nothing was charged. */
export function StoppedCheckoutView({ status, returnTo, draft }: { status: 'cancelled' | 'expired'; returnTo: string; draft: Draft | null }) {
  const t = useT();
  const pricing = returnTo === '/gallery' ? '/pricing' : `/pricing?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <div className="flex flex-col gap-12 pt-4">
      <Head tone="warn" label={t(`checkout.stopped.${status}.status`)} title={t(`checkout.stopped.${status}.title`)} text={t(`checkout.stopped.${status}.text`)} />
      <div className="flex flex-col gap-3 nav:flex-row">
        <LinkButton href={pricing} size="l">{t('checkout.stopped.pricing')}</LinkButton>
      </div>
      <div className="flex flex-wrap items-start gap-8">
        <WaitingCard draft={draft} returnTo={returnTo} />
      </div>
    </div>
  );
}
