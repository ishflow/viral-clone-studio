import Link from 'next/link';
import { data } from '@/data';
import type { SentEmail } from '@/data/ports';
import { getI18n } from '@/core/i18n/server';
import { getStore } from '@/data/mock/store';
import { paymentStore } from '@/data/real/payments-store';
import { DataTable, PageHead } from '@/shared/ui';
import { SendAgainButton } from './SendAgainButton';

/** The message of the subject line of a mail: the refund (sent, complete) and the new-address mails have their own, as in the mail itself (`renderEmail`). */
function subjectKey(mail: SentEmail): string {
  if (mail.kind === 'verify' && mail.data.purpose === 'email-change') return 'emails.verify.changeSubject';
  if (mail.kind === 'payment' && mail.data.refund === 'sent') return 'emails.refundSent.subject';
  return `emails.${mail.kind === 'payment' && mail.data.refund === 'true' ? 'refund' : mail.kind}.subject`;
}

/** Admin-only caller; no tokens, mail content or provider errors are returned to the browser. */
export async function DeliveryStatus() {
  await data.mailer.outbox(); // Initialize the durable site store before reading delivery metadata.
  const { t } = await getI18n();
  const deliveries = paymentStore().deliveries;
  const rows = [...getStore().outbox].reverse().map((mail) => {
    const delivery = deliveries.find((d) => d.emailId === mail.id);
    const status = delivery?.status ?? 'queued';
    return {
      id: mail.id,
      cells: {
        recipient: mail.to,
        kind: t(subjectKey(mail), { credits: mail.data.credits ?? '' }),
        status: t(`emails.delivery.${status}`),
        attempts: String(delivery?.attempts ?? 0),
        action: status === 'failed' || status === 'blocked-by-allowlist' ? <SendAgainButton emailId={mail.id} /> : null,
      },
    };
  });
  return (
    <div className="flex flex-col gap-8">
      <Link href="/admin" className="inline-flex min-h-11 items-center self-start text-15 font-medium text-accent-text no-underline hover:text-text">{t('emails.delivery.back')}</Link>
      <PageHead title={t('emails.delivery.title')} lead={t('emails.delivery.lead')} />
      <DataTable
        caption={t('emails.delivery.title')}
        minWidth={720}
        columns={[
          { key: 'recipient', header: t('emails.delivery.recipient') },
          { key: 'kind', header: t('emails.delivery.kind') },
          { key: 'status', header: t('emails.delivery.status') },
          { key: 'attempts', header: t('emails.delivery.attempts'), numeric: true },
          { key: 'action', header: t('emails.delivery.action'), srOnlyHeader: true },
        ]}
        rows={rows}
        empty={{ text: t('emails.delivery.empty') }}
      />
    </div>
  );
}
