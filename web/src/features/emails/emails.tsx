'use client';

import { useT } from '@/core/i18n/I18nProvider';
import type { MailContent, MailFact } from '@/core/payments/mail-view';
import { EmailFrame } from './EmailCard';

/** One email = the content the sent mail is made of: `EmailFrame` draws it exactly as the mail is drawn. */
function useFooter(): Pick<MailContent, 'home' | 'footer'> {
  const t = useT();
  return { home: '/', footer: { intro: t('emails.footer.intro'), contact: { label: t('emails.footer.contact'), href: '/contact' }, company: t('emails.footer.company') } };
}

/** `token` is the single-use link of a real email; without one (the preview) the button goes to the waiting page. `change`: the mail of a new address, not of a sign-up. `free`: false when the sign-up does not give a free video. */
export function VerifyEmail({ validity, token = null, change = false, free = true }: { validity: string; token?: string | null; change?: boolean; free?: boolean }) {
  const t = useT();
  return (
    <EmailFrame
      mail={{
        ...useFooter(),
        title: t(change ? 'emails.verify.changeTitle' : 'emails.verify.title'),
        body: t(change ? 'emails.verify.changeBody' : free ? 'emails.verify.body' : 'emails.verify.bodyPlain'),
        action: { label: t('emails.verify.action'), href: token ? `/verify-email/confirm?token=${encodeURIComponent(token)}` : '/verify-email' },
        note: t(change ? 'emails.verify.changeNote' : 'emails.verify.note', { validity }),
      }}
    />
  );
}

export function ResetEmail({ email, validity, token = null }: { email: string; validity: string; token?: string | null }) {
  const t = useT();
  return (
    <EmailFrame
      mail={{
        ...useFooter(),
        title: t('emails.reset.title'),
        body: t('emails.reset.body', { email }),
        action: { label: t('emails.reset.action'), href: token ? `/reset-password?token=${encodeURIComponent(token)}` : '/reset-password' },
        note: t('emails.reset.note', { validity }),
      }}
    />
  );
}

export function ReadyEmail({ jobId, title, minutes, details }: { jobId: string; title: string; minutes: string; details: string }) {
  const t = useT();
  return (
    <EmailFrame
      mail={{
        ...useFooter(),
        status: { label: t('emails.ready.status'), tone: 'done' },
        title: t('emails.ready.title'),
        body: minutes ? t('emails.ready.body', { minutes }) : t('emails.ready.bodyUnknown'),
        summary: { title, details },
        action: { label: t('emails.ready.action'), href: `/jobs/${jobId}` },
        note: t('emails.ready.note'),
      }}
    />
  );
}

export function StoppedEmail({ jobId, title, saved, missing, reason, returned = "[CREDITS]", free = false, resumeCost = returned, swapClosed = false, swapStop }: { jobId: string; title: string; saved: string; missing: string; reason: string; returned?: string; free?: boolean; resumeCost?: string; swapClosed?: boolean; swapStop?: 'photo-refused' | 'person-missing' }) {
  const t = useT();
  const contentRefusal = reason === 'content-rule';
  const checking = reason === 'submission-unknown';   // we look into the request ourselves: nothing to do, nothing to pay (the job page says the same)
  const swapNew = swapClosed || swapStop === undefined ? null : swapStop === 'photo-refused' ? 'swapPhotoRefused' : 'swapPersonMissing';   // a person swap that is not continued: a new job with another photo
  return (
    <EmailFrame
      mail={{
        ...useFooter(),
        status: { label: t('emails.stopped.status'), tone: 'warn' },
        title: t('emails.stopped.title'),
        body: t(swapClosed ? 'emails.stopped.swapOffBody' : swapNew ? `emails.stopped.${swapNew}Body` : contentRefusal ? 'emails.stopped.contentBody' : checking ? 'emails.stopped.checkingBody' : free ? 'emails.stopped.freeBody' : 'emails.stopped.body', { credits: returned }),
        facts: ([
          [t('emails.stopped.template'), title],
          [t('emails.stopped.saved'), saved],
          [t('emails.stopped.missing'), missing],
          [t(free ? 'emails.stopped.freeReturned' : 'emails.stopped.returned'), free ? t('emails.stopped.freeVideo') : returned],
        ] as MailFact[]).filter((row): row is MailFact => row[1] !== ''), // a row with nothing to say is left out, like in the sent mail
        action: { label: t('emails.stopped.action'), href: `/jobs/${jobId}` },
        note: `${t(swapClosed ? 'emails.stopped.swapOffNote' : swapNew ? `emails.stopped.${swapNew}Note` : contentRefusal ? 'emails.stopped.contentNote' : checking ? 'emails.stopped.checkingNote' : free ? 'emails.stopped.freeNote' : 'emails.stopped.note', { credits: resumeCost })}${swapClosed || swapNew ? '' : ` ${t('emails.stopped.retention')}`}`,
      }}
    />
  );
}

