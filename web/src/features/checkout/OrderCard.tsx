'use client';

import Link from 'next/link';
import { useT } from '@/core/i18n/I18nProvider';
import type { Checkout } from '@/data/ports';
import { Card, LinkButton } from '@/shared/ui';
import { DEFAULT_RETURN, type Draft } from './draft-view';
import { DraftSummary } from './DraftCard';

/** "Your order": pack, credits, price and the state of the payment. `status` is the already translated state. */
export function OrderCard({ checkout, status, reference }: { checkout: Checkout; status: string; reference?: string | null }) {
  const t = useT();
  const { pack } = checkout;
  const rows: [string, string][] = [
    [t('checkout.order.pack'), t('checkout.success.packName', { name: pack.name })],
    [t('checkout.order.credits'), String(pack.credits)],
    [t('checkout.order.price'), pack.price ?? t('checkout.mock.price')],
    [t('checkout.order.status'), status],
  ];
  return (
    <Card as="section" aria-labelledby="h-order" className="flex min-w-0 flex-[1_1_420px] flex-col gap-3">
      <h2 id="h-order" className="m-0 mb-1 heading-5">{t('checkout.order.title')}</h2>
      <dl className="m-0 flex flex-col">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-line py-3 text-15">
            <dt className="text-text-2">{label}</dt>
            <dd className="m-0 ml-auto text-right font-semibold wrap-anywhere">{value}</dd>
          </div>
        ))}
      </dl>
      {reference && <p className="m-0 text-13 text-text-3 wrap-anywhere">{t('checkout.order.reference', { reference })}</p>}
    </Card>
  );
}

/** "Your video is waiting": the saved form behind the way back. Without a draft, the way back alone (or the gallery). */
export function WaitingCard({ draft, returnTo }: { draft: Draft | null; returnTo: string }) {
  const t = useT();
  if (!draft && returnTo === DEFAULT_RETURN) return null;
  return (
    <Card as="section" aria-labelledby="h-waiting" className="flex min-w-0 flex-[1_1_420px] flex-col gap-6">
      <h2 id="h-waiting" className="m-0 heading-5">{t('checkout.waiting.title')}</h2>
      {draft && <DraftSummary draft={draft} />}
      <p className="m-0 text-15 leading-normal text-text-2">{t('checkout.saved')}</p>
      <LinkButton href={returnTo} variant="secondary" size="l" className="self-stretch nav:self-start">{t('checkout.waiting.back')}</LinkButton>
    </Card>
  );
}

/** The back link of the states with no video waiting. */
export function PricingLink({ returnTo }: { returnTo: string }) {
  const t = useT();
  const pricing = returnTo === DEFAULT_RETURN ? '/pricing' : `/pricing?returnTo=${encodeURIComponent(returnTo)}`;
  return <Link href={pricing} className="flex min-h-11 items-center self-start text-15 font-medium no-underline">{t('checkout.stopped.pricing')}</Link>;
}
