import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageMenu } from './LanguageMenu';
import { renderWithI18n } from './test-utils';

const setLocale = vi.fn();
vi.mock('@/core/i18n/actions', () => ({ setLocale: (l: string) => setLocale(l) }));

afterEach(() => {
  cleanup();
  setLocale.mockClear();
});

describe('LanguageMenu', () => {
  it('opens a radio menu with the current language checked and sets the other one', async () => {
    renderWithI18n(<LanguageMenu />);
    const trigger = screen.getByRole('button', { name: 'Language: English. Change' });
    expect(trigger).toHaveTextContent('EN');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(screen.getByRole('menuitemradio', { name: /English/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Türkçe' }));
    expect(setLocale).toHaveBeenCalledWith('tr');
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('closes on Escape and returns focus', async () => {
    renderWithI18n(<LanguageMenu />);
    const trigger = screen.getByRole('button', { name: /Language/ });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });
  it('row variant shows the language name', () => {
    renderWithI18n(<LanguageMenu variant="row" />);
    expect(screen.getByRole('button', { name: /Language/ })).toHaveTextContent('English');
  });
});
