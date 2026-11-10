'use client';

import { useActionState, useState } from 'react';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import { RULES } from '@/data/ports';
import { formatDate } from '@/shared/lib/format';
import { Button, Field, Input, Select, Textarea } from '@/shared/ui';
import { Notice } from '@/shared/ui/Notice';
import { submitContact, type ContactState } from './actions';
import { TOPICS } from './contact';

export type ContactJob = { id: string; title: string; at: string };
/** The signed-in visitor: the address answers go to, and their jobs to choose one from. Without it the form asks for an email. */
export type ContactAccount = { email: string; jobs: ContactJob[] };

/** Remounts the form after a send, so a second message starts from empty fields (and gets a new key). */
export function ContactForm({ account = null, topic, jobId }: { account?: ContactAccount | null; topic?: string; jobId?: string }) {
  const [round, setRound] = useState(0);
  return <ContactFormRound key={round} account={account} topic={topic} jobId={jobId} onAgain={() => setRound((r) => r + 1)} />;
}

function ContactFormRound({ account, topic, jobId, onAgain }: { account: ContactAccount | null; topic?: string; jobId?: string; onAgain: () => void }) {
  const t = useT();
  const locale = useLocale();
  // One key per form instance AND per page load: `useId` is the same on every load and every round, which made a new message of the same
  // sender read as "already sent". (The server's value stays in the page the browser hydrates, hence suppressHydrationWarning below.)
  const [key] = useState(() => `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
  const first = (TOPICS as readonly string[]).includes(topic ?? '') ? (topic as string) : TOPICS[0];
  const known = account?.jobs.some((job) => job.id === jobId) ? (jobId as string) : '';
  const initial: ContactState = { status: 'idle', errors: {}, values: { topic: first, email: '', link: '', message: '', jobId: known } };
  const [state, action, pending] = useActionState(submitContact, initial);
  const err = (f: keyof ContactState['errors']) => (state.errors[f] ? t(`marketing.contact.error.${f}`) : undefined);

  if (state.status === 'sent') {
    return (
      <div role="status" className="flex min-w-0 flex-[1_1_420px] flex-col gap-3 rounded-16 border border-line bg-surface p-4 nav:p-6">
        {state.duplicate ? (
          <>
            <h2 className="heading-5">{t('marketing.contact.duplicate')}</h2>
            <p className="text-15 leading-normal text-text-2">{t('marketing.contact.reference', { reference: state.reference ?? '' })}</p>
          </>
        ) : (
          <p className="text-15 leading-normal text-text-2">{t('marketing.contact.sent', { reference: state.reference ?? '', days: RULES.supportReplyDays })}</p>
        )}
        <Button variant="quiet" onClick={onAgain} className="self-start">
          {t('marketing.contact.again')}
        </Button>
      </div>
    );
  }

  return (
    <form
      action={action}
      noValidate
      aria-label={t('marketing.contact.formLabel')}
      className="flex min-w-0 flex-[1_1_420px] flex-col gap-4 rounded-16 border border-line bg-surface p-4 nav:p-6"
    >
      <Field label={t('marketing.contact.topic')} error={err('topic')}>
        <Select name="topic" defaultValue={state.values.topic}>
          {TOPICS.map((k) => (
            <option key={k} value={k}>
              {t(`marketing.contact.topics.${k}`)}
            </option>
          ))}
        </Select>
      </Field>
      <input type="hidden" name="key" value={key} suppressHydrationWarning />
      {account ? (
        <>
          <Field label={t('marketing.contact.aboutJob')} hint={t('marketing.contact.jobHint')}>
            <Select name="jobId" defaultValue={state.values.jobId ?? ''}>
              <option value="">{t('marketing.contact.noJob')}</option>
              {account.jobs.map((job) => (
                <option key={job.id} value={job.id}>{`${job.title} · ${formatDate(job.at, locale)}`}</option>
              ))}
            </Select>
          </Field>
          <p className="m-0 text-13 leading-snug text-text-3">{t('marketing.contact.answerTo', { email: account.email })}</p>
        </>
      ) : (
        <Field label={t('marketing.contact.email')} error={err('email')}>
          <Input name="email" type="email" autoComplete="email" placeholder={t('marketing.contact.emailPlaceholder')} defaultValue={state.values.email} />
        </Field>
      )}
      <Field label={t('marketing.contact.link')} error={err('link')}>
        <Input name="link" type="url" placeholder={t('marketing.contact.linkPlaceholder')} defaultValue={state.values.link} />
      </Field>
      <Field label={t('marketing.contact.message')} error={err('message')}>
        <Textarea name="message" rows={6} className="min-h-40" placeholder={t('marketing.contact.messagePlaceholder')} defaultValue={state.values.message} />
      </Field>
      {state.status === 'failed' && <Notice>{t('marketing.contact.failed')}</Notice>}
      {state.status === 'limited' && <Notice>{t('marketing.contact.error.limited')}</Notice>}
      <Button type="submit" pending={pending} className="self-stretch nav:self-start">
        {pending ? t('marketing.contact.sending') : state.status === 'failed' || state.status === 'limited' ? t('marketing.contact.tryAgain') : t('marketing.contact.send')}
      </Button>
    </form>
  );
}
