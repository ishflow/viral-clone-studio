import { requireUser } from '@/core/session/guards';
import { data } from '@/data';
import { FailedView, loadResult } from '@/features/checkout';
import { pageTitle } from '@/core/i18n/page-title';

type Search = { purchase?: string; returnTo?: string };

export const generateMetadata = () => pageTitle('checkout');

export default async function CheckoutFailedPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const user = await requireUser(`/checkout/failed?purchase=${encodeURIComponent(search.purchase ?? '')}`);
  const { purchase, balance, returnTo, draft } = await loadResult(user, search, 'failed');
  const pack = (await data.payments.packs()).find((p) => p.id === purchase.packId);
  return <FailedView packId={purchase.packId} packName={purchase.packName} credits={purchase.credits} price={pack?.price ?? null} balance={balance} returnTo={returnTo} draft={draft} />;
}
