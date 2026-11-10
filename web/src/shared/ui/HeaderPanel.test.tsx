import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeaderPanel } from './HeaderPanel';
import { renderWithI18n } from './test-utils';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/users/usr-demo' }));

afterEach(cleanup);

describe('HeaderPanel', () => {
  it('has the seven sections, the Admin tag and View site', () => {
    renderWithI18n(<HeaderPanel current="revenue" />);
    const nav = screen.getByRole('navigation', { name: 'Admin menu' });
    expect(within(nav).getAllByRole('link')).toHaveLength(7);
    expect(within(nav).getByRole('link', { name: 'Revenue' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'View site' })).toHaveAttribute('href', '/gallery');
  });
  it('has the photo review link, and marks it (and not Jobs) on its own page', () => {
    renderWithI18n(<HeaderPanel current="review" />);
    const nav = screen.getByRole('navigation', { name: 'Admin menu' });
    expect(within(nav).getByRole('link', { name: 'Photo review' })).toHaveAttribute('href', '/admin/jobs/review');
    expect(within(nav).getByRole('link', { name: 'Photo review' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Jobs' })).not.toHaveAttribute('aria-current');
  });
  it('derives the section from the path (a sub-page keeps its section)', () => {
    renderWithI18n(<HeaderPanel />);
    const nav = screen.getByRole('navigation', { name: 'Admin menu' });
    expect(within(nav).getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
  });
});
