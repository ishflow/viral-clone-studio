import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/core/i18n/I18nProvider';
import { loadMessages } from '@/core/i18n/messages';
import type { Locale } from '@/core/i18n/types';

/** Renders with the real message files, so tests read the same text the site shows. */
export function renderWithI18n(ui: ReactElement, locale: Locale = 'en') {
  return render(
    <I18nProvider locale={locale} messages={loadMessages(locale)}>
      {ui}
    </I18nProvider>,
  );
}

/** The HTML the server sends for `ui` (what Cloudflare sees before it hides addresses), with the real message files. */
export function serverHtml(ui: ReactElement, locale: Locale = 'en'): string {
  return renderToStaticMarkup(
    <I18nProvider locale={locale} messages={loadMessages(locale)}>
      {ui}
    </I18nProvider>,
  );
}

/** How many times `address` stands where Cloudflare's address hiding would rewrite it: outside `<!--email_off-->` sections and `<script>`. */
export function exposedAddresses(html: string, address: string): number {
  const open = html.replace(/<!--email_off-->[\s\S]*?<!--\/email_off-->|<script[\s\S]*?<\/script>/g, '');
  return open.split(address).length - 1;
}
