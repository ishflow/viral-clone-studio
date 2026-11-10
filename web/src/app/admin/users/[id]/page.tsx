import { requireAdmin } from '@/core/session/guards';
import { AdminUserDetail } from '@/features/admin-users';
import { recordTitle } from '@/core/i18n/page-title';
import { data } from '@/data';

// Only an admin is told whether the record is there; anyone else gets the page's own title and the 403.
export const generateMetadata = async ({ params }: { params: Promise<{ id: string }> }) =>
  recordTitle('adminUsers', async (viewer) => (viewer?.role === 'admin' ? data.admin.user((await params).id) : true));

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  return <AdminUserDetail id={(await params).id} />;
}
