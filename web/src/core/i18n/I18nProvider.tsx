'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createTranslate } from './translate';
import type { Locale, Messages, Translate } from './types';

const I18nContext = createContext<{ locale: Locale; messages: Messages; t: Translate } | null>(null);

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const value = useMemo(() => ({ locale, messages, t: createTranslate(locale, messages) }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Adds messages to the ones the provider above already has (the root layout sends the public part, a layout behind a sign-in sends the rest). */
export function I18nExtend({ messages, children }: { messages: Messages; children: ReactNode }) {
  const parent = useI18n();
  const all = useMemo(() => ({ ...parent.messages, ...messages }), [parent.messages, messages]);
  return <I18nProvider locale={parent.locale} messages={all}>{children}</I18nProvider>;
}

function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used inside <I18nProvider>');
  return ctx;
}

export function useT(): Translate {
  return useI18n().t;
}

export function useLocale(): Locale {
  return useI18n().locale;
}
