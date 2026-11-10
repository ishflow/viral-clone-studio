'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { RULES } from '@/data/ports';
import { formatCredits, formatDuration } from '@/shared/lib/format';
import { Icon, LinkButton, VideoCard } from '@/shared/ui';
import Link from 'next/link';

export type WelcomeCard = { id: string; title: string; image: string; video: string | null; seconds: number; meta: string };

/** A-Karsilama: the first screen after the email is verified. `freeOffer`: the customer has a free video; without one the page does not promise it. */
export function WelcomeView({ cards, freeOffer }: { cards: WelcomeCard[]; freeOffer: boolean }) {
  const t = useT();
  const infos = (freeOffer ? (['free', 'after', 'credits'] as const) : (['after', 'credits'] as const)).map((k) => ({ k, title: t(`auth.welcome.info.${k}Title`), text: t(`auth.welcome.info.${k}Text`) }));
  return (
    <div className="flex flex-col gap-[clamp(32px,3.4vw,48px)] pt-[clamp(0px,calc(3.4vw-32px),16px)]">
      <section className="flex flex-wrap items-end justify-between gap-x-12 gap-y-8">
        <h1 className="m-0 flex-[1_1_520px] font-display text-[clamp(42px,6.4vw,92px)] leading-[0.95] font-extrabold tracking-[-0.035em] text-balance">
          {t(freeOffer ? 'auth.welcome.title' : 'auth.welcome.titlePaid')} <span className="text-accent-text">{t(freeOffer ? 'auth.welcome.titleAccent' : 'auth.welcome.titleAccentPaid')}</span>
        </h1>
        <div className="flex max-w-110 flex-[1_1_340px] flex-col gap-6">
          <p className="m-0 text-17 leading-normal text-text-2 text-pretty">{t(freeOffer ? 'auth.welcome.lead' : 'auth.welcome.leadPaid')}</p>
          <LinkButton href="/gallery" size="l" className="self-stretch nav:self-start">
            {t('auth.welcome.pick')}
          </LinkButton>
        </div>
      </section>

      {cards.length === 0 ? (
        <section aria-labelledby="h-start" className="box-border flex flex-wrap items-center justify-between gap-x-12 gap-y-6 rounded-16 border-[1.5px] border-dashed border-edge-strong p-6 nav:p-8">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2">
            <h2 id="h-start" className="heading-5 m-0 text-balance">
              {t('auth.welcome.emptyTitle')}
            </h2>
            <p className="m-0 max-w-155 text-15 leading-normal text-text-2 text-pretty">{t('auth.welcome.emptyText', { credits: formatCredits(RULES.ownTemplateCredits, t) })}</p>
          </div>
          <LinkButton href="/templates/new" className="flex-[1_1_100%] nav:flex-none">
            {t('auth.welcome.emptyAdd')}
          </LinkButton>
        </section>
      ) : (
        <section aria-labelledby="h-start" className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <h2 id="h-start" className="heading-5 m-0">
              {t('auth.welcome.start')}
            </h2>
            <Link href="/gallery" className="flex min-h-11 items-center gap-2 text-15 font-medium no-underline">
              {t('auth.welcome.all')}
              <Icon name="forward" size={18} />
            </Link>
          </div>
          <div className="-mx-4 grid snap-x snap-mandatory auto-cols-[220px] grid-flow-col gap-4 overflow-x-auto scroll-px-4 px-4 pb-1 [scrollbar-width:none] nav:mx-0 nav:snap-none nav:auto-cols-auto nav:grid-flow-row nav:grid-cols-[repeat(auto-fit,minmax(min(210px,100%),1fr))] nav:gap-x-4 nav:gap-y-8 nav:overflow-visible nav:p-0">
            {cards.map((c) => (
              <div key={c.id} className="snap-start nav:contents">
              <VideoCard
                href={`/templates/${c.id}`}
                title={c.title}
                meta={c.meta}
                image={c.image}
                video={c.video}
                formatLabel={t('common.format.noTalking')}
                durationLabel={formatDuration(c.seconds, t)}
              />
              </div>
            ))}
          </div>
        </section>
      )}

      <section
        aria-label={t(freeOffer ? 'auth.welcome.info.label' : 'auth.welcome.info.labelPaid')}
        className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-x-12 gap-y-8 border-t border-line pt-8"
      >
        {infos.map((i) => (
          <div key={i.k} className="flex flex-col gap-2">
            <h2 className="heading-6 m-0">{i.title}</h2>
            <p className="m-0 text-15 leading-normal text-text-2 text-pretty">{i.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
