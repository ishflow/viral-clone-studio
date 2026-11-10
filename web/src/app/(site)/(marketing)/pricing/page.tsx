import { freeOffer } from '@/core/free-offer';
import { inviteOnly } from '@/core/invite';
import { getSessionUser } from '@/core/session/session';
import { data } from '@/data';
import { startCheckout } from '@/features/checkout';
import { resolveReturnTo } from '@/features/marketing/returnTo';
import { PricingView } from '@/features/marketing/PricingView';
import { pageTitle } from '@/core/i18n/page-title';
import { shareMetadata } from '@/features/marketing/share';

export const generateMetadata = async () => ({ ...(await pageTitle('pricing')), ...(await shareMetadata('pricing')) });

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[]; notice?: string | string[] }> }) {
  const { returnTo, notice } = await searchParams;
  const [packs, rates, user] = await Promise.all([data.payments.packs(), data.payments.rates(), getSessionUser()]);
  const free = await freeOffer(user);
  // The Buy action belongs to the checkout feature; the page hands it to the pricing view (features do not import each other).
  return <PricingView packs={packs} rates={rates} signedIn={user !== null} freeOffer={free} invite={user === null && inviteOnly()} returnTo={resolveReturnTo(returnTo)} buy={startCheckout} notice={Array.isArray(notice) ? notice[0] : notice} />;
}
