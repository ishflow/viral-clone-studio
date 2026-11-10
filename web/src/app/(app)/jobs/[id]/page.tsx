import { JobView } from '@/features/jobs';
import { recordTitle } from '@/core/i18n/page-title';
import { data } from '@/data';

export const generateMetadata = async ({ params }: { params: Promise<{ id: string }> }) =>
  recordTitle('job', async (viewer) => (viewer ? data.jobs.get((await params).id, viewer.id) : true));

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  return <JobView id={(await params).id} />;
}
