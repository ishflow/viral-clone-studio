'use client';

import { useFormStatus } from 'react-dom';
import { useT } from '@/core/i18n/I18nProvider';
import type { Checkout } from '@/data/ports';
import { Button, Card, LinkButton } from '@/shared/ui';
import { settleCheckout } from './actions';

function Buttons() {
  const t = useT();
  const { pending } = useFormStatus();
  // The provider's answers: the two final ones, then the three a real provider can give instead (B4).
  return (
    <>
      <Button type="submit" name="outcome" value="paid" pending={pending} className="flex-[2_1_160px]">{t('checkout.mock.pay')}</Button>
      <Button type="submit" name="outcome" value="declined" variant="secondary" disabled={pending} className="flex-[1_1_160px]">{t('checkout.mock.decline')}</Button>
      <div className="flex w-full flex-wrap gap-3">
        {(['pending', 'cancelled', 'expired'] as const).map((outcome) => (
          <Button key={outcome} type="submit" name="outcome" value={outcome} variant="secondary" disabled={pending} className="flex-[1_1_120px]">
            {t(`checkout.mock.${outcome}`)}
          </Button>
        ))}
      </div>
    </>
  );
}

/** Stand-in for the payment provider's page. Not on the canvas; plain on purpose. Pack and returnTo come from the stored checkout. */
export function MockProvider({ checkout }: { checkout: Checkout }) {
  const t = useT();
  const { pack } = checkout;
  const rows: [string, string][] = [
    [t('checkout.mock.pack'), t('checkout.success.packName', { name: pack.name })],
    [t('checkout.mock.credits'), String(pack.credits)],
    [t('checkout.success.paid'), pack.price ?? t('checkout.mock.price')],
  ];
  const result = `/checkout/return?checkout=${encodeURIComponent(checkout.id)}&returnTo=${encodeURIComponent(checkout.returnTo)}`;
  return (
    <Card as="section" className="mx-auto flex w-full max-w-130 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 heading-4">{t('checkout.mock.title')}</h1>
        <p className="m-0 text-15 leading-normal text-text-2">{t('checkout.mock.note')}</p>
      </div>
      <dl className="m-0 flex flex-col">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-t border-line py-3 text-15">
            <dt className="text-text-2">{label}</dt>
            <dd className="m-0 font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {checkout.status === 'open' || checkout.status === 'pending' ? (
        <form action={settleCheckout} className="flex flex-wrap gap-3">
          <input type="hidden" name="checkoutId" value={checkout.id} />
          <Buttons />
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p role="status" className="m-0 text-15 text-text-2">{t('checkout.mock.settled')}</p>
          <LinkButton href={result} variant="secondary" className="self-start">{t('checkout.mock.settledLink')}</LinkButton>
        </div>
      )}
    </Card>
  );
}
