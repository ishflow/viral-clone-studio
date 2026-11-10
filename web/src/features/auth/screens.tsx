import Link from 'next/link';
import { redirect } from 'next/navigation';
import { freeOffer } from '@/core/free-offer';
import { getI18n } from '@/core/i18n/server';
import { getSessionUser } from '@/core/session/session';
import { data } from '@/data';
import { RULES } from '@/data/ports';
import { demoAidsAllowed } from '@/core/paid-mode';
import { Button, Icon, LinkButton } from '@/shared/ui';
import { LogOutForm } from '@/shared/ui/LogOutForm';
import { StatusPage } from '@/shared/ui/StatusPage';
import { signUpWithAnotherEmail } from './actions';
import { DemoConfirm } from './DemoConfirm';
import { ForgotForm } from './ForgotForm';
import { AuthTitle, Lead, withStrongEmail } from './parts';
import { ResendButton } from './ResendButton';
import { ResetForm } from './ResetForm';

/** `/verify-email`: only for a signed-in user whose email is not verified yet. */
export async function VerifyEmailScreen() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=%2Fverify-email');
  if (user.emailVerified) redirect('/welcome');
  const { t } = await getI18n();
  const textKey = (await freeOffer(user)) ? 'auth.verify.text' : 'auth.verify.textPlain';
  return (
    <>
      <div className="flex flex-col gap-3">
        <span className="flex items-center gap-2 text-15 font-semibold text-accent-text">
          <Icon name="done" size={18} strokeWidth={2.6} />
          {t('auth.verify.badge')}
        </span>
        <AuthTitle>{t('auth.verify.title')}</AuthTitle>
        <Lead>{withStrongEmail(t, textKey, user.email)}</Lead>
      </div>
      <ResendButton kind="verify" />
      <p className="m-0 text-13 leading-snug text-text-3">{t('auth.verify.spam', { seconds: RULES.resendSeconds })}</p>
      {/* A form, not a link: /signup sends a signed-in visitor to the gallery, so the session ends first. */}
      <form action={signUpWithAnotherEmail} className="flex flex-wrap items-center gap-x-1.5 text-13 text-text-3">
        {t('auth.verify.wrong')}
        <Button type="submit" variant="quiet" className="border-0 p-0 font-[inherit] text-13">
          {t('auth.verify.another')}
        </Button>
      </form>
      <LogOutForm>
        <Button type="submit" variant="quiet" className="border-0 p-0 font-[inherit] text-13">
          {t('auth.verify.logOut')}
        </Button>
      </LogOutForm>
      {demoAidsAllowed() && <DemoConfirm />}
    </>
  );
}

/** `/forgot-password`. */
export async function ForgotScreen() {
  const { t } = await getI18n();
  return (
    <>
      <div className="flex flex-col gap-2">
        <AuthTitle>{t('auth.forgot.title')}</AuthTitle>
        <Lead>{t('auth.forgot.lead')}</Lead>
      </div>
      <ForgotForm />
      <LinkButton href="/login" variant="quiet" className="self-start">
        <Icon name="back" size={18} />
        {t('auth.forgot.back')}
      </LinkButton>
    </>
  );
}

/** `/forgot-password/sent?email=`: without the address there is nothing to show. */
export async function ResetSentScreen({ email }: { email: string | undefined }) {
  if (!email) redirect('/forgot-password');
  const { t } = await getI18n();
  const demoToken = !demoAidsAllowed() ? undefined : await lastResetToken(email);
  return (
    <>
      <div className="flex flex-col gap-3">
        <span className="flex items-center gap-2 text-15 font-semibold text-accent-text">
          <Icon name="done" size={18} strokeWidth={2.6} />
          {t('auth.sent.badge')}
        </span>
        <AuthTitle>{t('auth.sent.title')}</AuthTitle>
        <Lead>{withStrongEmail(t, 'auth.sent.text', email, { validity: t('auth.validity.hours', { count: RULES.resetLinkHours }) })}</Lead>
      </div>
      <ResendButton kind="reset" email={email} />
      <p className="m-0 text-13 leading-snug text-text-3">{t('auth.sent.spam', { seconds: RULES.resendSeconds })}</p>
      <LinkButton href="/login" variant="quiet" className="self-start">
        <Icon name="back" size={18} />
        {t('auth.forgot.back')}
      </LinkButton>
      {/* Demo aid, not on the canvas: stands in for opening the link from the email (fake mode only). */}
      {demoToken && (
        <Link href={`/reset-password?token=${encodeURIComponent(demoToken)}`} className="flex min-h-11 items-center text-13 text-text-2 hover:text-text">
          {t('auth.sent.demo')}
        </Link>
      )}
    </>
  );
}

