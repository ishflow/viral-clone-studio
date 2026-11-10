import { requireAdmin } from '@/core/session/guards';
import { AdminUsers } from '@/features/admin-users';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('adminUsers');

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  return <AdminUsers searchParams={searchParams} />;
}
