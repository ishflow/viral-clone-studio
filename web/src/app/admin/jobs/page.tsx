import { requireAdmin } from '@/core/session/guards';
import { AdminJobs } from '@/features/admin-jobs';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('adminJobs');

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  return <AdminJobs searchParams={searchParams} />;
}
