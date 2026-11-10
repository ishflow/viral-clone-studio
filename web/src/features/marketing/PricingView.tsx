'use client';

import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { useT } from '@/core/i18n/I18nProvider';
import type { CreditRates } from '@/data/ports';
import { cx } from '@/shared/lib/cx';
import { Notice } from '@/shared/ui/Notice';
import { FEATURED_PACK_ID, VISITOR_BUY_HREF } from './pricing';

export type PackView = { id: string; name: string; credits: number; price: string | null };
/** Opens a checkout for a pack (a server action of the checkout feature; the page hands it in). */
export type BuyAction = (packId: string, returnTo?: string) => Promise<void>;

const buyLook = (hot: boolean) =>
  cx(
    'box-border flex min-h-13 w-full items-center justify-center rounded-12 border text-15 font-semibold no-underline',
    hot ? 'border-on-accent bg-on-accent text-on-scrim' : 'border-edge-strong bg-transparent text-text',
  );

/** The Buy button of a signed-in user: submits the form around it. */
function BuyButton({ hot }: { hot: boolean }) {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending || undefined} className={cx(buyLook(hot), 'cursor-pointer font-[inherit] disabled:cursor-not-allowed disabled:opacity-60')}>
      {t('marketing.pricing.buy')}
    </button>
  );
}

const COSTS = ['noTalkingFast', 'noTalkingBest', 'talkingFast', 'talkingBest', 'ownTemplate'] as const;

/** Credits of each row of the table: one source, `payments.rates()` (the same numbers the jobs are charged). */
export function costOf(rates: CreditRates, row: (typeof COSTS)[number]): number {
  switch (row) {
    case 'noTalkingFast': return rates.perVideo['no-talking'].fast;
    case 'noTalkingBest': return rates.perVideo['no-talking'].best;
    case 'talkingFast': return rates.perVideo.talking.fast;
    case 'talkingBest': return rates.perVideo.talking.best;
    case 'ownTemplate': return rates.ownTemplate;
  }
}
/** The questions of the page; the first one is "What is free?", shown only while the offer is true. */
const FAQ = [1, 2, 3, 4, 5, 6, 7, 8];
const FREE_FAQ = 1;
const NOTES = ['pack-starter', 'pack-standard', 'pack-studio'];

/**
 * A visitor's Buy is a link to sign up. A signed-in user's Buy is a form: starting a checkout changes state, so it is a POST
 * (a link would be prefetched, and every visible Buy button would open a checkout).
 * `freeOffer`: may the page say the first video is free (`freeOffer()` in core; the page decides); when it may not, the lead and the first question leave it out.
 * `invite`: a visitor who cannot sign up (invite mode): no free-video lead or question, and Buy asks for an invite at `/contact`.
 */
