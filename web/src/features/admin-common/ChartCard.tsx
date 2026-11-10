'use client';

import { useState, useTransition } from 'react';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import { formatUsd } from '@/shared/lib/format';
import { BarChart, type BarDay } from '@/shared/ui';
import { loadDailySeries } from './actions';

/**
 * The chart card of the overview and the revenue page: the days the server sent, or the card's own error with "Try again"
 * (the page does not fall over with it). "Try again" asks the server for the days again and shows the loading state meanwhile.
 */
export function ChartCard({ period, initial, title, withCost, showTitle }: { period: string; initial: BarDay[] | null; title: string; withCost?: boolean; showTitle?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [days, setDays] = useState<BarDay[] | null>(initial);
  const [pending, start] = useTransition();
  const retry = () =>
    start(async () => {
      setDays(await loadDailySeries(period));
    });
  return (
    <BarChart
      state={pending ? 'loading' : days === null ? 'error' : 'ready'}
      days={days ?? []}
      showCost={withCost ? true : undefined}
      showTitle={showTitle}
      onRetry={retry}
      formatAmount={(cents) => formatUsd(cents, locale) ?? ''}
      formatDay={(iso) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))}
      labels={{
        title,
        revenue: t('adminActions.chart.revenue'),
        cost: t('adminActions.chart.cost'),
        axis: t('adminActions.chart.axis'),
        date: t('adminActions.chart.date'),
        empty: t('adminActions.chart.empty'),
        error: t('adminActions.chart.error'),
        retry: t('adminActions.chart.retry'),
        loading: t('adminActions.chart.loading'),
        hint: t('adminActions.chart.hint'),
      }}
    />
  );
}
