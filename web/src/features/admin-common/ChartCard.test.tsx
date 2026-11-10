import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';

const loadDailySeries = vi.fn();
vi.mock('./actions', () => ({ loadDailySeries: (...a: unknown[]) => loadDailySeries(...a) }));

import { ChartCard } from './ChartCard';
import { ListError } from './ListError';
import { toBarDays } from './series';

afterEach(() => {
  cleanup();
  loadDailySeries.mockReset();
});

describe('ChartCard', () => {
  it('starts in its own error when the page could not read the days; Try again asks the server for the period and shows the days', async () => {
    loadDailySeries.mockResolvedValue([{ date: '2026-10-01', revenueCents: 1900, costCents: null }]);
    renderWithI18n(<ChartCard period="7d" initial={null} title="Revenue per day" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the chart.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(loadDailySeries).toHaveBeenCalledWith('7d'));
    expect(await screen.findByRole('table', { name: 'Revenue per day' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a retry that fails again goes back to the error, not to an empty chart', async () => {
    loadDailySeries.mockResolvedValue(null);
    renderWithI18n(<ChartCard period="30d" initial={null} title="Revenue per day" />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(loadDailySeries).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the chart.');
  });
});

describe('the data layer\'s days', () => {
  it('toBarDays keeps null as null (no number is invented)', () => {
    expect(toBarDays([{ date: '2026-10-01', revenueCents: null, generationCostCents: null }])).toEqual([{ date: '2026-10-01', revenueCents: null, costCents: null }]);
  });
});

describe('ListError', () => {
  it('says nothing was changed and retries', async () => {
    const onRetry = vi.fn();
    renderWithI18n(<ListError onRetry={onRetry} />);
    expect(screen.getByText('Could not load this list.')).toBeInTheDocument();
    expect(screen.getByText('Check your connection and try again. Nothing was changed.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
