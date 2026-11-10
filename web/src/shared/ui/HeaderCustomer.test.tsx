import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeaderCustomer } from './HeaderCustomer';
import { renderWithI18n } from './test-utils';

vi.mock('@/core/session/actions', () => ({ logOut: vi.fn() }));
vi.mock('@/core/i18n/actions', () => ({ setLocale: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/pricing' }));
// Shows what each link asked of the router: `next/link` itself prints nothing about `prefetch`.
vi.mock('next/link', () => ({
  default: ({ prefetch, children, ...rest }: { prefetch?: boolean; children?: React.ReactNode } & Record<string, unknown>) => (
    <a data-prefetch={String(prefetch)} {...rest}>{children}</a>
  ),
}));

afterEach(cleanup);

describe('HeaderCustomer', () => {
  it('marks the current page with aria-current and shows the balance label', () => {
    renderWithI18n(<HeaderCustomer current="videos" balanceLabel="12 credits" />);
    const nav = screen.getByRole('navigation', { name: 'Main menu' });
    expect(within(nav).getByRole('link', { name: 'My videos' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Gallery' })).not.toHaveAttribute('aria-current');
    expect(screen.getAllByText('12 credits').length).toBeGreaterThan(0);
  });
  it('marks Account when it is the current page', () => {
    renderWithI18n(<HeaderCustomer current="account" balanceLabel="12 credits" />);
    const current = screen.getAllByRole('link', { current: 'page' });
    expect(current.map((a) => a.textContent)).toContain('Account');
  });
  it('derives the current page from the path when no current prop is given', () => {
    renderWithI18n(<HeaderCustomer balanceLabel="12 credits" />);
    const nav = screen.getByRole('navigation', { name: 'Main menu' });
    expect(within(nav).getByRole('link', { name: 'Pricing' })).toHaveAttribute('aria-current', 'page');
  });
});

it('renders the admin entry only for an administrator', () => {
  renderWithI18n(<HeaderCustomer balanceLabel="1 credit" />);
  expect(screen.queryByRole('link', { name: 'Admin panel' })).toBeNull();
  cleanup();
  renderWithI18n(<HeaderCustomer balanceLabel="1 credit" isAdmin />);
  expect(screen.getAllByRole('link', { name: 'Admin panel' })).toHaveLength(1);
});

it('no link of the header asks the router to load its page ahead of time: the job page refreshes itself every 2 seconds and would load them again each time', () => {
  renderWithI18n(<HeaderCustomer balanceLabel="1 credit" isAdmin />);
  const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/') && a.getAttribute('aria-label') !== 'Viral Clone'); // the logo is drawn by Logo.tsx
  expect(links.length).toBeGreaterThan(4);
  expect(links.filter((a) => a.getAttribute('data-prefetch') !== 'false').map((a) => a.getAttribute('href'))).toEqual([]);
});
