'use client';

import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { useT } from '@/core/i18n/I18nProvider';
import { Card, LinkButton } from '@/shared/ui';
import { startCheckout } from './actions';
import { DEFAULT_RETURN, type Draft } from './draft-view';
import { DraftSummary } from './DraftCard';

const BIG = 'box-border flex min-h-18 flex-col justify-center gap-1 rounded-12 px-4 py-3 text-left no-underline';

/** "Try again": submits the form around it (a new checkout is opened by a POST, never by an address). */
function RetryButton({ sub }: { sub: string }) {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending || undefined} className={`${BIG} w-full cursor-pointer border-0 bg-accent font-[inherit] text-on-accent disabled:cursor-not-allowed disabled:opacity-60`}>
      <span className="text-15 font-semibold">{t('checkout.failed.retry')}</span>
      <span className="text-13">{sub}</span>
    </button>
  );
}

export function FailedView({ packId, packName, credits, price, balance, returnTo, draft }: { packId: string; packName: string; credits: number; price: string | null; balance: number; returnTo: string; draft: Draft | null }) {
  const t = useT();
  // The way back (a waiting video, a stopped job) survives both ways out: a new try, and another pack.
  const pricing = returnTo === DEFAULT_RETURN ? '/pricing' : `/pricing?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <div className="flex flex-col gap-12 pt-4">
      <section className="flex flex-col gap-3">
        <span className="flex items-center gap-2 text-15 font-semibold text-warn">
          <span aria-hidden="true" className="size-2 rounded-[2px] bg-warn" />
          {t('checkout.failed.status')}
        </span>
        <h1 className="m-0 heading-3">{t('checkout.failed.title')}</h1>
        <p className="m-0 max-w-155 text-17 leading-normal text-text-2 text-pretty">{t('checkout.failed.text', { balance: t('common.credits.count', { count: balance }) })}</p>
      </section>
      <div className="flex flex-wrap items-start gap-8">
        <Card as="section" aria-labelledby="h-next" className="flex min-w-0 flex-[1_1_420px] flex-col gap-6 border-warn-edge">
          <div className="flex flex-col gap-2">
            <h2 id="h-next" className="m-0 heading-5">{t('checkout.failed.next')}</h2>
            <p className="m-0 text-15 leading-normal text-text-2 text-pretty">{t('checkout.failed.message')}</p>
          </div>
          <div className="flex flex-col gap-3">
            <form action={startCheckout.bind(null, packId, returnTo)} className="flex">
              <RetryButton sub={t('checkout.failed.retrySub', { pack: packName, credits, price: price ?? t('checkout.mock.price') })} />
            </form>
            <Link href={pricing} className={`${BIG} border border-edge-strong text-text`}>
              <span className="text-15 font-semibold">{t('checkout.failed.another')}</span>
              <span className="text-13 text-text-3">{t('checkout.failed.anotherSub')}</span>
            </Link>
            <Link href="/contact" className="flex min-h-11 items-center gap-2 self-start text-15 font-medium no-underline">
              {t('checkout.failed.support')}
            </Link>
          </div>
        </Card>
        {draft && (
          <Card as="section" aria-labelledby="h-safe" className="flex min-w-0 flex-[1_1_420px] flex-col gap-6">
            <h2 id="h-safe" className="m-0 heading-5">{t('checkout.failed.safe')}</h2>
            <DraftSummary draft={draft} />
            <p className="m-0 text-15 leading-normal text-text-2 text-pretty">{t('checkout.failed.safeText')}</p>
            <LinkButton href={returnTo} variant="secondary" size="l" className="self-stretch nav:self-start">{t('checkout.waiting.back')}</LinkButton>
          </Card>
        )}
      </div>
    </div>
  );
}
