import { notFound } from 'next/navigation';
import { SITE } from '@/core/config';
import { getI18n } from '@/core/i18n/server';
import { data } from '@/data';
import { PaymentEmail, emailNameOf, propsFor, ReadyEmail, RefusedEmail, ResetEmail, StoppedEmail, VerifyEmail, isEmailName, type EmailSpec } from '@/features/emails';
import { devOnly } from '../../dev-only';

function card(spec: EmailSpec) {
  switch (spec.kind) {
    case 'verify': return <VerifyEmail {...spec.props} />;
    case 'reset': return <ResetEmail {...spec.props} />;
    case 'ready': return <ReadyEmail {...spec.props} />;
    case 'stopped': return <StoppedEmail {...spec.props} />;
    case 'refused': return <RefusedEmail {...spec.props} />;
    case 'payment': return <PaymentEmail {...spec.props} />;
  }
}

export const dynamic = 'force-dynamic';

export default async function EmailPreview({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  devOnly();
  if(process.env.VC_MAIL==='resend')notFound();
  const { name } = await params;
  if (!isEmailName(name)) notFound();
  const { id } = await searchParams;
  const sentId = Array.isArray(id) ? id[0] : id;
  // An id of another kind (or an unknown id) falls back to the sample.
  const sent = sentId ? ((await data.mailer.outbox()).find((e) => e.id === sentId && emailNameOf(e) === name) ?? null) : null;
  const { t, locale } = await getI18n();
  const spec = propsFor(name, sent, t, locale);
  const credits = spec.kind === 'payment' ? spec.props.credits : '';

  // Page padding is fluid between spacing steps 16 (phone) and 32, as on the boards.
  return (
    <div className="min-h-screen bg-bg px-[clamp(16px,8vw-16px,32px)] py-[clamp(16px,8vw-16px,32px)]" data-theme="light">
      <div className="mx-auto flex max-w-[600px] flex-col gap-4">
        <p className="m-0 text-13 leading-[1.4] text-text-3">
          From: {SITE.name} · Subject: {t(`emails.${name}.subject`, { credits })}
        </p>
        {card(spec)}
      </div>
    </div>
  );
}
