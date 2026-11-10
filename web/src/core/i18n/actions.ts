'use server';

import { cookies } from 'next/headers';
import { refreshShell } from '@/core/session/refresh';
import { LOCALES, LOCALE_COOKIE, type Locale } from './types';

const YEAR = 60 * 60 * 24 * 365;

export async function setLocale(locale: Locale): Promise<void> {
  if (!LOCALES.includes(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: YEAR, sameSite: 'lax' });
  refreshShell();
}
