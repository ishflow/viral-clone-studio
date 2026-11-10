import { requireAdmin } from '@/core/session/guards';
import { AdminTemplateEdit } from '@/features/admin-templates';
import { recordTitle } from '@/core/i18n/page-title';
import { data } from '@/data';

// Only an admin is told whether the record is there; anyone else gets the page's own title and the 403.
export const generateMetadata = async ({ params }: { params: Promise<{ id: string }> }) =>
  recordTitle('adminTemplates', async (viewer) => (viewer?.role === 'admin' ? data.admin.template((await params).id) : true));

export default async function TemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  return <AdminTemplateEdit id={(await params).id} />;
}
