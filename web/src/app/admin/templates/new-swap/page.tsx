import { requireAdmin } from '@/core/session/guards';
import { AdminNewSwap } from '@/features/admin-templates';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('adminSwapNew');

export default async function NewSwapPage() {
  await requireAdmin();
  return <AdminNewSwap />;
}
