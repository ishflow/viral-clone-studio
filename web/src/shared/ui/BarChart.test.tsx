import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from './test-utils';
import { BarChart, type BarChartLabels, type BarDay } from './BarChart';

afterEach(cleanup);
const labels: BarChartLabels = { title: 'Revenue per day', revenue: 'Revenue', cost: 'Generation cost', axis: 'USD', date: 'Date', empty: 'No sales in this period.', error: 'Could not load the chart.', retry: 'Try again', loading: 'Loading chart…', hint: 'Use the arrow keys.' };
const days: BarDay[] = [
  { date: '2026-10-01', revenueCents: 1900, costCents: null },
  { date: '2026-10-02', revenueCents: 5400, costCents: null },
  { date: '2026-10-03', revenueCents: 0, costCents: null },
];
const draw = (over: Partial<Parameters<typeof BarChart>[0]> = {}) =>
  renderWithI18n(<BarChart labels={labels} days={days} formatDay={(d) => d.slice(5)} formatAmount={(c) => `$${c / 100}`} {...over} />);

describe('BarChart', () => {
  it('data: a bar per day with a number, heights from the data (the biggest day is full height), the last day selected in the legend', () => {
    const { container } = draw();
    expect(container.querySelectorAll('[data-day]')).toHaveLength(3);
    const bars = [...container.querySelectorAll<HTMLElement>('[data-bar="revenue"]')];
    expect(bars).toHaveLength(2);
    expect(bars[1]!.style.height).toBe('100%');
    expect(Number.parseFloat(bars[0]!.style.height)).toBeCloseTo((1900 / 5400) * 100, 1);
    expect(screen.getByRole('heading', { name: 'Revenue per day' })).toBeInTheDocument();
    expect(container.querySelector('[aria-live]')).toHaveTextContent('Revenue$010-03');
  });

  it('the drawing is hidden from screen readers; the same data is a table with a row per day', () => {
    const { container } = draw();
    expect(container.querySelector('[data-day]')!.closest('[aria-hidden="true"]')).not.toBeNull();
    const table = screen.getByRole('table', { name: 'Revenue per day' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByRole('row', { name: /10-02/ })).toHaveTextContent('$54');
  });

  it('arrow keys pick a day (Home and End too); the legend reads the picked day', async () => {
    draw();
    const plot = screen.getByRole('group', { name: /Revenue per day\. Use the arrow keys\./ });
    plot.focus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(document.querySelector('[aria-live]')).toHaveTextContent('$19');
    await userEvent.keyboard('{End}');
    expect(document.querySelector('[aria-live]')).toHaveTextContent('10-03');
    await userEvent.keyboard('{Home}{ArrowRight}');
    expect(document.querySelector('[aria-live]')).toHaveTextContent('$54');
  });

  it('cost, when it is measured, is drawn under the zero line and has its legend; not measured: no cost series at all', () => {
    const withCost = days.map((d) => ({ ...d, costCents: 500 }));
    const { container, unmount } = draw({ days: withCost });
    expect(container.querySelectorAll('[data-bar="cost"]')).toHaveLength(3);
    expect(document.querySelector('[aria-live]')).toHaveTextContent('Generation cost');
    unmount();
    const plain = draw();
    expect(plain.container.querySelectorAll('[data-bar="cost"]')).toHaveLength(0);
    expect(screen.queryByText('Generation cost')).toBeNull(); // not in the legend, not a table column
  });

  it('empty (no days, or no sales): the message in the plot, axis and dates stay, nothing to pick', () => {
    draw({ days: days.map((d) => ({ ...d, revenueCents: 0 })) });
    expect(screen.getByText('No sales in this period.')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Revenue per day/ })).not.toHaveAttribute('tabindex');
  });

  it('loading: aria-busy, the text and skeleton bars', () => {
    const { container } = draw({ state: 'loading' });
    expect(container.querySelector('figure')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading chart…');
  });

  it('error: the message and Try again, which calls back', async () => {
    const onRetry = vi.fn();
    draw({ state: 'error', onRetry });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the chart.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('showTitle=false keeps the name for screen readers but draws no heading', () => {
    draw({ showTitle: false });
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('table', { name: 'Revenue per day' })).toBeInTheDocument();
  });
});
