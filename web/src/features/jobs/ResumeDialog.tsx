'use client';
import { PROVIDER_CAP_MESSAGE } from '@/core/provider-cap-message';

import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { ResumeQuote } from '@/data/ports';
import { cx } from '@/shared/lib/cx';
import { formatCredits, formatDate } from '@/shared/lib/format';
import { Button, Dialog, Icon, LinkButton } from '@/shared/ui';

const ROW = 'flex justify-between gap-4 border-t border-edge py-3 text-15';

export type ResumeOption = 'continue' | 'retry';

/**
 * `A-Is-Durdu-Onay`: what a resume generates and costs, before anything is spent. Four states, one per case of the contract (§6 item 5):
 * the credits that came back are charged again (the normal one); the free video is used again (0 credits); the free video went to another
 * job meanwhile (the price, with a warning); the balance is too low (the way to buy credits, nothing to confirm).
 * Desktop: centred card; phone: bottom sheet (the shared Dialog does both).
 */
export function ResumeDialog({
  option,
  quote,
  clips,
  missingClips,
  notice,
  pricingHref,
  pending,
  onCancel,
  onConfirm,
}: {
  option: ResumeOption;
  quote: ResumeQuote;
  /** The missing part in words: "2 clips" (the row) and "2 missing clips" (the sentence). */
  clips: string;
  missingClips: string;
  notice: 'changed' | 'error' | 'provider-cap' | null;
  pricingHref: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { cost, balance, enough, coveredByFreeVideo: free } = quote;
  const until = quote.continueUntil ? formatDate(quote.continueUntil, locale) : null;
  return (
    <Dialog open onClose={onCancel} title={t(`jobs.resume.title.${option}`)} className="px-4! pt-3! pb-8! nav:p-6!">
      <p className="m-0 -mt-4 text-15 text-text-2">{t(`jobs.resume.info.${option}`, { missing: missingClips })}</p>
      <dl className="m-0 flex flex-col">
        <div className={ROW}>
          <dt className="text-text-2">{t('jobs.resume.generate')}</dt>
          <dd className="m-0 font-semibold">{clips}</dd>
        </div>
        {free ? (
          <>
            <div className={ROW}>
              <dt className="text-text-2">{t('jobs.summary.returned')}</dt>
              <dd className="m-0 font-semibold">{t('jobs.resume.freeVideo')}</dd>
            </div>
            <div className={cx(ROW, 'border-b py-4 text-17')}>
              <dt className="font-semibold">{t('jobs.resume.costs')}</dt>
              <dd className="m-0 font-semibold text-accent-text">{t('jobs.resume.freeCost')}</dd>
            </div>
          </>
        ) : (
          <>
            {enough && (
              <div className={ROW}>
                <dt className="text-text-2">{t('jobs.resume.returned')}</dt>
                <dd className="m-0 font-semibold">{formatCredits(quote.returned, t)}</dd>
              </div>
            )}
            <div className={cx(ROW, 'text-17', enough ? 'py-4' : 'border-b py-4')}>
              <dt className="font-semibold">{t('jobs.resume.costs')}</dt>
              <dd className={cx('m-0 font-semibold', enough && 'text-accent-text')}>{formatCredits(cost, t)}</dd>
            </div>
            {enough && (
              <div className={cx(ROW, 'border-b')}>
                <dt className="text-text-2">{t('jobs.resume.after')}</dt>
                <dd className="m-0 font-semibold">{formatCredits(balance - cost, t)}</dd>
              </div>
            )}
          </>
        )}
      </dl>
      {free && <p className="m-0 -mt-2 text-15 font-semibold text-accent-text">{t('jobs.resume.freeNote')}</p>}
      {(notice || quote.freeUsedElsewhere || !enough) && (
        <p role="alert" className="m-0 flex items-start gap-3 rounded-12 border border-warn-edge bg-bg px-4 py-3 text-15 leading-normal text-text-2">
          <Icon name="warning" size={20} className="flex-none text-warn" />
          <span>
            {notice === 'changed' && `${t('jobs.resume.changed')} `}
            {notice === 'provider-cap' && PROVIDER_CAP_MESSAGE}
            {notice === 'error' && `${t('jobs.stopped.failed')} `}
            {quote.freeUsedElsewhere && `${t('jobs.resume.usedElsewhere', { credits: formatCredits(cost, t) })} `}
            {!enough && t('jobs.resume.notEnough', { credits: formatCredits(cost, t), balance: formatCredits(balance, t) })}
          </span>
        </p>
      )}
      {!enough ? (
        until && <p className="m-0 -mt-2 text-13 leading-normal text-text-3">{t('jobs.resume.wait', { date: until })}</p>
      ) : (
        !free && <p className="m-0 -mt-2 text-13 leading-normal text-text-3">{t('jobs.resume.never')}</p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (enough) onConfirm();
        }}
        className="flex flex-wrap-reverse gap-3"
      >
        <Button variant="secondary" className="flex-[1_1_160px]" onClick={onCancel}>
          {t('jobs.resume.cancel')}
        </Button>
        {enough ? (
          <Button type="submit" pending={pending} className="flex-[2_1_240px]">
            {t('jobs.resume.submit')}
          </Button>
        ) : (
          <LinkButton href={pricingHref} className="flex-[2_1_240px]">
            {t('jobs.stopped.buy')}
          </LinkButton>
        )}
      </form>
    </Dialog>
  );
}
