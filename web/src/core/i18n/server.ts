import { cookies } from 'next/headers';
import { readLocale } from './locale';
import { loadMessages } from './messages';
import { createTranslate } from './translate';
import { LOCALE_COOKIE, type Locale, type Messages, type Translate } from './types';

export async function getI18n(): Promise<{ locale: Locale; t: Translate; messages: Messages }> {
  const locale = readLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const messages = loadMessages(locale);
  return { locale, t: createTranslate(locale, messages), messages };
}
