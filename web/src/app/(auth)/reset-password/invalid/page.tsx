import { ResetInvalidScreen } from '@/features/auth/screens';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('forgot');

export default function ResetInvalidPage() {
  return <ResetInvalidScreen />;
}
