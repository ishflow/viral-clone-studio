import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { MobileMenu } from './MobileMenu';
import { I18nProvider } from '@/core/i18n/I18nProvider';
import { loadMessages } from '@/core/i18n/messages';
import { readDraft, writeDraft } from '@/shared/lib/session-draft';
import { renderWithI18n } from './test-utils';

vi.mock('@/core/session/actions', () => ({ logOut: vi.fn() }));
vi.mock('@/core/i18n/actions', () => ({ setLocale: vi.fn() }));
const nav = vi.hoisted(() => ({ path: '/gallery' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path }));

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('MobileMenu', () => {
  it('opens as a dialog from the menu button', async () => {
    renderWithI18n(<MobileMenu kind="customer" current="gallery" balanceLabel="12 credits" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Main menu' });
    expect(within(dialog).getByRole('link', { name: 'Gallery' })).toHaveAttribute('aria-current', 'page');
    expect(within(dialog).getByText('12 credits')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Buy credits' })).toHaveAttribute('href', '/pricing');
  });
  it('Log out clears the forms this tab kept, so the next person on this tab does not see them', async () => {
    writeDraft('vc:draft:generate:usr-demo:tpl-a', { products: [] });
    renderWithI18n(<MobileMenu kind="customer" current="gallery" balanceLabel="12 credits" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Log out' }));
    expect(readDraft('vc:draft:generate:usr-demo:tpl-a')).toBeNull();
  });
  it('the visitor menu has a first-video-free line while the offer is on', async () => {
    renderWithI18n(<MobileMenu kind="visitor" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(within(screen.getByRole('dialog')).getByText('Your first video is free.')).toBeInTheDocument();
  });
  it('the visitor menu has no first-video-free line while the offer is off', async () => {
    renderWithI18n(<MobileMenu kind="visitor" freeOffer={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText('Your first video is free.')).toBeNull();
    expect(within(dialog).getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/signup');
  });
  it('closes on Escape and returns focus to the button', async () => {
    renderWithI18n(<MobileMenu kind="visitor" />);
    const opener = screen.getByRole('button', { name: 'Open menu' });
    await userEvent.click(opener);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
  it('closes on the close button and on a link click', async () => {
    renderWithI18n(<MobileMenu kind="visitor" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Pricing' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('closes when the path changes', async () => {
    const ui = <MobileMenu kind="visitor" />;
    const { rerender } = renderWithI18n(ui);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    nav.path = '/login';
    await act(async () => {
      rerender(<I18nProvider locale="en" messages={loadMessages('en')}>{ui}</I18nProvider>);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    nav.path = '/gallery';
  });
  it('shows the admin sections and View site for admins', async () => {
    renderWithI18n(<MobileMenu kind="admin" current="jobs" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Admin menu' });
    expect(within(dialog).getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page');
    expect(within(dialog).getByRole('link', { name: 'View site' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Photo review' })).toHaveAttribute('href', '/admin/jobs/review');
  });

  it('in invite mode the visitor menu asks for an invite at /contact instead of "Get started", keeps Log in, and does not promise the free video', async () => {
    renderWithI18n(<MobileMenu kind="visitor" invite />);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('link', { name: 'Get started' })).toBeNull();
    expect(within(dialog).getByRole('link', { name: 'Request an invite' })).toHaveAttribute('href', '/contact');
    expect(within(dialog).getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(within(dialog).queryByText('Your first video is free.')).toBeNull();
  });
});
