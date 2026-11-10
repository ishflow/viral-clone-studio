'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { Button, buttonClass } from './Button';
import { Icon } from './Icon';

/** How many times the customer pressed `Try again` lately (a retry that fails again brings a new error component, so the count lives here). */
let tries = { n: 0, at: 0 };
const FORGET_AFTER_MS = 60_000;

/** "Could not load X": a card with the title, one sentence, `Try again`, and after the second failure `Contact support` (contract section 10). */
export function LoadError({ title, text, onRetry }: { title: string; text?: string; onRetry: () => void }) {
  const t = useT();
  const [recent] = useState(() => (Date.now() - tries.at < FORGET_AFTER_MS ? tries.n : 0));
  return (
    <div role="alert" className="box-border flex flex-col items-center gap-6 rounded-16 border border-line bg-surface px-4 py-12 text-center nav:px-6 nav:py-18">
      <span className="flex size-12 items-center justify-center rounded-full bg-raised text-warn">
        <Icon name="warning" size={24} />
      </span>
      <div className="flex flex-col items-center gap-2">
        <h2 className="m-0 heading-4">{title}</h2>
        {text && <p className="m-0 max-w-130 text-15 leading-normal text-text-2 text-pretty">{text}</p>}
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button
          variant="secondary"
          onClick={() => {
            tries = { n: recent + 1, at: Date.now() };
            onRetry();
          }}
        >
          {t('common.loadError.retry')}
        </Button>
        {recent >= 1 && (
          <Link href="/contact" className={buttonClass('secondary')}>
            {t('common.loadError.support')}
          </Link>
        )}
      </div>
    </div>
  );
}

/** For tests: forget the retries. */
export function resetLoadErrorTries(): void {
  tries = { n: 0, at: 0 };
}