/**
 * The token of the newest reset email to this address in the fake outbox (the demo "open the link" step); none for an unknown address.
 * And none for an admin account, in any mode: this link must never be a way into the admin panel.
 */
async function lastResetToken(email: string): Promise<string | undefined> {
  const owner = (await data.admin.users({ search: email })).find((row) => row.user.email === email.toLowerCase());
  if (owner?.user.role !== 'customer') return undefined;
  const mails = await data.mailer.outbox();
  return mails.find((mail) => mail.kind === 'reset' && mail.to.toLowerCase() === email.toLowerCase())?.data.token;
}

/** `/reset-password?token=`: the link of the reset email. A link that is unknown, used or too old goes to the page that says so. */
export async function ResetScreen({ token }: { token: string | undefined }) {
  if (!token) redirect('/forgot-password');
  const link = await data.auth.checkResetLink(token);
  if (!link.ok) redirect('/reset-password/invalid');
  const { t } = await getI18n();
  return (
    <>
      <div className="flex flex-col gap-2">
        <AuthTitle>{t('auth.reset.title')}</AuthTitle>
        <Lead>{withStrongEmail(t, 'auth.reset.lead', link.email)}</Lead>
      </div>
      <ResetForm token={token} />
    </>
  );
}

/** `/reset-password/invalid` (A-Sifre-Baglanti-Gecersiz). */
export async function ResetInvalidScreen() {
  const { t } = await getI18n();
  return (
    <StatusPage icon="warning" title={t('auth.resetInvalid.title')} text={t('auth.resetInvalid.text', { validity: t('auth.validity.hours', { count: RULES.resetLinkHours }) })}>
      <LinkButton href="/forgot-password" size="l">{t('auth.resetInvalid.send')}</LinkButton>
      <LinkButton href="/login" variant="secondary" size="l">{t('auth.link.back')}</LinkButton>
    </StatusPage>
  );
}

/** `/verify-email/expired` (A-Baglanti-Gecersiz): the link is too old, its address is verified already, or the link was never valid. */
export async function VerifyLinkScreen({ state }: { state: 'expired' | 'used' | 'invalid' }) {
  const { t } = await getI18n();
  if (state === 'used') {
    return (
      <StatusPage icon="done" title={t('auth.link.usedTitle')}>
        <LinkButton href="/login" size="l">{t('auth.link.usedLogin')}</LinkButton>
      </StatusPage>
    );
  }
  if (state === 'invalid') {
    return (
      <StatusPage icon="warning" title={t('auth.link.invalidTitle')} text={t('auth.link.invalidText')}>
        <LinkButton href="/login" size="l">{t('auth.link.back')}</LinkButton>
      </StatusPage>
    );
  }
  return (
    <StatusPage icon="warning" title={t('auth.link.expiredTitle')} text={t('auth.link.expiredText', { validity: t('auth.validity.hours', { count: RULES.verifyLinkHours }) })}>
      <LinkButton href="/verify-email" size="l">{t('auth.link.send')}</LinkButton>
      <LinkButton href="/login" variant="secondary" size="l">{t('auth.link.back')}</LinkButton>
    </StatusPage>
  );
}

/** `/blocked` (A-Hesap-Engelli). */
export async function BlockedScreen() {
  const { t } = await getI18n();
  return (
    <StatusPage icon="private" title={t('auth.blocked.title')} text={t('auth.blocked.text')}>
      <LinkButton href="/contact?topic=account" variant="secondary" size="l">{t('auth.blocked.contact')}</LinkButton>
      <LinkButton href="/login" size="l">{t('auth.link.back')}</LinkButton>
    </StatusPage>
  );
}
