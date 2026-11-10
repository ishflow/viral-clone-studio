import { LOCALES, type Locale } from './types';

export function readLocale(cookieValue: string | undefined): Locale {
  return LOCALES.find((l) => l === cookieValue) ?? 'en';
}
