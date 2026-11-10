import { requireAdmin } from '@/core/session/guards';
import { AdminRevenue } from '@/features/admin-revenue';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('adminRevenue');

export default async function RevenuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  return <AdminRevenue searchParams={searchParams} />;
}
