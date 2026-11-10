import { WelcomeScreen } from '@/features/auth/WelcomeScreen';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('welcome');

export default function WelcomePage() {
  return <WelcomeScreen />;
}
