import { requireUser } from '@/core/session/guards';
import { SuccessView, loadResult } from '@/features/checkout';
import { pageTitle } from '@/core/i18n/page-title';

type Search = { purchase?: string; returnTo?: string };

export const generateMetadata = () => pageTitle('checkout');

export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const user = await requireUser(`/checkout/success?purchase=${encodeURIComponent(search.purchase ?? '')}`);
  const { purchase, balance, returnTo, draft } = await loadResult(user, search, 'success');
  const receipt = { packName: purchase.packName, packId: purchase.packId, credits: purchase.credits, amount: purchase.amount, at: purchase.at, invoiceId: purchase.invoiceId, taxCents: purchase.taxCents, totalCents: purchase.totalCents, invoiceUrl: purchase.invoiceUrl };
  return <SuccessView receipt={receipt} balance={balance} returnTo={returnTo} draft={draft} />;
}
