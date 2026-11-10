'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { setCookieConsent } from '@/core/consent/actions';
import { useT } from '@/core/i18n/I18nProvider';
import { cx } from '@/shared/lib/cx';
import { Button } from './Button';

/**
 * The cookie notice (A-Cerez), fixed to the bottom of the window. `answered` comes from the server (cookie `vc_cookies` present);
 * pass `getCookieConsent() !== null`. Both answers only store the choice: no analytics exist.
 * On a phone (under 600 px) it is compact (smaller padding and text, the heading only for screen readers: the text says it) so it does not cover the cards behind it; the two answers and their words stay.
 * `inFlow` (the auth pages) puts it after the page content and keeps it stuck to the window bottom, so scrolling to the end shows the last form row above it instead of under it.
 */
export function CookieNotice({ answered = false, inFlow = false }: { answered?: boolean; inFlow?: boolean }) {
  const t = useT();
  const [hidden, setHidden] = useState(false);
  // A new answer state from the server (the choice was stored or cleared) starts the notice over: a choice made earlier must not keep it hidden once it is asked again.
  const [seenAnswered, setSeenAnswered] = useState(answered);
  if (seenAnswered !== answered) {
    setSeenAnswered(answered);
    setHidden(false);
  }
  const [pending, startTransition] = useTransition();
  if (answered || hidden) return null;
  return (
    <div className={cx('page-gutter pointer-events-none bottom-0 z-40 pb-3 min-[600px]:pb-6', inFlow ? 'sticky' : 'fixed inset-x-0')}>
      <form
        action={async (formData) => {
          startTransition(async () => {
            try {
              await setCookieConsent(formData);
              setHidden(true);
            } catch {
              // Keep the notice so the visitor can retry.
            }
          });
        }}
        role="region"
        aria-label={t('common.cookies.label')}
        className="pointer-events-auto mx-auto box-border flex max-w-330 flex-wrap items-center justify-between gap-x-12 gap-y-3 rounded-24 border border-edge bg-surface p-4 min-[600px]:gap-y-4 min-[600px]:p-6"
      >
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-1">
          <h2 className="m-0 heading-6 max-[599px]:sr-only">{t('common.cookies.title')}</h2>
          <p className="m-0 max-w-155 text-15 leading-normal text-text-2 text-pretty max-[599px]:text-13 max-[599px]:leading-snug">
            {t('common.cookies.text')}{' '}
            <Link href="/legal/cookies" prefetch={false} className="font-semibold no-underline">
              {t('common.cookies.policy')}
            </Link>
          </p>
        </div>
        <div className="flex w-full min-w-0 flex-wrap gap-3 min-[600px]:w-auto">
          <Button type="submit" name="choice" value="necessary" variant="secondary" pending={pending} className="min-w-0 flex-1 px-3 max-[599px]:min-h-11 max-[599px]:text-13 min-[600px]:flex-none">
            {t('common.cookies.necessary')}
          </Button>
          <Button type="submit" name="choice" value="all" variant="secondary" pending={pending} className="min-w-0 flex-1 px-3 max-[599px]:min-h-11 max-[599px]:text-13 min-[600px]:flex-none">
            {t('common.cookies.acceptAll')}
          </Button>
        </div>
      </form>
    </div>
  );
}
