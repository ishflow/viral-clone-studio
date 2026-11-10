import { CompareJobView } from '@/features/jobs';
import { recordTitle } from '@/core/i18n/page-title';
import { data } from '@/data';

export const generateMetadata = async ({ params }: { params: Promise<{ id: string }> }) =>
  recordTitle('compare', async (viewer) => (viewer ? data.jobs.get((await params).id, viewer.id) : true));

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string | string[] }>;
}) {
  const { v } = await searchParams;
  return <CompareJobView id={(await params).id} variant={typeof v === 'string' ? v : undefined} />;
}
