'use client';

import { useId, useState, type KeyboardEvent } from 'react';
import { cx } from '@/shared/lib/cx';
import { Button } from './Button';
import { Icon } from './Icon';

/** One day of a bar chart. Amounts in cents; null = nothing to count it from (never drawn as 0). */
export type BarDay = { date: string; revenueCents: number | null; costCents: number | null };

export type BarChartLabels = {
  title: string;
  revenue: string;
  cost: string;
  /** The unit above the left axis, e.g. "USD". */
  axis: string;
  date: string;
  empty: string;
  error: string;
  retry: string;
  loading: string;
  /** Spoken name of the focusable plot: how to pick a day. */
  hint: string;
};

type Props = {
  labels: BarChartLabels;
  /** `loading` and `error` are the states of the card; `ready` draws `days` (all zero / empty → the empty state). */
  state?: 'ready' | 'loading' | 'error';
  days: BarDay[];
  formatDay: (iso: string) => string;
  formatAmount: (cents: number) => string;
  onRetry?: () => void;
  /** Show the generation-cost series (under the zero line). Default: only when some day has a cost. */
  showCost?: boolean;
  /** false: the card has a heading of its own around it; `labels.title` is then only the name for screen readers. Default true. */
  showTitle?: boolean;
  className?: string;
};

const PLOT = 'h-48';

/**
 * A bar chart of days: revenue above the zero line, generation cost below it, one scale. The drawing is `aria-hidden`; the same data is
 * a table for screen readers, and the focusable plot picks a day with the arrow keys (the selected day is read out in the legend).
 * The bars come from the data only; a day without a number has no bar.
 */
