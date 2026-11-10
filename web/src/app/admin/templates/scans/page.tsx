import { requireAdmin } from '@/core/session/guards';
import { AdminScans } from '@/features/admin-templates';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('adminTemplates');

export default async function ScansPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  return <AdminScans searchParams={searchParams} />;
}
