import { BlockedScreen } from '@/features/auth/screens';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('blocked');

export default function BlockedPage() {
  return <BlockedScreen />;
}
