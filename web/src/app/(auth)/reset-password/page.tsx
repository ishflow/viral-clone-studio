import { ResetScreen } from '@/features/auth/screens';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('forgot');

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  return <ResetScreen token={(await searchParams).token} />;
}
