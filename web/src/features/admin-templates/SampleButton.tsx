'use client';
import { PROVIDER_CAP_MESSAGE } from '@/core/provider-cap-message';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import type { Paid } from '@/data/ports';
import { cx } from '@/shared/lib/cx';
import { Button, Dialog, Icon, Input, type ButtonVariant } from '@/shared/ui';
import { sampleCostFor, startSample, uploadSamplePhoto } from './actions';
import type { RunningSample } from './sample';

const ROW = 'flex justify-between gap-4 border-t border-edge py-3 text-15';

/** Where the button stands: free to start, a sample started from here, one already running, or a start whose outcome is not known. */
/** One product of the sample: its name, and the photograph the upload stored (`path`) with its local preview. */
type Draft = { name: string; path: string | null; url: string | null; state: 'empty' | 'uploading' | 'saved' | 'failed' };
const emptyDraft = (): Draft => ({ name: '', path: null, url: null, state: 'empty' });

type Settled = { kind: 'started'; jobId: string } | { kind: 'running'; jobId: string | null } | { kind: 'unknown' } | null;

/**
 * "Generate sample" / "Regenerate sample". The click only reads what one sample would request (`sampleCost`) and opens the
 * confirmation with those counts; the sample starts only from the confirmation's button, with the counts it showed.
 * While a sample of the template runs (`running`, or the server says so), the button is disabled and links to that job.
 */
