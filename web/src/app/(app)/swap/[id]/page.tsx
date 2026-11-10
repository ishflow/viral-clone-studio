import { recordTitle } from '@/core/i18n/page-title';
import { data } from '@/data';
import { SwapVideoScreen } from '@/features/swap';

export const generateMetadata = async ({ params }: { params: Promise<{ id: string }> }) =>
  recordTitle('swapVideo', async (viewer) => (viewer ? data.swap.template((await params).id) : true));

export default async function SwapVideoPage({ params }: { params: Promise<{ id: string }> }) {
  return <SwapVideoScreen id={(await params).id} />;
}
