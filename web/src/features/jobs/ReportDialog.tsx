'use client';

import { useRef, useState } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { useT } from '@/core/i18n/I18nProvider';
import { RULES, type ProblemKind } from '@/data/ports';
import { Button, Dialog, Icon, Textarea } from '@/shared/ui';
import { reportProblem } from './result-actions';

const KINDS: { kind: ProblemKind; key: string }[] = [
  { kind: 'looks-different', key: 'looksDifferent' },
  { kind: 'text-wrong', key: 'textWrong' },
  { kind: 'does-not-play', key: 'doesNotPlay' },
  { kind: 'other', key: 'other' },
];

/** Board A-Sonuc-Durumlar: "Report a problem" (four reasons, an optional note) and, once sent, "Reported". The job id goes with it on the server. `swap`: a person-swap video, which can also be reported as "this is not me". */
export function ReportDialog({ jobId, onClose, swap = false }: { jobId: string; onClose: () => void; swap?: boolean }) {
  const t = useT();
  const key = useRef(crypto.randomUUID());
  const [kind, setKind] = useState<ProblemKind | null>(null);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'form' | 'sending' | 'sent' | 'closed' | 'error' | 'pick'>('form');

  const send = async () => {
    if (!kind) return setState('pick');
    setState('sending');
    try {
      const outcome = await reportProblem(jobId, kind, note, key.current);
      setState(outcome.status === 'sent' ? 'sent' : outcome.status);
    } catch (error) {
      unstable_rethrow(error);
      setState('error');
    }
  };

  if (state === 'sent') {
    return (
      <Dialog open onClose={onClose} title={t('jobs.result.report.sentTitle')}>
        <p role="status" className="m-0 flex items-start gap-3 text-15 leading-normal text-text-2">
          <Icon name="done" size={20} className="flex-none text-accent-text" />
          {t('jobs.result.report.sent', { days: RULES.supportReplyDays })}
        </p>
        <Button onClick={onClose}>{t('jobs.result.report.close')}</Button>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} dismissible={state !== 'sending'} title={t('jobs.result.report.title')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="flex flex-col gap-4"
      >
        <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
          <legend className="sr-only">{t('jobs.result.report.title')}</legend>
          {swap && (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-15">
              <input type="radio" name="problem" value="not-me" checked={kind === 'not-me'} onChange={() => setKind('not-me')} className="size-5 accent-[var(--accent)]" />
              {t('jobs.swap.report.notMe')}
            </label>
          )}
          {KINDS.map((item) => (
            <label key={item.kind} className="flex min-h-11 cursor-pointer items-center gap-3 text-15">
              <input type="radio" name="problem" value={item.kind} checked={kind === item.kind} onChange={() => setKind(item.kind)} className="size-5 accent-[var(--accent)]" />
              {t(`jobs.result.report.${item.key}`)}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-2 text-15 text-text-2">
          {t('jobs.result.report.note')}
          <Textarea value={note} maxLength={1000} rows={3} onChange={(event) => setNote(event.target.value)} />
        </label>
        {(state === 'pick' || state === 'closed' || state === 'error') && (
          <p role="alert" className="m-0 flex items-start gap-2 text-13 leading-snug text-warn">
            <Icon name="warning" size={16} className="mt-px flex-none" />
            {t(state === 'pick' ? 'jobs.result.report.pick' : state === 'closed' ? 'jobs.result.report.closed' : 'jobs.result.report.error')}
          </p>
        )}
        <div className="flex flex-wrap-reverse gap-3">
          <Button variant="secondary" className="flex-[1_1_140px]" disabled={state === 'sending'} onClick={onClose}>
            {t('jobs.result.report.cancel')}
          </Button>
          <Button type="submit" pending={state === 'sending'} className="flex-[2_1_200px]">
            {t('jobs.result.report.send')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
