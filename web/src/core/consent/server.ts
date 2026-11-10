import { cookies } from 'next/headers';
import { CONSENT_COOKIE, readConsent } from './consent';

/** The visitor's cookie answer, or null while the notice is unanswered. */
export async function getCookieConsent() {
  return readConsent((await cookies()).get(CONSENT_COOKIE)?.value);
}
