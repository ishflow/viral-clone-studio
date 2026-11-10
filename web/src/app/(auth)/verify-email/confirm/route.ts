import { redirect } from 'next/navigation';
import { refreshShell } from '@/core/session/refresh';
import { getSessionUser, VERIFY_LINK_PATH } from '@/core/session/session';
import { data } from '@/data';

export const dynamic = 'force-dynamic';

/**
 * The link of the verification email (and of the email-change email): `?token=`. Single use. The address is verified (or the new one
 * taken over) and the person goes on; a link that is too old or used already goes to the page that says so.
 * Signing in is not done here: whoever holds the link proves the address, not the person, so /welcome asks for the login when there is none.
 * The link of a sign-up is completed only in a browser that holds the session of its own account; anywhere else it verifies nothing
 * and goes to the log-in page, which brings the visitor back here afterwards (the message there names no address).
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const result = await data.auth.confirmEmailLink(token, (await getSessionUser())?.id ?? null);
  if (!result.ok && result.reason === 'login-required') redirect(`/login?reason=verify-login&next=${encodeURIComponent(`${VERIFY_LINK_PATH}?token=${encodeURIComponent(token)}`)}`);
  if (!result.ok) redirect(result.reason === 'expired' ? '/verify-email/expired' : `/verify-email/expired?state=${result.reason}`);
  refreshShell();
  // The new address ends the old session (`sessionVersion`), so the account page would only say the session was closed: say what happened instead.
  redirect(result.purpose === 'email-change' ? '/login?reason=email-changed&next=%2Faccount' : '/welcome');
}