export function PricingView({ packs, rates, signedIn, freeOffer: offered, invite = false, returnTo, buy, notice }: { packs: PackView[]; rates: CreditRates; signedIn: boolean; freeOffer: boolean; invite?: boolean; returnTo?: string; buy?: BuyAction; notice?: string }) {
  const t = useT();
  const freeOffer = offered && !invite;
  const unit = rates.perVideo['no-talking'].fast;
  return (
    <div className="flex flex-col gap-12 pt-4 nav:gap-[clamp(48px,5vw,72px)]">
      {notice === 'too-many-checkouts' && <Notice>{t('marketing.pricing.notice.tooManyCheckouts')}</Notice>}
      {notice === 'payment-unavailable' && <Notice>{t('marketing.pricing.notice.paymentUnavailable')}</Notice>}

      <section className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
        {/* Fluid size mirrors the A-Fiyatlar h1: clamp(42px, 6.4vw, 92px). */}
        <h1 className="min-w-0 flex-[1_1_520px] text-[clamp(42px,6.4vw,92px)] leading-[0.92] font-extrabold tracking-[-0.035em] text-balance font-display">
          {t('marketing.pricing.titleLead')} <span className="text-accent-text">{t('marketing.pricing.titleAccent')}</span>
        </h1>
        <p className="max-w-110 flex-[1_1_320px] text-17 leading-normal text-text-2 text-pretty">{t(freeOffer ? 'marketing.pricing.lead' : 'marketing.pricing.leadPaid')}</p>
      </section>

      <section
        aria-label={t('marketing.pricing.packsLabel')}
        className="grid grid-cols-1 gap-4 nav:grid-cols-3"
      >
        {packs.map((p) => {
          const hot = p.id === FEATURED_PACK_ID;
          const note = NOTES.includes(p.id) ? t(`marketing.pricing.note.${p.id}`) : '';
          return (
            <article
              key={p.id}
              className={cx(
                'box-border grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 rounded-16 border p-4 nav:flex nav:flex-col nav:items-stretch nav:gap-6 nav:p-6',
                hot ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface text-text',
              )}
            >
              <h2 className="heading-5">{p.name}</h2>
              <div className="row-span-2 flex flex-col items-end gap-1 text-right nav:items-start nav:text-left">
                {/* Mirrors the A-Fiyatlar price: clamp(40px, 4vw, 52px). */}
                <span className="text-[clamp(40px,4vw,52px)] leading-none font-extrabold tracking-[-0.03em] font-display">
                  {p.price ?? t('marketing.pricing.price')}
                </span>
                <span className="text-15 font-semibold">{t('marketing.pricing.creditsLine', { credits: p.credits })}</span>
              </div>
              <div className={cx('flex flex-col gap-1 text-15 leading-normal', hot ? 'text-on-accent' : 'text-text-2')}>
                {note && <p className="m-0">{note}</p>}
                <p className="m-0 font-semibold">{t('marketing.pricing.about', { count: Math.floor(p.credits / unit) })}</p>
                <p className="m-0 text-13">{t('marketing.pricing.aboutBasis')}</p>
              </div>
              {signedIn && buy ? (
                <form action={buy.bind(null, p.id, returnTo)} className="col-span-full mt-2 flex nav:mt-auto">
                  <BuyButton hot={hot} />
                </form>
              ) : (
                <Link href={invite ? '/contact' : VISITOR_BUY_HREF} className={cx(buyLook(hot), 'col-span-full mt-2 nav:mt-auto')}>
                  {t(invite ? 'common.nav.requestInvite' : 'marketing.pricing.buy')}
                </Link>
              )}
            </article>
          );
        })}
      </section>
      <p className="m-0 -mt-6 text-13 leading-normal text-text-3 nav:-mt-10">{t('marketing.pricing.tax')}</p>

      <section aria-labelledby="kac-kredi" className="flex flex-wrap items-start gap-x-18 gap-y-6">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3">
          <h2 id="kac-kredi" className="heading-3 text-balance">
            {t('marketing.pricing.costsTitle')}
          </h2>
          <p className="m-0 text-15 leading-normal text-text-2 text-pretty">{t('marketing.pricing.costsNote')}</p>
        </div>
        <dl className="m-0 flex min-w-0 flex-[2_1_480px] flex-col">
          {COSTS.map((k) => (
            <div key={k} className="flex items-start justify-between gap-x-6 gap-y-2 border-t border-line py-4">
              <dt className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-17 leading-[1.25] font-semibold">{t(`marketing.pricing.cost.${k}.name`)}</span>
                <span className="text-13 leading-[1.25] text-text-3">{t(`marketing.pricing.cost.${k}.detail`)}</span>
              </dt>
              <dd className="m-0 flex-none text-24 font-bold text-accent-text font-display">{t('common.credits.count', { count: costOf(rates, k) })}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="sss" className="flex flex-col gap-6">
        <h2 id="sss" className="heading-3">
          {t('marketing.pricing.faqTitle')}
        </h2>
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(480px,100%),1fr))] gap-x-12">
          {FAQ.filter((n) => freeOffer || n !== FREE_FAQ).map((n) => (
            <div key={n} className="flex flex-col gap-2 border-t border-line py-6">
              <dt className="text-20 leading-snug font-semibold">{t(`marketing.pricing.faq.${n}.q`)}</dt>
              <dd className="m-0 text-15 leading-normal text-text-2 text-pretty">{t(`marketing.pricing.faq.${n}.a`)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
