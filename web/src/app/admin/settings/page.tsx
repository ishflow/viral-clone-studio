import { requireAdmin } from '@/core/session/guards';
import { AdminSettings } from '@/features/admin-settings';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('adminSettings');

export default async function SettingsPage() {
  await requireAdmin();
  return <AdminSettings />;
}
