'use server';

import { cookies } from 'next/headers';
import { refreshShell } from '@/core/session/refresh';
import { THEME_COOKIE, readTheme, type ThemeChoice } from './theme';

const YEAR = 60 * 60 * 24 * 365;

export async function setTheme(choice: ThemeChoice): Promise<void> {
  const value = readTheme(choice);
  const jar = await cookies();
  if (value === 'system') jar.delete(THEME_COOKIE);
  else jar.set(THEME_COOKIE, value, { path: '/', maxAge: YEAR, sameSite: 'lax' });
  refreshShell();
}
