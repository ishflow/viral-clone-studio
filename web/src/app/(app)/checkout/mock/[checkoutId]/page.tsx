import { notFound } from 'next/navigation';
import { requireUser } from '@/core/session/guards';
import { data } from '@/data';
import { MockProvider } from '@/features/checkout';
import { isPaidMode, ownerTestConfig } from '@/core/paid-mode';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('checkout');

export default async function MockProviderPage({ params }: { params: Promise<{ checkoutId: string }> }) {
  if (isPaidMode() && !ownerTestConfig(process.env)) notFound(); // the fake provider page does not exist with real money
  const { checkoutId } = await params;
  const user = await requireUser(`/checkout/mock/${encodeURIComponent(checkoutId)}`);
  const checkout = await data.payments.getCheckout(checkoutId, user.id);
  if (!checkout) notFound();
  return <MockProvider checkout={checkout} />;
}
