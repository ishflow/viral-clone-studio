'use client';
import { PROVIDER_CAP_MESSAGE } from '@/core/provider-cap-message';

import { useRouter, unstable_rethrow } from 'next/navigation';
import { useRef, useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { Button, Dialog, Icon, LinkButton } from '@/shared/ui';
import { formatCredits } from '@/shared/lib/format';
import { regenerateVariant } from './result-actions';

/** "Generate the missing variant again": what it costs now, the balance, one confirmation; only that variant is made again. */
export function RegenerateDialog({ jobId, variantId, n, cost, balance, onClose }: { jobId: string; variantId: string; n: number; cost: number; balance: number; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [shown, setShown] = useState({ cost, balance });
  const [state, setState] = useState<'ask' | 'busy' | 'changed' | 'expired' | 'error' | 'provider-cap'>('ask');
  const busy = useRef(false);
  const enough = shown.balance >= shown.cost;
  const confirm = async () => {
    if (busy.current) return;
    busy.current = true;
    setState('busy');
    try {
      const outcome = await regenerateVariant(jobId, variantId, shown.cost);
      if (outcome.status === 'ok') {
        router.refresh();
        return onClose();
      }
      if (outcome.status === 'price-changed' || outcome.status === 'insufficient') {
        setShown({ cost: outcome.cost, balance: outcome.balance });
        setState('changed');
      } else if (outcome.status === 'error' && outcome.providerCap) setState('provider-cap');
      else setState(outcome.status === 'images-expired' ? 'expired' : 'error');
    } catch (error) {
      unstable_rethrow(error);
      setState('error');
    } finally {
      busy.current = false;
    }
  };
  return (
    <Dialog open onClose={onClose} dismissible={state !== 'busy'} title={t('jobs.result.regenerateDialog.title', { n })}>
      <dl className="m-0 -mt-2 flex flex-col">
        <div className="flex justify-between gap-4 border-t border-edge py-3 text-15">
          <dt className="text-text-2">{t('jobs.result.regenerateDialog.cost')}</dt>
          <dd className="m-0 font-semibold">{formatCredits(shown.cost, t)}</dd>
        </div>
        <div className={`flex justify-between gap-4 border-t border-edge py-3 text-15 ${enough ? '' : 'border-b'}`}>
          <dt className="text-text-2">{t('jobs.result.regenerateDialog.balance')}</dt>
          <dd className={`m-0 font-semibold ${enough ? '' : 'text-warn'}`}>{formatCredits(shown.balance, t)}</dd>
        </div>
        {enough && (
          <div className="flex justify-between gap-4 border-y border-edge py-3 text-15">
            <dt className="text-text-2">{t('jobs.resume.after')}</dt>
            <dd className="m-0 font-semibold">{formatCredits(shown.balance - shown.cost, t)}</dd>
          </div>
        )}
      </dl>
      {(state === 'changed' || state === 'expired' || state === 'error' || state === 'provider-cap' || !enough) && (
        <p role="alert" className="m-0 flex items-start gap-2 text-13 leading-snug text-warn">
          <Icon name="warning" size={16} className="mt-px flex-none" />
          {state === 'provider-cap' ? PROVIDER_CAP_MESSAGE : t(state === 'changed' ? 'jobs.result.regenerateDialog.changed' : state === 'expired' ? 'jobs.result.regenerateDialog.expired' : state === 'error' ? 'jobs.result.regenerateDialog.error' : 'jobs.result.regenerateDialog.needs', { cost: formatCredits(shown.cost, t) })}
        </p>
      )}
      <div className="flex flex-wrap-reverse gap-3">
        <Button variant="secondary" className="flex-[1_1_140px]" disabled={state === 'busy'} onClick={onClose}>
          {t('jobs.result.regenerateDialog.cancel')}
        </Button>
        {enough && state !== 'expired' ? (
          <Button pending={state === 'busy'} className="flex-[2_1_200px]" onClick={() => void confirm()}>
            {t('jobs.result.regenerateDialog.confirm')}
          </Button>
        ) : (
          !enough && (
            <LinkButton href={`/pricing?returnTo=${encodeURIComponent(`/jobs/${jobId}`)}`} className="flex-[2_1_200px]">
              {t('jobs.result.regenerateDialog.buy')}
            </LinkButton>
          )
        )}
      </div>
    </Dialog>
  );
}
