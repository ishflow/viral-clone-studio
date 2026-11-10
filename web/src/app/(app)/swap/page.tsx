import { recordTitle } from '@/core/i18n/page-title';
import { personSwapOpen } from '@/core/person-swap';
import { SwapGalleryScreen } from '@/features/swap';

export const generateMetadata = async () => recordTitle('swap', async (viewer) => (viewer ? personSwapOpen() : true));

export default function SwapPage() {
  return <SwapGalleryScreen />;
}
