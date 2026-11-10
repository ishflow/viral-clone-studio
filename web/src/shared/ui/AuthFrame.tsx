'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { cx } from '@/shared/lib/cx';
import { HeaderVisitor } from './HeaderVisitor';
import { SkipLink } from './PageFrame';

const SHOTS = [
  { src: '/samples/1377349dbc87784232ac59cf9cf04986.jpg', box: 'w-10 nav:w-auto nav:max-w-42.5 nav:flex-[1_1_0]' },
  { src: '/samples/f20a7ed7a7bc172a7da483415800077f.jpg', box: 'w-13 nav:w-auto nav:max-w-55 nav:flex-[1.3_1_0]' },
  { src: '/samples/de5244c861eb9107996b5404d64ca159.jpg', box: 'w-10 nav:w-auto nav:max-w-42.5 nav:flex-[1_1_0]' },
];

/**
 * Two-column frame of the log-in, sign-up and password pages (A-Giris): visitor header, a picture panel (below the form on a phone),
 * and a 420 px column that holds `children`. Pages render the form content only, no `<main>`.
 * `freeOffer` (the admin setting, read by the server layout) puts "Your first video is free" in the phone menu; without it the menu promises nothing.
 * `invite`: sign-up is by invitation only, so the phone menu asks for an invite instead of "Get started".
 */
export function AuthFrame({ children, freeOffer = false, invite = false }: { children: ReactNode; freeOffer?: boolean; invite?: boolean }) {
  const t = useT();
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <SkipLink />
      <div className="page-gutter">
        <div className="mx-auto max-w-330">
          <HeaderVisitor phoneCta={false} actions="language" freeOffer={freeOffer} invite={invite} />
        </div>
      </div>
      <div className="flex flex-1 flex-col nav:flex-row">
        <section className="order-2 box-border flex flex-none flex-row-reverse items-center justify-between gap-4 bg-surface px-4 py-6 nav:order-1 nav:min-w-0 nav:flex-[1_1_420px] nav:flex-col nav:items-stretch nav:justify-between nav:gap-12 nav:p-[clamp(24px,4vw,48px)_clamp(16px,4vw,60px)]">
          <div className="flex flex-none items-end gap-2 nav:gap-4">
            {SHOTS.map((s) => (
              <div
                key={s.src}
                className={cx('relative aspect-9/16 flex-none overflow-hidden rounded-8 shadow-[0_0_0_1px_var(--media-edge)] nav:rounded-16', s.box)}
              >
                <Image src={s.src} alt="" fill sizes="220px" className="object-cover" />
              </div>
            ))}
          </div>
          <p className="m-0 max-w-130 font-display text-24 leading-none font-extrabold tracking-[-0.03em] text-balance nav:text-[clamp(32px,4vw,52px)] nav:leading-[0.96]">
            {t('common.home.titleLead')} <span className="block text-accent-text nav:inline">{t('common.home.titleAccent')}</span>
          </p>
        </section>
        <main
          id="main"
          className="order-1 box-border flex min-w-0 flex-1 items-start justify-center px-4 pt-8 pb-6 nav:order-2 nav:flex-[1_1_420px] nav:items-center nav:p-[clamp(24px,4vw,56px)]"
        >
          <div className="flex w-full max-w-105 flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
