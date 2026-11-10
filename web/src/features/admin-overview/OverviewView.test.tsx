import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { OverviewNumbers } from '@/data/ports';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { OverviewView } from './OverviewView';
import { parsePeriod } from '@/core/period';

afterEach(cleanup);

const numbers: OverviewNumbers = {
  users: 7, newSignUps: 3, verified: 6, payingUsers: 2, revenue: null, creditsSold: 140, creditsSpent: 61,
  freeVideosUsed: 4, generationCost: null, margin: null, stoppedJobs: 2, paymentsNotCompleted: 1, templatesWaiting: 5, refundRequests: 0,
};

const tile = (label: string) => screen.getByText(label).parentElement!;

describe('parsePeriod', () => {
  it('accepts the four periods and falls back to 30 days', () => {
    expect(['today', '7d', '30d', 'all'].map(parsePeriod)).toEqual(['today', '7d', '30d', 'all']);
    expect(parsePeriod('year')).toBe('30d');
    expect(parsePeriod(undefined)).toBe('30d');
    expect(parsePeriod(['7d', 'all'])).toBe('7d');
  });
});

describe('OverviewView', () => {
  const props = {
    period: '30d' as const, numbers,
    purchases: [
      { id: 'p1', at: '2026-10-01T10:00:00Z', userId: 'usr-demo', email: 'demo@viralclone.app', packName: 'Standard', amount: null, refunded: false },
    ],
    signups: [
      { id: 'usr-new', joinedAt: '2026-10-03T10:00:00Z', email: 'new@viralclone.app', verified: true, firstVideo: 'none' as const },
      { id: 'usr-free', joinedAt: '2026-09-28T10:00:00Z', email: 'free-only@example.com', verified: false, firstVideo: 'done' as const },
    ],
    chart: null,
  };

  it('a purchase of a deleted account says "Deleted account": no raw id, no link to a user page that does not exist', () => {
    renderWithI18n(<OverviewView {...props} purchases={[{ ...props.purchases[0]!, userId: '0b7e0d5c-5d0a-4e6b-9a51-4f0f4f2f9b11', email: null }]} />);
    const row = within(screen.getByRole('table', { name: 'Latest purchases' })).getAllByRole('row')[1]!;
    expect(row).toHaveTextContent('Deleted account');
    expect(row).not.toHaveTextContent('0b7e0d5c');
    expect(row.querySelector('a[href^="/admin/users/"]')).toBeNull();
  });

  it('a purchase that was refunded or whose refund was sent says "Refunded" and stays in the list; a paid one has no tag', () => {
    const [paid] = props.purchases;
    renderWithI18n(<OverviewView {...props} purchases={[paid!, { ...paid!, id: 'p2', packName: 'Studio', refunded: true }]} />);
    const rows = within(screen.getByRole('table', { name: 'Latest purchases' })).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).not.toHaveTextContent('Refunded');
    expect(rows[2]).toHaveTextContent('Studio pack');
    expect(rows[2]).toHaveTextContent('Refunded');
  });

  it('out of credits at the provider is a warning at the top; without it there is none', () => {
    renderWithI18n(<OverviewView {...props} />);
    expect(screen.queryByText(/no credits/)).toBeNull();
    cleanup();
    renderWithI18n(<OverviewView {...props} outOfCredits />);
    expect(screen.getByText(/no credits/).closest('[role="alert"]')).toHaveTextContent('The provider refused the last paid request: no credits. Top up the account; customers\' jobs stop until then.');
  });

  it('shows the numbers from the data layer in the two board groups; money is the placeholder', () => {
    renderWithI18n(<OverviewView {...props} />);
    const customers = screen.getByRole('region', { name: 'Customers' });
    expect(within(customers).getByText('Users').parentElement).toHaveTextContent('7');
    expect(within(customers).getByText('New sign-ups').parentElement).toHaveTextContent('3');
    expect(within(customers).getByText('Verified emails').parentElement).toHaveTextContent('6');
    expect(within(customers).getByText('Paying users').parentElement).toHaveTextContent('2');
    const money = screen.getByRole('region', { name: 'Money and credits' });
    expect(within(money).getByText('Credits sold').parentElement).toHaveTextContent('140');
    expect(within(money).getByText('Credits spent').parentElement).toHaveTextContent('61');
    expect(within(money).getByText('Free videos used').parentElement).toHaveTextContent('4');
    for (const label of ['Revenue', 'Generation cost', 'Margin']) expect(tile(label)).toHaveTextContent('—');
  });

  it('"Needs attention" has three rows that link to the right pages, with their counts', () => {
    renderWithI18n(<OverviewView {...props} />);
    const list = within(screen.getByRole('region', { name: 'Needs attention' }));
    const link = (name: RegExp) => list.getByRole('link', { name });
    expect(link(/Stopped jobs/)).toHaveAttribute('href', '/admin/jobs?status=stopped');
    expect(link(/Stopped jobs/)).toHaveTextContent('2');
    expect(link(/Payments not completed/)).toHaveAttribute('href', '/admin/revenue?status=not-completed');
    expect(link(/Payments not completed/)).toHaveTextContent('1');
    expect(link(/Templates waiting to publish/)).toHaveAttribute('href', '/admin/templates/inbox');
    expect(link(/Templates waiting to publish/)).toHaveTextContent('5');
  });

  it('the period control is links, 30 days is current', () => {
    renderWithI18n(<OverviewView {...props} />);
    const group = screen.getByRole('group', { name: 'Period' });
    expect(within(group).getByRole('link', { name: '30 days' })).toHaveAttribute('aria-current', 'page');
    expect(within(group).getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/admin?period=today');
    expect(within(group).getByRole('link', { name: 'All time' })).toHaveAttribute('href', '/admin?period=all');
  });

  it('latest purchases and sign-ups link to the user and to the full pages', () => {
    renderWithI18n(<OverviewView {...props} />);
    const buys = screen.getByRole('table', { name: 'Latest purchases' });
    expect(within(buys).getByRole('link', { name: 'demo@viralclone.app' })).toHaveAttribute('href', '/admin/users/usr-demo');
    expect(within(buys).getByText('Standard pack')).toBeInTheDocument();
    expect(within(buys).getByText('—')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all purchases' })).toHaveAttribute('href', '/admin/revenue');
    const signups = screen.getByRole('table', { name: 'Latest sign-ups' });
    expect(within(signups).getByRole('link', { name: 'new@viralclone.app' })).toHaveAttribute('href', '/admin/users/usr-new');
    expect(within(signups).getByText('Not yet')).toBeInTheDocument();
    expect(within(signups).getByText('Not verified')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all users' })).toHaveAttribute('href', '/admin/users');
  });

  it('Needs attention: stopped jobs, refund requests, payments, templates, in that order; Refund requests links to the open requests', () => {
    renderWithI18n(<OverviewView {...props} numbers={{ ...numbers, refundRequests: 3 }} />);
    const group = screen.getByRole('region', { name: 'Needs attention' });
    const links = within(group).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/admin/jobs?status=stopped', '/admin/revenue?status=refund-requested', '/admin/revenue?status=not-completed', '/admin/templates/inbox']);
    expect(links[1]).toHaveTextContent('Refund requests');
    expect(links[1]).toHaveTextContent('3');
    expect(links[1]).toHaveTextContent('Purchases with a refund request that is not answered yet.');
  });

  it('the chart: one bar per day from the data, the selected day in the legend, the same data as a table; a day without a number has no bar', () => {
    const chart = [
      { date: '2026-10-01', revenueCents: 1900, costCents: null },
      { date: '2026-10-02', revenueCents: 0, costCents: null },
      { date: '2026-10-03', revenueCents: 5400, costCents: null },
      { date: '2026-10-04', revenueCents: null, costCents: null },
    ];
    const { container } = renderWithI18n(<OverviewView {...props} chart={chart} />);
    expect(container.querySelectorAll('[data-day]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-bar="revenue"]')).toHaveLength(2);
    expect(container.querySelector('[data-day="2026-10-03"] [data-bar="revenue"]')).not.toBeNull();
    expect(container.querySelector('[data-day="2026-10-02"] [data-bar]')).toBeNull();
    expect(container.querySelector('[data-day="2026-10-04"] [data-bar]')).toBeNull();
    const table = screen.getByRole('table', { name: 'Revenue and generation cost per day' });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(within(table).getByText('$54')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Revenue and generation cost' })).queryByText('Generation cost', { selector: 'span' })).toBeNull(); // not measured: no series, no legend
  });

  it('the chart has its own error with Try again when the days could not be read (the page stays)', () => {
    renderWithI18n(<OverviewView {...props} chart={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the chart.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  });
});
