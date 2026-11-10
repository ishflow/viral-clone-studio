import { requireAdmin } from '@/core/session/guards';
import { AdminCredits } from '@/features/admin-revenue';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('adminRevenue');

export default async function CreditsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  return <AdminCredits searchParams={searchParams} />;
}
