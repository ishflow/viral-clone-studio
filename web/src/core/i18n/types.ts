export type Locale = 'en' | 'tr';
export const LOCALES: readonly Locale[] = ['en', 'tr'];
export const LOCALE_COOKIE = 'vc_locale';
export type Messages = Record<string, string>;
export type Translate = (key: string, params?: Record<string, string | number>) => string;
