'use client';

import './globals.css';
import en from '@/messages/en/common.json';
import tr from '@/messages/tr/common.json';

const TEXT = { en: en.serviceError, tr: tr.serviceError };

/**
 * The last resort: the root layout itself failed, so there is no provider, no header and no cookie reading on the server. The language is the
 * one of the language cookie when it can be read, else the browser's. Plain links, no site components.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const cookie = typeof document === 'undefined' ? '' : document.cookie;
  const locale = /(?:^|;\s*)vc_locale=tr\b/.test(cookie) || (!/vc_locale=/.test(cookie) && typeof navigator !== 'undefined' && navigator.language.startsWith('tr')) ? 'tr' : 'en';
  const t = TEXT[locale];
  const button = 'box-border inline-flex min-h-15 items-center justify-center rounded-12 px-8 text-15 font-semibold no-underline cursor-pointer';
  return (
    <html lang={locale}>
      <body className="min-h-screen bg-bg text-text">
        <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-12 text-center">
          <h1 className="m-0 max-w-115 text-balance font-display text-32 leading-tight font-extrabold">{t.title}</h1>
          <p className="m-0 max-w-115 text-13 leading-normal text-text-3 text-pretty">{t.note}</p>
          <div className="flex w-full max-w-115 flex-col gap-3 nav:w-auto nav:flex-row">
            <button type="button" onClick={reset} className={`${button} border-0 bg-accent text-on-accent`}>{t.retry}</button>
            <a href="/contact" className={`${button} border border-edge-strong text-text`}>{t.support}</a>
          </div>
        </main>
      </body>
    </html>
  );
}
