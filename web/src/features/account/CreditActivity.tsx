'use client';

import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { LedgerEntry } from '@/data/ports';
import { formatDate } from '@/shared/lib/format';
import { Card } from '@/shared/ui';

export function CreditActivity({ entries, packNames = [] }: { entries: LedgerEntry[]; packNames?: string[] }) {
  const t = useT();
  const locale = useLocale();
  const name = (e: LedgerEntry) => {
    if (e.type === 'purchase' || (e.type === 'refund' && packNames.includes(e.note))) return t('account.activity.pack', { name: e.note });
    return e.note || t('account.activity.fallbackName');
  };
  return (
    <Card as="section" aria-labelledby="h-activity" className="flex flex-col gap-2">
      <h2 id="h-activity" className="m-0 mb-2 heading-5">{t('account.activity.title')}</h2>
      {entries.length === 0 ? (
        <p className="m-0 border-t border-line pt-3 text-15 text-text-2">{t('account.activity.empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {entries.map((e) => (
            <li key={e.id} className="flex justify-between gap-4 border-t border-line py-3">
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-15 font-semibold [overflow-wrap:anywhere]">{name(e)}</span>
                <span className="text-13 text-text-3">
                  {t('account.activity.detail', { type: t(`account.activity.type.${e.type}`), date: formatDate(e.at, locale) })}
                </span>
              </span>
              <span className={`flex-none whitespace-nowrap text-15 font-semibold tabular-nums ${e.change > 0 ? 'text-accent-text' : 'text-text'}`}>
                {e.change > 0 ? `+${e.change}` : e.change < 0 ? `−${Math.abs(e.change)}` : '0'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
