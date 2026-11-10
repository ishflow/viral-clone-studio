'use client';

import Link from 'next/link';
import { useT } from '@/core/i18n/I18nProvider';
import { cx } from '@/shared/lib/cx';
import { withEmail } from '@/shared/ui/Email';
import { LEGAL_DOCS, LEGAL_SECTIONS, LEGAL_WRITTEN, legalBlocks, type LegalDoc } from './legal';

export function LegalView({ doc }: { doc: LegalDoc }) {
  const t = useT();
  const sections = Array.from({ length: LEGAL_SECTIONS[doc] }, (_, i) => i + 1);
  return (
    <div className="flex flex-wrap items-start gap-x-18 gap-y-6">
      <nav
        aria-label={t('marketing.legal.nav')}
        className="flex min-w-0 flex-[1_1_100%] flex-wrap gap-2 nav:max-w-65 nav:flex-[1_1_200px] nav:flex-col nav:flex-nowrap nav:gap-1"
      >
        {LEGAL_DOCS.map((d) => {
          const current = d === doc;
          return (
            <Link
              key={d}
              href={`/legal/${d}`}
              aria-current={current ? 'page' : undefined}
              className={cx(
                'box-border flex min-h-11 flex-none items-center rounded-full border px-4 text-15 whitespace-nowrap no-underline nav:rounded-12 nav:border-0',
                current ? 'border-raised bg-raised font-semibold text-text' : 'border-edge text-text-2 nav:text-text-3',
              )}
            >
              {t(`marketing.legal.doc.${d}`)}
            </Link>
          );
        })}
      </nav>
      <article className="flex max-w-190 min-w-0 flex-[4_1_520px] flex-col gap-8">
        <div className="flex flex-col gap-3">
          {/* A-Yasal h1: clamp(36px, 4.6vw, 64px). */}
          <h1 className="text-[clamp(36px,4.6vw,64px)] leading-[0.96] font-extrabold tracking-[-0.035em] font-display">
            {doc === 'refunds' ? t('marketing.legal.heading.refunds') : t(`marketing.legal.doc.${doc}`)}
          </h1>
          <p className="text-13 text-text-3">{t('marketing.legal.updated')}</p>
        </div>
        {sections.map((n) => (
          <section key={n} className="flex flex-col gap-3 border-t border-line pt-6">
            <h2 className="heading-5">{t(`marketing.legal.sections.${doc}.${n}`)}</h2>
            {legalBlocks(LEGAL_WRITTEN.includes(doc) ? t(`marketing.legal.body.${doc}.${n}`) : t('marketing.legal.text')).map((block, i) =>
              block.list ? (
                <ul key={i} className="flex list-disc flex-col gap-2 pl-6 text-17 leading-[1.65] text-text-2">
                  {block.lines.map((line, j) => <li key={j}>{withEmail(line)}</li>)}
                </ul>
              ) : (
                <p key={i} className="text-17 leading-[1.65] text-text-2">{withEmail(block.lines[0]!)}</p>
              ),
            )}
            {doc === 'refunds' && n === 5 && (
              <p className="text-17 leading-[1.65] text-text-2">
                {t('marketing.legal.refundsContact.before')} <Link href="/contact?topic=refund">{t('marketing.legal.refundsContact.link')}</Link> {withEmail(t('marketing.legal.refundsContact.after'))}
              </p>
            )}
          </section>
        ))}
      </article>
    </div>
  );
}
