import { ResetSentScreen } from '@/features/auth/screens';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('forgot');

export default async function ResetSentPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  return <ResetSentScreen email={(await searchParams).email} />;
}
