'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import { formatDate } from '@/shared/lib/format';
import { Button, Dialog, Field, Icon, Textarea } from '@/shared/ui';
import { REASON_MAX, type ActionResult, type ActionRow } from './types';

type Phase<D> = { kind: 'idle' } | { kind: 'working' } | { kind: 'failed' } | { kind: 'refused'; why?: string } | { kind: 'done'; at: string; detail: D } | { kind: 'already'; at: string };

export type AdminActionDialogProps<D> = {
  onClose: () => void;
  title: string;
  /** The facts of the action (user, job, balances…), above the reason. */
  rows: ActionRow[];
  info?: ReactNode;
  /** Message under the empty reason field. `long`: "…It is shown in the credit history." (refund, add credits). */
  reasonHint?: 'short' | 'long';
  confirmLabel: string;
  confirmVariant?: 'primary' | 'warn';
  /** The server action. Sent only from the confirm button, with a key that stays the same for every try of this dialog. */
  perform: (reason: string, key: string) => Promise<ActionResult<D>>;
  /** The summary of a finished action. */
  doneRows?: (detail: D) => ActionRow[];
  doneNote?: (detail: D) => string | null;
  /** What to say when the action was sent and refused, given the reason the refusal named, if any (see `ActionResult`). Without it a refusal reads as a failure. */
  refusedNote?: (why?: string) => string;
};

function Rows({ rows }: { rows: ActionRow[] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-6 gap-y-2 rounded-12 border border-line bg-raised p-4 text-15 leading-snug">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-text-3">{row.label}</dt>
          <dd className="m-0 text-right font-medium text-text tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The one confirmation of the six admin actions (Refund, Return credits, Add credits, Block, Unblock, Retry job).
 * Mount it while it is open: every opening starts clean, with a new key. States: asking → working (nothing can close it) →
 * done (summary + Close) | failed (nothing changed, Try again with the same key) | already done (Close only) |
 * refused (sent and turned down: what happened, Close only).
 * The page is refreshed when a done or refused dialog is closed, not before: the row that opened it may change and go.
 */
export function AdminActionDialog<D>({ onClose, title, rows, info, reasonHint = 'short', confirmLabel, confirmVariant = 'primary', perform, doneRows, doneNote, refusedNote }: AdminActionDialogProps<D>) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const infoId = useId();
  const [key] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const [phase, setPhase] = useState<Phase<D>>({ kind: 'idle' });
  const field = useRef<HTMLTextAreaElement>(null);
  const working = phase.kind === 'working';
  const finished = phase.kind === 'done' || phase.kind === 'already' || phase.kind === 'refused';

  const close = () => {
    if (working) return;
    onClose();
    if (phase.kind === 'done' || phase.kind === 'refused') router.refresh();
  };

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (working) return;
    const text = reason.trim();
    if (text === '') {
      setMissing(true);
      field.current?.focus();
      return;
    }
    setPhase({ kind: 'working' });
    try {
      const result = await perform(text, key);
      setPhase(result.status === 'done' ? { kind: 'done', at: result.at, detail: result.detail } : result.status === 'already' ? { kind: 'already', at: result.at } : result.status === 'refused' && refusedNote ? { kind: 'refused', why: result.why } : { kind: 'failed' });
    } catch {
      setPhase({ kind: 'failed' });
    }
  };

  const summary = phase.kind === 'done' ? (doneRows?.(phase.detail) ?? []) : [];
  const summaryNote = phase.kind === 'done' ? (doneNote?.(phase.detail) ?? null) : null;

  return (
    <Dialog open onClose={close} title={phase.kind === 'done' ? t('adminActions.state.done') : title} dismissible={!working} describedBy={info ? infoId : undefined} className="text-left whitespace-normal">
      {finished ? (
        <div className="flex flex-col gap-6">
          {phase.kind === 'already' ? (
            <p role="status" className="m-0 text-15 leading-normal text-text-2">{t('adminActions.state.already', { date: formatDate(phase.at, locale) })}</p>
          ) : phase.kind === 'refused' ? (
            <p role="alert" className="m-0 flex items-start gap-2 rounded-12 border border-warn-edge p-3 text-15 leading-snug text-warn">
              <Icon name="warning" size={18} className="mt-0.5 shrink-0" />
              {refusedNote?.(phase.why)}
            </p>
          ) : (
            <>
              <Rows rows={summary} />
              {summaryNote && <p role="status" className="m-0 text-15 leading-normal text-text-2">{summaryNote}</p>}
            </>
          )}
          <Button autoFocus onClick={close}>{t('adminActions.dialog.close')}</Button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-6">
          <Rows rows={rows} />
          {info && <p id={infoId} className="m-0 text-15 leading-normal text-text-2">{info}</p>}
          <Field label={t('adminActions.dialog.reason.label')} error={missing && reason.trim() === '' ? t(reasonHint === 'long' ? 'adminActions.dialog.reason.requiredLong' : 'adminActions.dialog.reason.required') : undefined} hint={reasonHint === 'long' ? t('adminActions.dialog.reason.requiredLong') : undefined}>
            <Textarea ref={field} name="reason" rows={3} maxLength={REASON_MAX} required disabled={working} value={reason} placeholder={t('adminActions.dialog.reason.placeholder')} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {phase.kind === 'failed' && (
            <p role="alert" className="m-0 flex items-start gap-2 rounded-12 border border-warn-edge p-3 text-15 leading-snug text-warn">
              <Icon name="warning" size={18} className="mt-0.5 shrink-0" />
              {t('adminActions.state.failed')}
            </p>
          )}
          <p className="m-0 text-13 leading-snug text-text-3">{t('adminActions.dialog.note')}</p>
          <div role="status" className="sr-only">{working ? t('adminActions.state.working') : ''}</div>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" disabled={working} className="min-w-0 flex-[1_1_8rem]" onClick={close}>{t('adminActions.dialog.cancel')}</Button>
            <Button type="submit" variant={confirmVariant} pending={working} className="min-w-0 flex-[1_1_10rem]">
              {working ? t('adminActions.state.working') : phase.kind === 'failed' ? t('adminActions.dialog.tryAgain') : confirmLabel}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
