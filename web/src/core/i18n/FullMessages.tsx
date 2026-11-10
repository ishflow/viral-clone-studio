import type { ReactNode } from 'react';
import { I18nExtend } from './I18nProvider';
import { otherMessages } from './messages';
import { getI18n } from './server';

/** For a layout whose pages use more than the public messages the root layout sends: adds the rest. */
export async function FullMessages({ children }: { children: ReactNode }) {
  const { messages } = await getI18n();
  return <I18nExtend messages={otherMessages(messages)}>{children}</I18nExtend>;
}
