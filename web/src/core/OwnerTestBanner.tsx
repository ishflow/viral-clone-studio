import { isOwnerTestMode } from './paid-mode';
import { getSessionUser } from './session/session';
/** Server component: this warning is for the admin, on every page. A visitor or a customer is not told how the site is run. */
export async function OwnerTestBanner() {
  if (!isOwnerTestMode() || (await getSessionUser())?.role !== 'admin') return null;
  return <aside role="alert" className="bg-warn px-4 py-3 text-center font-semibold text-black">OWNER TEST: real Magnific money is spent / gerçek Magnific parası harcanır</aside>;
}