export function BarChart({ labels, state = 'ready', days, formatDay, formatAmount, onRetry, showCost, showTitle = true, className }: Props) {
  const uid = useId();
  const [picked, setPicked] = useState<number | null>(null);
  const hasCost = showCost ?? days.some((d) => (d.costCents ?? 0) > 0);
  const max = Math.max(0, ...days.map((d) => Math.max(d.revenueCents ?? 0, d.costCents ?? 0)));
  const empty = days.length === 0 || (max === 0 && !days.some((d) => d.revenueCents !== null && d.revenueCents > 0));
  const selected = picked !== null && picked < days.length ? picked : days.length - 1;
  const day = days[selected];

  const card = 'box-border flex min-w-0 flex-col gap-4 rounded-16 border border-line bg-surface p-4 nav:p-6';
  const head = showTitle ? <h2 className="m-0 text-17 leading-snug font-semibold">{labels.title}</h2> : null;

  if (state === 'loading') {
    return (
      <figure aria-busy="true" className={cx(card, 'm-0', className)}>
        {head}
        <div role="status" className="flex flex-col gap-4">
          <span className="text-15 text-text-2">{labels.loading}</span>
          <div aria-hidden="true" className={cx('flex items-end gap-2', PLOT)}>
            {[40, 65, 30, 80, 55, 45, 70, 35, 60, 50].map((h, i) => (
              <span key={i} style={{ height: `${h}%` }} className="min-w-0 flex-1 animate-pulse bg-raised" />
            ))}
          </div>
        </div>
      </figure>
    );
  }
  if (state === 'error') {
    return (
      <figure className={cx(card, 'm-0', className)}>
        {head}
        <div role="alert" className={cx('flex flex-col items-center justify-center gap-4 text-center', PLOT)}>
          <p className="m-0 flex items-center gap-2 text-15 text-warn">
            <Icon name="warning" size={18} />
            {labels.error}
          </p>
          <Button variant="secondary" onClick={onRetry}>{labels.retry}</Button>
        </div>
      </figure>
    );
  }

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const to = e.key === 'ArrowRight' ? selected + 1 : e.key === 'ArrowLeft' ? selected - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? days.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    setPicked(Math.min(days.length - 1, Math.max(0, to)));
  };
  const first = days[0];
  const middle = days[Math.floor(days.length / 2)];
  const last = days[days.length - 1];

  return (
    <figure className={cx(card, 'm-0', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        {head}
        {!empty && day && (
          <p aria-live="polite" className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-13 text-text-2">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="size-2.5 bg-accent" />
              {labels.revenue}
              <b className="font-semibold text-text tabular-nums">{day.revenueCents === null ? '–' : formatAmount(day.revenueCents)}</b>
            </span>
            {hasCost && (
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="size-2.5 bg-warn" />
                {labels.cost}
                <b className="font-semibold text-text tabular-nums">{day.costCents === null ? '–' : formatAmount(day.costCents)}</b>
              </span>
            )}
            <span className="text-text-3">{formatDay(day.date)}</span>
          </p>
        )}
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
        <span aria-hidden="true" className="text-right text-13 leading-none text-text-3">{labels.axis}</span>
        <span aria-hidden="true" />
        <div aria-hidden="true" className={cx('flex flex-col text-right text-13 leading-none text-text-3 tabular-nums', PLOT, empty ? 'justify-end' : 'justify-between')}>
          {empty ? (
            <span>0</span>
          ) : hasCost ? (
            <>
              <span>{formatAmount(max)}</span>
              <span>0</span>
              <span>{formatAmount(max)}</span>
            </>
          ) : (
            <>
              <span>{formatAmount(max)}</span>
              <span>0</span>
            </>
          )}
        </div>
        <div
          role="group"
          tabIndex={empty ? undefined : 0}
          aria-label={`${labels.title}. ${labels.hint}`}
          onKeyDown={empty ? undefined : key}
          className={cx('relative min-w-0 rounded-8 border-b border-line', PLOT)}
        >
          {empty ? (
            <p className="absolute inset-0 m-0 flex items-center justify-center px-4 text-center text-15 text-text-2">{labels.empty}</p>
          ) : (
            <div aria-hidden="true" className="absolute inset-0 flex items-stretch gap-px">
              {days.map((d, i) => {
                const up = d.revenueCents && max > 0 ? (d.revenueCents / max) * 100 : 0;
                const down = d.costCents && max > 0 ? (d.costCents / max) * 100 : 0;
                const half = hasCost ? 50 : 100;
                return (
                  <button
                    key={d.date}
                    type="button"
                    tabIndex={-1}
                    data-day={d.date}
                    data-selected={i === selected || undefined}
                    onClick={() => setPicked(i)}
                    onMouseEnter={() => setPicked(i)}
                    className={cx('relative min-w-0 flex-1 cursor-pointer border-0 p-0', i === selected ? 'bg-raised' : 'bg-transparent')}
                  >
                    {up > 0 && <span data-bar="revenue" style={{ height: `${(up * half) / 100}%`, bottom: hasCost ? '50%' : 0 }} className="absolute inset-x-px min-h-px bg-accent" />}
                    {down > 0 && <span data-bar="cost" style={{ height: `${(down * half) / 100}%`, top: '50%' }} className="absolute inset-x-px min-h-px bg-warn" />}
                  </button>
                );
              })}
              {hasCost && <span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-edge-strong" />}
            </div>
          )}
        </div>
        <span aria-hidden="true" />
        {first && middle && last && (
          <div aria-hidden="true" className="flex justify-between gap-2 text-13 text-text-3">
            <span>{formatDay(first.date)}</span>
            {days.length > 2 && <span className="max-nav:hidden">{formatDay(middle.date)}</span>}
            {days.length > 1 && <span>{formatDay(last.date)}</span>}
          </div>
        )}
      </div>
      <table className="sr-only" aria-describedby={`${uid}-d`}>
        <caption id={`${uid}-d`}>{labels.title}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.date}</th>
            <th scope="col">{labels.revenue}</th>
            {hasCost && <th scope="col">{labels.cost}</th>}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th scope="row">{formatDay(d.date)}</th>
              <td>{d.revenueCents === null ? '' : formatAmount(d.revenueCents)}</td>
              {hasCost && <td>{d.costCents === null ? '' : formatAmount(d.costCents)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
