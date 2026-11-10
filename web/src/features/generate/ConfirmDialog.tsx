'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import type { Estimate, Quality } from '@/data/ports';
import { Button, Dialog, Icon, LinkButton, Skeleton } from '@/shared/ui';
import { formatCredits, formatDuration } from '@/shared/lib/format';
import { cx } from '@/shared/lib/cx';

const ROW = 'flex justify-between gap-4 border-t border-edge py-3 text-15';
const BOX = 'm-0 flex items-start gap-3 rounded-12 border bg-bg px-4 py-3 text-15 leading-normal text-text-2';

/**
 * Where the confirmation is: `pricing` (the price is being asked), `ready`, `starting` (the job is being started), or one of the
 * answers that end the dialog's normal way: `paused` (generation is paused, nothing charged), `unconfirmed` (no answer to the start came back).
 */
export type ConfirmPhase = 'pricing' | 'ready' | 'starting' | 'paused' | 'unconfirmed';
/** Why the numbers on screen are not the ones the customer saw first: the price, or only the balance (another tab). */
export type ConfirmChange = { kind: 'price'; was: number } | { kind: 'balance' };

/** The credit confirmation of contract section 5. Desktop: centred card; phone: bottom sheet (the shared Dialog does both). */
export function ConfirmDialog({
  phase,
  estimate,
  change,
  templateTitle,
  quality,
  variants,
  language,
  seconds,
  idempotencyKey,
  templateId,
  onCancel,
  onConfirm,
  onBuy,
}: {
  phase: ConfirmPhase;
  /** Null while the price is asked. */
  estimate: Estimate | null;
  change: ConfirmChange | null;
  templateTitle: string;
  quality: Quality;
  variants: number;
  language: string;
  /** The length of the final video: the template's. */
  seconds: number;
  idempotencyKey: string;
  templateId: string;
  onCancel: () => void;
  onConfirm: () => void;
  /** Runs before the customer leaves for the pricing page (the form is kept); the page opens when it is done. */
  onBuy: () => Promise<void>;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const resolution = t(`generate.quality.${quality}.sub`);
  const starting = phase === 'starting';
  const closed = phase === 'paused' || phase === 'unconfirmed';
  const priced = phase !== 'pricing' && !closed && estimate !== null;
  const enough = estimate?.enough ?? false;
  const free = estimate?.coveredByFreeVideo ?? false;
  const lead = t('generate.confirm.lead', {
    template: templateTitle,
    quality: t(`common.quality.${quality}`),
    variants: t('generate.unit.variant', { count: variants }),
    language: t(`common.language.${language}`),
  });
  const pricing = `/pricing?returnTo=${encodeURIComponent(`/templates/${templateId}/generate`)}`;
  const after = estimate ? estimate.balance - estimate.credits : 0;
  return (
    <Dialog open onClose={onCancel} dismissible={!starting} title={t('generate.confirm.title')} className="px-4! pt-3! pb-8! nav:p-6!">
      <p className="m-0 -mt-4 text-15 text-text-2">{lead}</p>

      {phase === 'pricing' && (
        <div role="status" aria-label={t('generate.confirm.pricing')} className="flex flex-col gap-3">
          <span className="text-15 text-text-2">{t('generate.confirm.pricing')}</span>
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
        </div>
      )}

      {priced && estimate && (
        <dl className="m-0 flex flex-col">
          <div className={cx(ROW, 'items-baseline text-17')}>
            <dt className="font-semibold">{t('generate.confirm.final')}</dt>
            <dd className="m-0 font-semibold">{t('generate.confirm.finalValue', { duration: formatDuration(seconds, t), resolution })}</dd>
          </div>
          <div className={ROW}>
            <dt className="text-text-2">{t('generate.confirm.credits')}</dt>
            <dd className={cx('m-0 font-semibold', free && 'text-accent-text')}>
              {change?.kind === 'price' && (
                <s className="mr-2 font-normal text-text-3">
                  <span className="sr-only">{t('generate.confirm.was')} </span>
                  {change.was}
                </s>
              )}
              {free ? t('generate.confirm.freeValue') : formatCredits(estimate.credits, t)}
            </dd>
          </div>
          <div className={ROW}>
            <dt className="text-text-2">{t('generate.confirm.balance')}</dt>
            <dd className={cx('m-0 font-semibold', !enough && 'text-warn')}>{formatCredits(estimate.balance, t)}</dd>
          </div>
          {enough && (
            <div className={ROW}>
              <dt className="text-text-2">{t('generate.confirm.after')}</dt>
              <dd className="m-0 font-semibold">{formatCredits(after, t)}</dd>
            </div>
          )}
          <div className={cx(ROW, 'border-b')}>
            <dt className="text-text-2">{t('generate.confirm.time')}</dt>
            <dd className="m-0 font-semibold">{t('generate.confirm.timeValue', { minutes: estimate.minutes })}</dd>
          </div>
          <div className="border-b border-edge">
            <dt className="m-0">
              <button
                type="button"
                aria-expanded={open}
                aria-controls="confirm-generate"
                onClick={() => setOpen((value) => !value)}
                className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-4 border-0 bg-transparent p-0 py-3 text-left text-15 text-text-2"
              >
                {t('generate.confirm.generate')}
                <Icon name="arrow down" size={18} className={cx('transition-transform', open && 'rotate-180')} />
              </button>
            </dt>
            <dd id="confirm-generate" hidden={!open} className="m-0 pb-3 text-15 leading-normal text-text-2">
              {t('generate.confirm.generateValue', {
                images: t('generate.unit.image', { count: estimate.images }),
                clips: t('generate.unit.clip', { count: estimate.clips }),
                seconds: estimate.clipSeconds,
                music: t('generate.unit.track', { count: estimate.musicTracks }),
                final: Math.round(seconds),
              })}
            </dd>
          </div>
        </dl>
      )}

      {priced && estimate && free && enough && <p className="m-0 -mt-2 text-15 font-semibold text-accent-text">{t('generate.confirm.free')}</p>}
      {priced && estimate && !enough && (
        <p role="alert" className={cx(BOX, 'border-warn-edge')}>
          <Icon name="warning" size={20} className="flex-none text-warn" />
          <span>
            <strong className="font-semibold text-text">
              {t('generate.confirm.needs', { needed: formatCredits(estimate.credits, t), balance: formatCredits(estimate.balance, t) })}
            </strong>{' '}
            {t('generate.confirm.saved')}
          </span>
        </p>
      )}
      {priced && change && (
        <p role="alert" className={cx(BOX, 'border-warn-edge')}>
          <Icon name="warning" size={20} className="flex-none text-warn" />
          <span>
            {change.kind === 'price' && estimate
              ? t('generate.confirm.changedPrice', { now: free ? t('generate.confirm.freeValue') : formatCredits(estimate.credits, t), was: change.was })
              : t('generate.confirm.changedBalance')}
          </span>
        </p>
      )}
      {starting && (
        <p role="status" className={cx(BOX, 'border-edge')}>
          <Icon name="info" size={20} className="flex-none" />
          <span>{t('generate.confirm.starting')}</span>
        </p>
      )}
      {closed && (
        <p role="alert" className={cx(BOX, 'border-warn-edge')}>
          <Icon name="warning" size={20} className="flex-none text-warn" />
          <span>{t(phase === 'paused' ? 'generate.confirm.paused' : 'generate.confirm.unconfirmed')}</span>
        </p>
      )}

      {(priced || phase === 'pricing') && <p className="m-0 text-13 leading-normal text-text-3">{t('generate.confirm.note')}</p>}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (priced && enough && !starting) onConfirm();
        }}
        className="flex flex-wrap-reverse gap-3"
      >
        <input type="hidden" name="key" value={idempotencyKey} />
        {phase === 'unconfirmed' ? (
          <LinkButton href="/videos" className="flex-[1_1_240px]">
            {t('generate.confirm.openVideos')}
          </LinkButton>
        ) : (
          <>
            <Button variant="secondary" className="flex-[1_1_160px]" disabled={starting} onClick={onCancel}>
              {t(phase === 'paused' ? 'generate.confirm.close' : 'generate.confirm.cancel')}
            </Button>
            {phase === 'pricing' && (
              <Button type="submit" disabled className="flex-[2_1_240px]">
                {t('generate.confirm.submit')}
              </Button>
            )}
            {priced && enough && (
              <Button type="submit" pending={starting} className="flex-[2_1_240px]">
                {t(starting ? 'generate.confirm.startingButton' : 'generate.confirm.submit')}
              </Button>
            )}
            {priced && !enough && (
              <LinkButton
                href={pricing}
                onClick={(event) => {
                  event.preventDefault();
                  void onBuy().finally(() => router.push(pricing));
                }}
                className="flex-[2_1_240px]"
              >
                {t('generate.confirm.buy')}
              </LinkButton>
            )}
          </>
        )}
      </form>
    </Dialog>
  );
}
