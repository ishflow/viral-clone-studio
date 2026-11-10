import { freeOffer } from '@/core/free-offer';
import { getI18n } from '@/core/i18n/server';
import { inviteOnly } from '@/core/invite';
import { personSwapOpen } from '@/core/person-swap';
import { getBalanceLabel } from '@/core/session/balance';
import { getSessionUser } from '@/core/session/session';
import { HeaderCustomer } from './HeaderCustomer';
import { HeaderVisitor } from './HeaderVisitor';

/** Server component: the customer header (with the live balance) when signed in, the visitor header otherwise (its phone menu offers the free first video only while the admin's setting is on and sign-up is open; in invite mode it asks for an invite instead). */
export async function SessionHeader() {
  const user = await getSessionUser();
  if (!user) {
    const invite = inviteOnly();
    return <HeaderVisitor freeOffer={(await freeOffer(null)) && !invite} invite={invite} />;
  }
  const { t } = await getI18n();
  return <HeaderCustomer isAdmin={user.role === 'admin'} balanceLabel={await getBalanceLabel(user, t)} swap={await personSwapOpen()} />;
}
