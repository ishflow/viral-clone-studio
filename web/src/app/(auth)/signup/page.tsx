import { redirect } from 'next/navigation';
import { demoAidsAllowed } from '@/core/paid-mode';
import { freeOffer } from '@/core/free-offer';
import { inviteOnly } from '@/core/invite';
import { getSessionUser } from '@/core/session/session';
import { AuthForm } from '@/features/auth';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('signup');

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSessionUser()) redirect('/gallery');
  const { next } = await searchParams;
  return <AuthForm mode="signup" next={typeof next === 'string' ? next : ''} google={demoAidsAllowed()} freeOffer={await freeOffer(null)} inviteOnly={inviteOnly()} />;
}