export function SampleButton({ templateId, label, products = 1, running = null, variant = 'secondary', className, wrapClassName, icon }: {
  templateId: string;
  label: string;
  /** How many products the template needs (`template.products`): the sample takes a photograph and a name for each. */
  products?: number;
  running?: RunningSample | null;
  variant?: ButtonVariant;
  className?: string;
  wrapClassName?: string;
  icon?: boolean;
}) {
  const t = useT();
  const [pending, start] = useTransition();
  const [paid, setPaid] = useState<Paid | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [notice, setNotice] = useState<'changed' | 'refused' | 'costFailed' | 'provider-cap' | null>(null);
  const [settled, setSettled] = useState<Settled>(running ? { kind: 'running', jobId: running.jobId } : null);
  const open = () =>
    start(async () => {
      setNotice(null);
      const outcome = await sampleCostFor(templateId);
      if (outcome.status === 'ok') {
        setDrafts(Array.from({ length: Math.max(1, products) }, emptyDraft));
        setPaid(outcome.paid);
      }
      else if (outcome.status === 'running') setSettled({ kind: 'running', jobId: outcome.jobId });
      else setNotice('costFailed');
    });
  const confirm = (shown: Paid) =>
    start(async () => {
      const outcome = await startSample(templateId, shown, drafts.map(({ name, path }) => ({ name: name.trim(), images: [path!] })));
      if (outcome.status === 'changed') {
        setPaid(outcome.paid);
        setNotice('changed');
        return;
      }
      if (outcome.status === 'refused') return setNotice(outcome.providerCap ? 'provider-cap' : 'refused');
      setPaid(null);
      setDrafts([]);
      setSettled(outcome.status === 'ok' ? { kind: 'started', jobId: outcome.jobId } : outcome.status === 'running' ? { kind: 'running', jobId: outcome.jobId } : { kind: 'unknown' });
    });
  const patch = (index: number, change: Partial<Draft>) => setDrafts((all) => all.map((draft, i) => (i === index ? { ...draft, ...change } : draft)));
  const pick = (index: number, file: File) => {
    patch(index, { url: URL.createObjectURL(file), path: null, state: 'uploading' });
    const form = new FormData();
    form.set('file', file);
    void uploadSamplePhoto(form).then(
      (outcome) => patch(index, outcome.status === 'saved' ? { path: outcome.path, state: 'saved' } : { path: null, state: 'failed' }),
      () => patch(index, { path: null, state: 'failed' }),
    );
  };
  const complete = drafts.length > 0 && drafts.every((draft) => draft.state === 'saved' && draft.name.trim() !== '');
  const rows: [string, string][] = paid
    ? [
        [t('adminTemplates.sample.images'), String(paid.images)],
        [t('adminTemplates.sample.clips'), t('adminTemplates.sample.clipsValue', { count: paid.clips, seconds: paid.clipSeconds })],
        [t('adminTemplates.sample.music'), String(paid.music)],
        ...(paid.voice > 0 ? [[t('adminTemplates.sample.voice'), String(paid.voice)] as [string, string]] : []),
      ]
    : [];
  const LINK = 'text-accent-text';
  return (
    <div className={cx('flex min-w-0 flex-col gap-2', wrapClassName)}>
      <Button variant={variant} fullWidth pending={pending && !paid} disabled={settled !== null} onClick={open} className={className}>
        {icon && <Icon name="retry" size={20} />}
        {label}
      </Button>
      {settled && (
        <p role="status" className="m-0 text-13 leading-snug text-text-2">
          {settled.kind === 'unknown' ? (
            <>{t('adminTemplates.sample.unknown')} <Link href="/admin/jobs" className={LINK}>{t('adminTemplates.sample.jobs')}</Link></>
          ) : (
            <>
              {t(settled.kind === 'started' ? 'adminTemplates.sample.started' : 'adminTemplates.sample.running')}
              {settled.jobId && <> <Link href={`/jobs/${settled.jobId}`} className={LINK}>{t('adminTemplates.sample.follow')}</Link></>}
            </>
          )}
        </p>
      )}
      {!paid && notice === 'costFailed' && <p role="alert" className="m-0 text-13 leading-snug text-warn">{t('adminTemplates.sample.costFailed')}</p>}
      {paid && (
        <Dialog open onClose={() => setPaid(null)} title={t('adminTemplates.sample.title')} className="text-left whitespace-normal">
          <p className="m-0 text-15 leading-normal text-text-2">{t('adminTemplates.sample.lead')}</p>
          <p className="m-0 text-15 leading-normal text-text-2">{t('adminTemplates.sample.productsLead')}</p>
          {drafts.map((draft, i) => (
            <fieldset key={i} className="m-0 box-border flex min-w-0 flex-wrap items-start gap-x-4 gap-y-3 rounded-16 border border-line bg-surface p-4">
              <legend className="px-2 text-15 text-text-2">{t('adminTemplates.sample.productN', { n: i + 1 })}</legend>
              <label className="flex w-18 cursor-pointer flex-col items-center gap-1 text-center text-13 text-accent-text focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-text">
                {draft.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local object URL: next/image cannot optimise it
                  <img src={draft.url} alt={t('adminTemplates.sample.photoAlt', { n: i + 1 })} className="block h-24 w-18 rounded-8 object-cover shadow-[0_0_0_1px_var(--media-edge)]" />
                ) : (
                  <span className="flex h-24 w-18 items-center justify-center rounded-8 border-[1.5px] border-dashed border-edge-strong"><Icon name="add" size={20} /></span>
                )}
                <span>{draft.state === 'uploading' ? t('adminTemplates.sample.photoUploading') : t(draft.url ? 'adminTemplates.sample.photoReplace' : 'adminTemplates.sample.photoAdd')}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  aria-label={`${t('adminTemplates.sample.productN', { n: i + 1 })}: ${t('adminTemplates.sample.photoAdd')}`}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) pick(i, file);
                    event.target.value = '';
                  }}
                />
              </label>
              <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-2 text-13 text-text-3">
                <label htmlFor={`sample-product-${i}`}>{t('adminTemplates.sample.productName')}</label>
                <Input id={`sample-product-${i}`} type="text" value={draft.name} maxLength={120} onChange={(event) => patch(i, { name: event.target.value })} />
                {draft.state === 'failed' && <span role="alert" className="text-13 leading-snug text-warn">{t('adminTemplates.sample.photoFailed')}</span>}
              </div>
            </fieldset>
          ))}
          <dl className="m-0 flex flex-col border-b border-edge">
            {rows.map(([name, value]) => (
              <div key={name} className={ROW}>
                <dt className="text-text-2">{name}</dt>
                <dd className="m-0 font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {notice && (
            <p role="alert" className="m-0 flex items-start gap-3 rounded-12 border border-warn-edge bg-bg px-4 py-3 text-15 leading-normal text-text-2">
              <Icon name="warning" size={20} className="flex-none text-warn" />
              <span>{notice === 'provider-cap' ? PROVIDER_CAP_MESSAGE : t(notice === 'changed' ? 'adminTemplates.sample.changed' : 'adminTemplates.sample.failed')}</span>
            </p>
          )}
          {!complete && <p className="m-0 text-13 leading-snug text-text-2">{t('adminTemplates.sample.needProducts')}</p>}
          <div className="flex flex-wrap-reverse gap-3">
            <Button variant="secondary" className="flex-[1_1_140px]" onClick={() => setPaid(null)}>{t('adminTemplates.confirm.cancel')}</Button>
            <Button className="flex-[1_1_180px]" pending={pending} disabled={!complete} onClick={() => confirm(paid)}>{t('adminTemplates.sample.confirm')}</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
