import type { Locale, Translate } from '@/core/i18n/types';
import { RULES, type EmailKind, type SentEmail } from '@/data/ports';
import { stoppedParts } from '@/core/payments/email';
import { formatDate } from '@/shared/lib/format';

/** `refundSent` and `refund` are payment mails (`data.refund === 'sent'`: the refund is on its way; `'true'`: it is complete) with boards of their own. */
export const EMAIL_NAMES = ['verify', 'reset', 'ready', 'stopped', 'payment', 'refundSent', 'refund', 'refused'] as const satisfies readonly (EmailKind | 'refundSent' | 'refund')[];
export type EmailName = (typeof EMAIL_NAMES)[number];

/** The preview board of a mail: its kind, except the two mails about a refund. */
export function emailNameOf(mail: SentEmail): EmailName {
  if (mail.kind !== 'payment') return mail.kind;
  return mail.data.refund === 'sent' ? 'refundSent' : mail.data.refund === 'true' ? 'refund' : 'payment';
}

export function isEmailName(name: string): name is EmailName {
  return (EMAIL_NAMES as readonly string[]).includes(name);
}

export type EmailSpec =
  | { kind: 'verify'; props: { validity: string; token: string | null; change: boolean; free: boolean } }
  | { kind: 'reset'; props: { email: string; validity: string; token: string | null } }
  | { kind: 'ready'; props: { jobId: string; title: string; minutes: string; details: string } }
  | { kind: 'stopped'; props: { jobId: string; title: string; saved: string; missing: string; reason: string; returned?: string; free?: boolean; resumeCost?: string; swapClosed?: boolean; swapStop?: 'photo-refused' | 'person-missing' } }
  | { kind: 'refused'; props: { jobId: string; title: string; returned: string } }
  | { kind: 'payment'; props: { invoiceId: string; pack: string; credits: string; balance: string; amount: string; date: string; number: string; returnTo: string; refundSent?: true; refunded?: true; price?: string; tax?: string; invoiceUrl?: string } };

/**
 * Props for one email. With an outbox entry: its data, and every value the entry does not carry is a bracket
 * placeholder. Without one (email === null): the board's sample facts, from messages.
 */
export function propsFor(kind: EmailName, email: SentEmail | null, t: Translate, locale: Locale): EmailSpec {
  const d = email?.data ?? {};
  const ph = (key: string) => t(`emails.placeholder.${key}`);
  // Sample facts exist only for the no-entry preview.
  const sample = (key: string, placeholder: string) => (email ? ph(placeholder) : t(`emails.sample.${key}`));
  switch (kind) {
    case 'verify':
      return { kind, props: { validity: t('emails.validity.hours', { count: RULES.verifyLinkHours }), token: d.token ?? null, change: d.purpose === 'email-change', free: d.free !== '0' } };
    case 'reset':
      return { kind, props: { email: d.email ?? ph('email'), validity: t('emails.validity.hours', { count: RULES.resetLinkHours }), token: d.token ?? null } };
    case 'ready':
      return {
        kind,
        props: {
          jobId: d.jobId ?? 'sample',
          title: d.templateTitle ?? sample('title', 'title'),
          minutes: d.minutes ?? (email ? '' : t('emails.sample.minutes')),
          details: d.details ?? (d.seconds && (d.quality === 'fast' || d.quality === 'best') ? t('emails.ready.details', { seconds: Math.round(Number(d.seconds)), quality: t(`common.quality.${d.quality}`) }) : sample('readyDetails', 'details')),
        },
      };
    case 'stopped': {
      // An entry lists what it carries (the sent mail's rows); the sample facts and placeholders are only for what it carries none of.
      const parts = stoppedParts(d, t);
      const carries = d.saved || d.missing || d.images || d.clips || d.music || d.reason === 'content-rule';
      return {
        kind,
        props: {
          jobId: d.jobId ?? 'sample',
          title: d.templateTitle ?? sample('title', 'title'),
          saved: carries ? parts.saved : sample('stoppedSaved', 'saved'),
          missing: carries ? parts.missing : sample('stoppedMissing', 'missing'),
          returned: d.returned ?? (email ? ph('credits') : '2'),
          free: d.free === '1',
          swapClosed: d.swapClosed === '1',
          swapStop: d.swapStop === 'photo-refused' || d.swapStop === 'person-missing' ? d.swapStop : undefined,
          resumeCost: d.resumeCost ?? d.returned ?? (email ? ph('credits') : '2'),
          reason: email ? (d.reason ?? '') : 'clips-failed',
        },
      };
    }
    case 'refused':
      return { kind, props: { jobId: d.jobId ?? 'sample', title: d.templateTitle ?? sample('title', 'title'), returned: d.returned ?? (email ? ph('credits') : '3') } };
    case 'refund':
      // The mail says only that the refund of the pack is confirmed: the receipt's other facts stay empty.
      return { kind: 'payment', props: { invoiceId: 'sample', pack: d.packName ?? sample('pack', 'pack'), credits: '', balance: '', amount: '', date: '', number: '', returnTo: '/account', refunded: true } };
    case 'refundSent':
      return {
        kind: 'payment',
        props: {
          invoiceId: 'sample',
          pack: d.packName ?? sample('pack', 'pack'),
          credits: d.credits ?? ph('credits'),
          balance: '',
          amount: d.amount || ph('amount'),
          date: email ? formatDate(d.date ?? email.at, locale) : ph('date'),
          number: '',
          returnTo: '/account',
          refundSent: true,
        },
      };
    case 'payment':
      return {
        kind,
        props: {
          invoiceId: d.invoiceId ?? 'sample',
          pack: d.packName ?? sample('pack', 'pack'),
          credits: d.credits ?? ph('credits'),
          balance: d.balance ?? ph('balance'),
          // A receipt of a payment the provider added tax to carries the pack price, the tax and the total that was charged.
          ...(d.amount && d.tax && d.total ? { amount: d.total, price: d.amount, tax: d.tax } : { amount: ph('amount') }),
          ...(d.invoiceUrl ? { invoiceUrl: d.invoiceUrl } : {}),
          date: email ? formatDate(email.at, locale) : ph('date'),
          number: ph('invoiceNumber'),
          returnTo: d.returnTo && d.returnTo.startsWith('/') && !d.returnTo.startsWith('//') && !d.returnTo.startsWith('/\\') ? d.returnTo : '/gallery',
        },
      };
  }
}
