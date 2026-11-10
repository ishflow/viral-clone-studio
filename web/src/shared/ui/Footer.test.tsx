import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Footer } from './Footer';
import { renderWithI18n } from './test-utils';

const clearCookieConsent = vi.hoisted(() => vi.fn());
vi.mock('@/core/consent/actions', () => ({ clearCookieConsent }));

afterEach(() => {
  cleanup();
  clearCookieConsent.mockClear();
});

describe('Footer', () => {
  it('has the company line and the three legal links', () => {
    renderWithI18n(<Footer />);
    expect(screen.getByText('© ishflow')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Footer menu' });
    expect(nav.querySelectorAll('a')).toHaveLength(8);
    expect(screen.getByRole('link', { name: 'Terms of use' })).toHaveAttribute('href', '/legal/terms');
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/legal/privacy');
    expect(screen.getByRole('link', { name: 'Refunds' })).toHaveAttribute('href', '/legal/refunds');
    expect(screen.getByRole('link', { name: 'Gallery' })).toHaveAttribute('href', '/gallery');
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing');
    expect(screen.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact');
    expect(screen.getByRole('link', { name: 'Cookies' })).toHaveAttribute('href', '/legal/cookies');
    expect(screen.getByRole('link', { name: 'Content policy' })).toHaveAttribute('href', '/legal/content');
    expect([...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/gallery', '/pricing', '/legal/terms', '/legal/privacy', '/legal/refunds', '/legal/cookies', '/legal/content', '/contact']);
  });
  it('the footer has a Cookies link and a Cookie settings button', async () => {
    renderWithI18n(<Footer />);
    expect(screen.getByRole('link', { name: 'Cookies' })).toHaveAttribute('href', '/legal/cookies');
    await userEvent.click(screen.getByRole('button', { name: 'Cookie settings' }));
    expect(clearCookieConsent).toHaveBeenCalledTimes(1);
  });
  it('speaks Turkish in tr', () => {
    renderWithI18n(<Footer />, 'tr');
    expect(screen.getByRole('link', { name: 'Çerezler' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'İçerik politikası' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Çerez tercihleri' })).toBeInTheDocument();
  });
});
