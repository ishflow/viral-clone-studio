import { redirect } from 'next/navigation';
import { demoAidsAllowed } from '@/core/paid-mode';
import { getSessionUser } from '@/core/session/session';
import { AuthForm } from '@/features/auth';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('login');

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  // A verification link opened under another account's session: the form is shown, logging in replaces that session.
  if (reason !== 'verify-login' && (await getSessionUser())) redirect('/gallery');
  return <AuthForm mode="login" next={typeof next === 'string' ? next : ''} google={demoAidsAllowed()} expired={reason === 'expired'} passwordReset={reason === 'password-reset'} emailChanged={reason === 'email-changed'} accountDeleted={reason === 'account-deleted'} verifyLogin={reason === 'verify-login'} />;
}
