'use client';

import { useT } from '@/core/i18n/I18nProvider';
import type { Estimate } from '@/data/ports';
import { formatCredits, formatDuration } from '@/shared/lib/format';
import { cx } from '@/shared/lib/cx';
import { Button, Dialog, Icon, LinkButton, Skeleton } from '@/shared/ui';

const ROW = 'flex justify-between gap-4 border-t border-edge py-3 text-15';
const BOX = 'm-0 flex items-start gap-3 rounded-12 border bg-bg px-4 py-3 text-15 leading-normal text-text-2';

/** Where the confirmation is: `pricing` (the price is being asked), `ready`, or `starting` (the job is being started). */
export type SwapConfirmPhase = 'pricing' | 'ready' | 'starting';
/** Why the numbers on screen are not the ones the customer saw first: the price, or only the balance (another tab). */
export type SwapConfirmChange = { kind: 'price'; was: number } | { kind: 'balance' };

/** The credit confirmation of a person swap, in the shape of the one a product video has: credits, balance, time; nothing is charged before "Confirm and start". */
export function SwapConfirmDialog({
  phase,
  estimate,
  change,
  templateId,
  templateTitle,
  seconds,
  onCancel,
  onConfirm,
}: {
  phase: SwapConfirmPhase;
  /** Null while the price is asked. */
  estimate: Estimate | null;
  change: SwapConfirmChange | null;
  templateId: string;
  templateTitle: string;
  seconds: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const starting = phase === 'starting';
  const priced = phase !== 'pricing' && estimate !== null;
  const enough = estimate?.enough ?? false;
  const pricing = `/pricing?returnTo=${encodeURIComponent(`/swap/${templateId}`)}`;
  return (
    <Dialog open onClose={onCancel} dismissible={!starting} title={t('swap.confirm.title')} className="px-4! pt-3! pb-8! nav:p-6!">
      <p className="m-0 -mt-4 text-15 text-text-2">{t('swap.confirm.lead', { template: templateTitle })}</p>

      {phase === 'pricing' && (
        <div role="status" aria-label={t('swap.confirm.pricing')} className="flex flex-col gap-3">
          <span className="text-15 text-text-2">{t('swap.confirm.pricing')}</span>
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
        </div>
      )}

      {priced && estimate && (
        <dl className="m-0 flex flex-col">
          <div className={cx(ROW, 'items-baseline text-17')}>
            <dt className="font-semibold">{t('swap.confirm.final')}</dt>
            <dd className="m-0 font-semibold">{[formatDuration(seconds, t), '9:16'].join(' · ')}</dd>
          </div>
          <div className={ROW}>
            <dt className="text-text-2">{t('swap.confirm.credits')}</dt>
            <dd className="m-0 font-semibold">
              {change?.kind === 'price' && (
                <s className="mr-2 font-normal text-text-3">
                  <span className="sr-only">{t('swap.confirm.was')} </span>
                  {change.was}
                </s>
              )}
              {formatCredits(estimate.credits, t)}
            </dd>
          </div>
          <div className={ROW}>
            <dt className="text-text-2">{t('swap.confirm.balance')}</dt>
            <dd className={cx('m-0 font-semibold', !enough && 'text-warn')}>{formatCredits(estimate.balance, t)}</dd>
          </div>
          {enough && (
            <div className={ROW}>
              <dt className="text-text-2">{t('swap.confirm.after')}</dt>
              <dd className="m-0 font-semibold">{formatCredits(estimate.balance - estimate.credits, t)}</dd>
            </div>
          )}
          <div className={cx(ROW, 'border-b')}>
            <dt className="text-text-2">{t('swap.confirm.time')}</dt>
            <dd className="m-0 font-semibold">{t('swap.confirm.timeValue', { minutes: estimate.minutes })}</dd>
          </div>
        </dl>
      )}

      {priced && estimate && !enough && (
        <p role="alert" className={cx(BOX, 'border-warn-edge')}>
          <Icon name="warning" size={20} className="flex-none text-warn" />
          <strong className="font-semibold text-text">{t('swap.confirm.needs', { needed: formatCredits(estimate.credits, t), balance: formatCredits(estimate.balance, t) })}</strong>
        </p>
      )}
      {priced && estimate && change && (
        <p role="alert" className={cx(BOX, 'border-warn-edge')}>
          <Icon name="warning" size={20} className="flex-none text-warn" />
          <span>{change.kind === 'price' ? t('swap.confirm.changedPrice', { now: formatCredits(estimate.credits, t), was: change.was }) : t('swap.confirm.changedBalance')}</span>
        </p>
      )}
      {starting && (
        <p role="status" className={cx(BOX, 'border-edge')}>
          <Icon name="info" size={20} className="flex-none" />
          <span>{t('swap.confirm.starting')}</span>
        </p>
      )}

      <p className="m-0 text-13 leading-normal text-text-3">{t('swap.confirm.note')}</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (priced && enough && !starting) onConfirm();
        }}
        className="flex flex-wrap-reverse gap-3"
      >
        <Button variant="secondary" className="flex-[1_1_160px]" disabled={starting} onClick={onCancel}>
          {t('swap.confirm.cancel')}
        </Button>
        {priced && !enough ? (
          <LinkButton href={pricing} className="flex-[2_1_240px]">
            {t('swap.confirm.buy')}
          </LinkButton>
        ) : (
          <Button type="submit" pending={starting} disabled={!priced} className="flex-[2_1_240px]">
            {t(starting ? 'swap.confirm.startingButton' : 'swap.confirm.submit')}
          </Button>
        )}
      </form>
    </Dialog>
  );
}
