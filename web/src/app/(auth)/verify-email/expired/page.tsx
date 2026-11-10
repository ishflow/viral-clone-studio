import { VerifyLinkScreen } from '@/features/auth/screens';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('verify');

export default async function VerifyLinkPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  return <VerifyLinkScreen state={state === 'used' || state === 'invalid' ? state : 'expired'} />;
}
