import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeaderCustomer } from './HeaderCustomer';
import { currentFromPath } from './nav';
import { renderWithI18n } from './test-utils';

vi.mock('@/core/session/actions', () => ({ logOut: vi.fn() }));
vi.mock('@/core/i18n/actions', () => ({ setLocale: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/swap/tpl-swap' }));

afterEach(cleanup);

const desktop = () => screen.getByRole('navigation', { name: 'Main menu' });
const openPhoneMenu = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  return screen.getByRole('dialog', { name: 'Main menu' });
};

describe('the link to person swap in the customer menu', () => {
  it('is in neither menu while person swap is closed (the default)', async () => {
    renderWithI18n(<HeaderCustomer balanceLabel="12 credits" />);
    expect(within(desktop()).queryByRole('link', { name: 'Person swap' })).toBeNull();
    expect(within(await openPhoneMenu()).queryByRole('link', { name: 'Person swap' })).toBeNull();
    expect(screen.queryByText('Person swap')).toBeNull();
  });

  it('is in both menus, after the gallery, while person swap is open, and marked on its pages', async () => {
    renderWithI18n(<HeaderCustomer balanceLabel="12 credits" swap />);
    const links = within(desktop()).getAllByRole('link').map((link) => link.textContent);
    expect(links.slice(0, 3)).toEqual(['Gallery', 'Person swap', 'My videos']);
    const link = within(desktop()).getByRole('link', { name: 'Person swap' });
    expect(link).toHaveAttribute('href', '/swap');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(within(await openPhoneMenu()).getByRole('link', { name: 'Person swap' })).toHaveAttribute('href', '/swap');
  });

  it('is written in Turkish for a Turkish customer', () => {
    renderWithI18n(<HeaderCustomer balanceLabel="12 kredi" swap />, 'tr');
    expect(screen.getByRole('link', { name: 'Kişi değiştir' })).toHaveAttribute('href', '/swap');
  });

  it('belongs to its own pages, not to the gallery or the videos', () => {
    expect(currentFromPath('customer', '/swap')).toBe('swap');
    expect(currentFromPath('customer', '/swap/tpl-swap')).toBe('swap');
    expect(currentFromPath('customer', '/gallery')).toBe('gallery');
  });
});
