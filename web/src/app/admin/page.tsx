import { DeliveryLink } from '@/features/emails/DeliveryLink';
import { requireAdmin } from '@/core/session/guards';
import { AdminOverview } from '@/features/admin-overview';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('adminOverview');

export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  return <><DeliveryLink /><AdminOverview searchParams={searchParams} /></>;
}
