import { requireAdmin } from '@/core/session/guards';
import { AdminSwapQueue } from '@/features/admin-jobs';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('adminJobReview');
// The line names customers and their photographs: it is read for every request, never kept.
export const dynamic = 'force-dynamic';

export default async function SwapReviewPage() {
  await requireAdmin();
  return <AdminSwapQueue />;
}
