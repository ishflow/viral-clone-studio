import { cleanup, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SITE } from '@/core/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeaderVisitor } from './HeaderVisitor';
import { renderWithI18n } from './test-utils';

vi.mock('@/core/i18n/actions', () => ({ setLocale: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ prefetch, children, ...rest }: { prefetch?: boolean; children: ReactNode }) => (
    <a data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

afterEach(cleanup);

describe('HeaderVisitor', () => {
  it('links to the three public pages, log in and sign up', () => {
    renderWithI18n(<HeaderVisitor current="pricing" />);
    const nav = screen.getByRole('navigation', { name: 'Main menu' });
    expect(within(nav).getByRole('link', { name: 'Pricing' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Gallery' })).toHaveAttribute('href', '/gallery');
    expect(screen.getAllByRole('link', { name: 'Log in' })[0]).toHaveAttribute('href', '/login');
    expect(screen.getAllByRole('link', { name: 'Get started' })[0]).toHaveAttribute('href', '/signup');
  });
  it('How it works leads to /#how', () => {
    renderWithI18n(<HeaderVisitor />);
    const nav = screen.getByRole('navigation', { name: 'Main menu' });
    expect(within(nav).getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/#how');
  });
  it('the logo does not load the gallery ahead of time', () => {
    renderWithI18n(<HeaderVisitor />);
    const logos = screen.getAllByRole('link', { name: SITE.name });
    expect(logos.length).toBeGreaterThan(0);
    for (const logo of logos) expect(logo).toHaveAttribute('data-prefetch', 'false');
  });
  it('actions="language" keeps only the EN button on the desktop right', () => {
    renderWithI18n(<HeaderVisitor actions="language" phoneCta={false} />);
    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Get started' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Language/ }).length).toBeGreaterThan(0);
  });
  it('leaves the phone Get started out on the auth pages', () => {
    renderWithI18n(<HeaderVisitor phoneCta={false} />);
    expect(screen.getAllByRole('link', { name: 'Get started' })).toHaveLength(1);
  });

  it('in invite mode "Get started" becomes "Request an invite" and leads to /contact, in the bar and on the phone; Log in stays', () => {
    renderWithI18n(<HeaderVisitor invite />);
    expect(screen.queryByRole('link', { name: 'Get started' })).toBeNull();
    const asks = screen.getAllByRole('link', { name: 'Request an invite' });
    expect(asks).toHaveLength(2);
    for (const link of asks) expect(link).toHaveAttribute('href', '/contact');
    expect(screen.getAllByRole('link', { name: 'Log in' })[0]).toHaveAttribute('href', '/login');
  });
});