function RefundSentEmail(p: { pack: string; credits: string; amount: string; date: string }) {
  const t = useT();
  return (
    <EmailFrame
      mail={{
        ...useFooter(),
        status: { label: t('emails.refundSent.status'), tone: 'done' },
        title: t('emails.refundSent.title'),
        body: t('emails.refundSent.body', { pack: p.pack, credits: p.credits }),
        facts: [
          [t('emails.refundSent.pack'), p.pack],
          [t('emails.refundSent.credits'), p.credits],
          [t('emails.refundSent.amount'), p.amount],
          [t('emails.refundSent.date'), p.date],
        ],
        action: { label: t('emails.refundSent.action'), href: '/account' },
        note: t('emails.refundSent.note'),
      }}
    />
  );
}

function RefundedEmail({ pack }: { pack: string }) {
  const t = useT();
  return (
    <EmailFrame
      mail={{
        ...useFooter(),
        title: t('emails.refund.title'),
        body: t('emails.refund.body', { pack }),
        action: { label: t('emails.refund.action'), href: '/account' },
        note: t('emails.refund.note'),
      }}
    />
  );
}

export function PaymentEmail(p: { invoiceId: string; pack: string; credits: string; balance: string; amount: string; date: string; number: string; returnTo: string; refundSent?: true; refunded?: true; price?: string; tax?: string; invoiceUrl?: string }) {
  const t = useT();
  if (p.refundSent) return <RefundSentEmail {...p} />;
  if (p.refunded) return <RefundedEmail pack={p.pack} />;
  return (
    <EmailFrame
      mail={{
        ...useFooter(),
        status: { label: t('emails.payment.status'), tone: 'done' },
        title: t('emails.payment.title', { credits: p.credits }),
        body: `${t('emails.payment.body', { balance: p.balance })} ${t('emails.payment.saved')}`,
        facts: [
          [t('emails.payment.pack'), p.pack],
          [t('emails.payment.credits'), p.credits],
          ...(p.price && p.tax ? [[t('emails.payment.price'), p.price], [t('emails.payment.tax'), p.tax]] satisfies [string, string][] : []),
          [t('emails.payment.paid'), p.amount],
          [t('emails.payment.date'), p.date],
          [t('emails.payment.invoiceNumber'), p.number],
        ],
        action: { label: t('emails.payment.action'), href: p.returnTo },
        secondary: [...(p.invoiceUrl ? [{ label: t('emails.payment.invoiceDodo'), href: p.invoiceUrl }] : []), { label: t('emails.payment.invoice'), href: `/invoices/${p.invoiceId}` }],
        note: t('emails.payment.note'),
      }}
    />
  );
}

/** A person swap that was not approved: the credits are back, the photographs are deleted. */
export function RefusedEmail({ jobId, title, returned }: { jobId: string; title: string; returned: string }) {
  const t = useT();
  return (
    <EmailFrame
      mail={{
        ...useFooter(),
        title: t('emails.refused.title'),
        body: t('emails.refused.body', { credits: returned }),
        facts: [[t('emails.stopped.template'), title], [t('emails.stopped.returned'), returned]],
        action: { label: t('emails.refused.action'), href: `/jobs/${jobId}` },
        note: t('emails.refused.note'),
      }}
    />
  );
}
