'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useT } from '@/core/i18n/I18nProvider';
import { buttonClass } from '@/shared/ui';

const DROPS = ['nav:mt-18', 'nav:mt-9', 'nav:mt-0', 'nav:mt-9', 'nav:mt-18'];
// Fluid sizes below mirror A-Ana-Sayfa: section h2 clamp(36px, 4.6vw, 64px), h1 clamp(48px, 8.4vw, 128px), step number clamp(48px, 4.6vw, 64px), closing h2 clamp(42px, 6.4vw, 92px).
const H2 = 'text-[clamp(36px,4.6vw,64px)] leading-[0.98] font-extrabold tracking-[-0.03em] font-display';

/**
 * `freeOffer`: may the page say the first video is free (`freeOffer()` in core; the page decides).
 * `invite`: a visitor who cannot sign up (invite mode): no free-video line, and the closing button asks for an invite instead of starting.
 */
export function HomeView({ images, freeOffer, invite = false }: { images: string[]; freeOffer: boolean; invite?: boolean }) {
  const t = useT();
  const strip = images.slice(0, 5);
  // No ready template in the gallery: no sample to show, so the whole proof section (it speaks of the videos playing there) leaves out.
  const sample = images[2] ?? images[0];
  return (
    <div className="flex flex-col gap-[clamp(72px,7.8vw,112px)] pt-4">
      <section className="flex flex-col items-center gap-6 text-center nav:gap-8">
        {/* A-Ana-Sayfa h1: clamp(48px, 8.4vw, 128px). */}
        <h1 className="max-w-275 text-[clamp(48px,8.4vw,128px)] leading-[0.9] font-extrabold tracking-[-0.04em] text-balance font-display">
          {t('marketing.home.heroLead')} <span className="text-accent-text">{t('marketing.home.heroAccent')}</span>
        </h1>
        <p className="max-w-155 text-17 leading-normal text-text-2 text-pretty">{t('marketing.home.lead')}</p>
        <div className="flex flex-wrap justify-center gap-3 self-stretch nav:self-auto">
          <Link href="/gallery" className={buttonClass('primary', 'l', false, 'flex-auto')}>
            {t('marketing.home.browse')}
          </Link>
          <a href="#how" className={buttonClass('secondary', 'l', false, 'flex-auto')}>
            {t('marketing.home.how')}
          </a>
        </div>
        {freeOffer && !invite && <p className="text-15 leading-normal text-text-3">{t('marketing.home.freeNote')}</p>}
        <div className="-mx-4 flex snap-x snap-mandatory items-start gap-3 self-stretch overflow-x-auto px-4 pt-2 pb-1 [scroll-padding:0_16px] [scrollbar-width:none] nav:mx-0 nav:snap-none nav:justify-center nav:gap-4 nav:px-0 nav:pt-4 nav:pb-0">
          {strip.map((src, i) => (
            <Image
              key={`${src}-${i}`}
              src={src}
              alt=""
              width={230}
              height={409}
              className={`block aspect-9/16 w-37 flex-none snap-start rounded-16 object-cover shadow-[0_0_0_1px_var(--media-edge)] nav:min-w-30 nav:max-w-57 nav:flex-[1_1_0] nav:snap-align-none nav:w-auto ${DROPS[i]}`}
            />
          ))}
        </div>
      </section>

      <section id="how" aria-labelledby="how-title" className="flex scroll-mt-8 flex-col gap-8">
        <h2 id="how-title" className={H2}>
          {t('marketing.home.stepsTitle')}
        </h2>
        <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 nav:grid-cols-3 nav:gap-[clamp(12px,1.7vw,24px)]">
          {[1, 2, 3].map((n) => (
            <li
              key={n}
              className="box-border grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-16 border border-line bg-surface p-4 nav:flex nav:flex-col nav:gap-4 nav:p-6"
            >
              {/* A-Ana-Sayfa step number: clamp(48px, 4.6vw, 64px). */}
              <span className="row-span-2 text-[clamp(48px,4.6vw,64px)] leading-none font-extrabold text-accent-text font-display nav:row-auto">
                {n}
              </span>
              <h3 className="text-20 leading-tight font-bold tracking-[-0.01em] font-display nav:text-24 nav:tracking-[-0.02em]">
                {t(`marketing.home.steps.${n}.title`)}
              </h3>
              <p className="text-15 leading-normal text-text-2 text-pretty nav:text-17">{t(`marketing.home.steps.${n}.body`)}</p>
            </li>
          ))}
        </ol>
      </section>

      {sample && (
        <section aria-labelledby="proof-title" className="flex flex-wrap items-center gap-x-18 gap-y-8">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-6">
            <h2 id="proof-title" className={`${H2} text-balance`}>
              {t('marketing.home.proofLead')} <span className="text-accent-text">{t('marketing.home.proofAccent')}</span>
            </h2>
            <p className="max-w-135 text-17 leading-normal text-text-2 text-pretty">{t('marketing.home.proofText')}</p>
            <Link href="/gallery" className={buttonClass('secondary', 'm', false, 'self-stretch nav:self-start')}>
              {t('marketing.home.proofCta')}
            </Link>
          </div>
          <div className="grid max-w-130 min-w-0 flex-[1_1_420px] grid-cols-2 gap-4">
            <figure className="m-0 flex flex-col gap-2">
              <Image
                src={sample}
                alt={t('marketing.home.sampleAlt')}
                width={260}
                height={462}
                className="block aspect-9/16 w-full rounded-16 object-cover shadow-[0_0_0_1px_var(--media-edge)]"
              />
              <figcaption className="text-13 text-text-3">{t('marketing.home.sampleCaption')}</figcaption>
            </figure>
            <figure className="m-0 flex flex-col gap-2">
              <div className="box-border flex aspect-9/16 items-center justify-center rounded-16 border-[1.5px] border-dashed border-accent-text p-4 text-center text-24 leading-tight font-bold text-accent-text font-display">
                {t('marketing.home.yourVideo')}
              </div>
              <figcaption className="text-13 text-text-3">{t('marketing.home.yourVideoCaption')}</figcaption>
            </figure>
          </div>
        </section>
      )}

      <section aria-labelledby="faq-title" className="flex flex-col gap-8">
        <h2 id="faq-title" className={H2}>
          {t('marketing.home.faqTitle')}
        </h2>
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(480px,100%),1fr))] gap-x-12">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="flex flex-col gap-2 border-t border-line py-6">
              <dt className="text-20 leading-snug font-semibold">{t(`marketing.home.faq.${n}.q`)}</dt>
              <dd className="m-0 text-15 leading-normal text-text-2 text-pretty">{t(`marketing.home.faq.${n}.a`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="box-border flex flex-wrap items-center justify-between gap-x-12 gap-y-6 rounded-24 bg-accent px-[clamp(24px,5vw,72px)] py-[clamp(32px,6vw,72px)] text-on-accent">
        {/* A-Ana-Sayfa closing h2: clamp(42px, 6.4vw, 92px). */}
        <h2 className="min-w-0 flex-[1_1_420px] text-[clamp(42px,6.4vw,92px)] leading-[0.94] font-extrabold tracking-[-0.035em] text-balance font-display">
          {t('marketing.home.finalTitle')}
        </h2>
        <Link
          href={invite ? '/contact' : '/signup'}
          className="box-border flex min-h-15 flex-[1_1_100%] items-center justify-center rounded-16 bg-on-accent px-12 text-17 font-semibold text-on-scrim no-underline nav:flex-none"
        >
          {t(invite ? 'common.nav.requestInvite' : 'marketing.home.finalCta')}
        </Link>
      </section>
    </div>
  );
}
