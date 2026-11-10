import { GenerateScreen } from '@/features/generate';
import { recordTitle } from '@/core/i18n/page-title';
import { data } from '@/data';

export const generateMetadata = async ({ params }: { params: Promise<{ id: string }> }) =>
  recordTitle('generate', async (viewer) => (viewer ? data.catalog.get((await params).id, viewer.id) : true));

export default async function GeneratePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string | string[] }> }) {
  const { from } = await searchParams;
  return <GenerateScreen id={(await params).id} from={typeof from === 'string' ? from : undefined} />;
}
