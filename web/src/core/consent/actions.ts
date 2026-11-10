'use server';

import { cookies } from 'next/headers';
import { refreshShell } from '@/core/session/refresh';
import { CONSENT_COOKIE, readConsent } from './consent';

const YEAR = 60 * 60 * 24 * 365;

/** Form action of the cookie notice. No analytics exist yet: both answers only store the choice. */
export async function setCookieConsent(formData: FormData): Promise<void> {
  const choice = readConsent(String(formData.get('choice') ?? ''));
  if (!choice) return;
  (await cookies()).set(CONSENT_COOKIE, choice, { path: '/', maxAge: YEAR, sameSite: 'lax' });
  refreshShell();
}

/** Form action of the footer's "Cookie settings": forgets the answer so the notice comes back and the visitor can choose again. */
export async function clearCookieConsent(): Promise<void> {
  (await cookies()).delete(CONSENT_COOKIE);
  refreshShell();
}
