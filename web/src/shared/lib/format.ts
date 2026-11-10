import type { Locale, Translate } from '@/core/i18n/types';

export function formatCredits(n: number, t: Translate): string {
  return t('common.credits.count', { count: n });
}

/** "No talking" / "Talking": the name of a template format. */
export function formatName(format: 'no-talking' | 'talking', t: Translate): string {
  return t(format === 'talking' ? 'common.format.talking' : 'common.format.noTalking');
}

/** "Oct 6, 2026": the UTC day, as the chart, the CSV and the credit history write it, so one purchase has one date on every screen. */
export function formatDate(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/**
 * The tax a payment provider added to a pack's price and the total it charged, printed like every amount ('$64.26').
 * Null where it reported no tax above zero: the screen then stays as it is without one.
 */
export function taxOf(paid: { taxCents?: number; totalCents?: number }): { tax: string; total: string } | null {
  if (!paid.taxCents || paid.totalCents === undefined) return null;
  const print = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  return { tax: print(paid.taxCents), total: print(paid.totalCents) };
}

/** "13 sec", "1 min", "1 min 15 sec": the units come from `common.duration`, so they follow the interface language. */
export function formatDuration(seconds: number, t: Translate): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const sec = t('common.duration.sec', { count: s });
  if (m === 0) return sec;
  const min = t('common.duration.min', { count: m });
  return s === 0 ? min : `${min} ${sec}`;
}

/** "0.0–1.3 sec": when a shot runs, to a tenth of a second, with the same unit message as `formatDuration`. */
export function formatSecondsRange(from: number, to: number, t: Translate): string {
  return t('common.duration.sec', { count: `${from.toFixed(1)}–${to.toFixed(1)}` });
}

/** "5 Oct 2026, 14:32": the day and the time (UTC, as the ledger stores it), for the credit history. */
export function formatDateTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(d);
}

/** Source counters have explicit units; unknown counters have no label. */
export function formatReference(value: { referenceMetric?: { count: number; kind: 'likes' | 'views' }; referenceViews?: string; views?: string }, t: Translate): string {
  const metric = value.referenceMetric;
  if (metric) {
    if (!Number.isFinite(metric.count) || metric.count <= 0) return '';
    const count = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(metric.count);
    return t(`common.reference.${metric.kind}`, { count });
  }
  const count = value.referenceViews ?? value.views;
  return count ? t('common.reference.views', { count }) : '';
}

/** US cents → "$19" or "$19.50" (whole dollars without the cents). null stays null. */
export function formatUsd(cents: number | null, locale: Locale): string | null {
  if (cents === null) return null;
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
}
