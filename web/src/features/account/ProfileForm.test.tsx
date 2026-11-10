import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/core/i18n/I18nProvider';
import { loadMessages } from '@/core/i18n/messages';
import { readDraft, writeDraft } from '@/shared/lib/session-draft';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { AccountView } from './AccountView';
import { ProfileForm } from './ProfileForm';

const saveProfile = vi.fn();
vi.mock('./actions', () => ({ saveProfile: (...a: unknown[]) => saveProfile(...a), deleteAccount: vi.fn(), startPasswordChange: vi.fn(), requestRefund: vi.fn(), cancelRefund: vi.fn() }));
vi.mock('@/core/session/actions', () => ({ logOut: vi.fn() }));
afterEach(() => {
  cleanup();
  saveProfile.mockReset();
  window.sessionStorage.clear();
});

const turkish = (ui: React.ReactElement) => (
  <I18nProvider locale="tr" messages={loadMessages('tr')}>
    {ui}
  </I18nProvider>
);

describe('ProfileForm', () => {
  it('keeps the chosen language and appearance in the selects after Save, so a second Save sends them again', async () => {
    saveProfile.mockResolvedValue({ status: 'saved', errors: {} });
    renderWithI18n(<ProfileForm name="Demo User" email="demo@viralclone.app" pendingEmail={null} authProvider="password" locale="en" theme="system" />);
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'tr');
    await userEvent.selectOptions(screen.getByLabelText('Appearance'), 'light');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(screen.getByLabelText('Language')).toHaveValue('tr');
    expect(screen.getByLabelText('Appearance')).toHaveValue('light');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveProfile).toHaveBeenCalledTimes(2);
    const second = saveProfile.mock.calls[1]![1] as FormData;
    expect(second.get('locale')).toBe('tr');
    expect(second.get('theme')).toBe('light');
    expect(second.get('name')).toBe('Demo User');
  });

  it('the site language was changed elsewhere (the header menu): the select follows, so Save does not put the old language back', async () => {
    saveProfile.mockResolvedValue({ status: 'saved', errors: {} });
    const { rerender } = renderWithI18n(<ProfileForm name="Demo User" email="demo@viralclone.app" pendingEmail={null} authProvider="password" locale="en" theme="system" />);
    expect(screen.getByLabelText('Language')).toHaveValue('en');
    rerender(turkish(<ProfileForm name="Demo User" email="demo@viralclone.app" pendingEmail={null} authProvider="password" locale="tr" theme="light" />));
    expect(screen.getByLabelText('Dil')).toHaveValue('tr');
    expect(screen.getByLabelText('Görünüm')).toHaveValue('light');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect((saveProfile.mock.calls[0]![1] as FormData).get('locale')).toBe('tr');
    expect((saveProfile.mock.calls[0]![1] as FormData).get('theme')).toBe('light');
  });

  it('a name and an email typed but not saved yet stay when the site language or theme changes elsewhere', async () => {
    saveProfile.mockResolvedValue({ status: 'saved', errors: {} });
    const { rerender } = renderWithI18n(<ProfileForm name="Demo User" email="demo@viralclone.app" pendingEmail={null} authProvider="password" locale="en" theme="system" />);
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'New Name');
    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'new@viralclone.app');
    rerender(turkish(<ProfileForm name="Demo User" email="demo@viralclone.app" pendingEmail={null} authProvider="password" locale="tr" theme="light" />));
    expect(screen.getByLabelText('Ad')).toHaveValue('New Name');
    expect(screen.getByLabelText('E-posta')).toHaveValue('new@viralclone.app');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    const sent = saveProfile.mock.calls[0]![1] as FormData;
    expect(sent.get('name')).toBe('New Name');
    expect(sent.get('email')).toBe('new@viralclone.app');
    expect(sent.get('locale')).toBe('tr');
    expect(sent.get('theme')).toBe('light');
  });

  it('asks for the current password only once the email is another one, sends it, and says when it was wrong (SEC B3)', async () => {
    saveProfile.mockResolvedValue({ status: 'error', errors: { password: 'passwordWrong' } });
    renderWithI18n(<ProfileForm name="Demo User" email="demo@viralclone.app" pendingEmail="waiting@example.com" authProvider="password" locale="en" theme="system" />);
    expect(screen.queryByLabelText('Current password')).toBeNull();
    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'Waiting@example.com');
    expect(screen.queryByLabelText('Current password')).toBeNull(); // the address that already waits for its link
    await userEvent.type(screen.getByLabelText('Email'), '.tr');
    await userEvent.type(screen.getByLabelText('Current password'), 'my-password');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((saveProfile.mock.calls[0]![1] as FormData).get('password')).toBe('my-password');
    expect(await screen.findByText('This is not your current password.')).toBeInTheDocument();
  });

  it('a Google account is never asked for a password, and Turkish has the field too', async () => {
    renderWithI18n(<ProfileForm name="Demo User" email="demo@viralclone.app" pendingEmail={null} authProvider="google" locale="en" theme="system" />);
    await userEvent.type(screen.getByLabelText('Email'), '.tr');
    expect(screen.queryByLabelText('Current password')).toBeNull();
    cleanup();
    renderWithI18n(<ProfileForm name="Demo User" email="demo@viralclone.app" pendingEmail={null} authProvider="password" locale="tr" theme="system" />, 'tr');
    await userEvent.type(screen.getByLabelText('E-posta'), '.tr');
    expect(screen.getByLabelText('Mevcut şifre')).toBeInTheDocument();
  });

  it('"Saved." stays on screen when the saved language comes back from the server', async () => {
    saveProfile.mockResolvedValue({ status: 'saved', errors: {} });
    const { rerender } = renderWithI18n(<ProfileForm name="Demo User" email="demo@viralclone.app" pendingEmail={null} authProvider="password" locale="en" theme="system" />);
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'tr');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    rerender(turkish(<ProfileForm name="Demo User" email="demo@viralclone.app" pendingEmail={null} authProvider="password" locale="tr" theme="system" />));
    expect(screen.getByText('Kaydedildi.')).toBeInTheDocument();
    expect(screen.getByLabelText('Dil')).toHaveValue('tr');
  });
});

describe('AccountView', () => {
  const account = { name: 'Demo User', email: 'demo@viralclone.app', theme: 'dark' as const, balance: 12, entries: [], packNames: [], purchases: [], held: 0, authProvider: 'password' as const, pendingEmail: null, jobRunning: false };

  it('Log out clears the forms this tab kept', async () => {
    writeDraft('vc:draft:add-video:usr-demo', { link: 'https://example.com/v' });
    renderWithI18n(<AccountView account={account} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Log out' })[0]!);
    expect(readDraft('vc:draft:add-video:usr-demo')).toBeNull();
  });

  it('the profile form shows the language the site is in (the cookie), whatever is stored on the user', () => {
    renderWithI18n(<AccountView account={account} />, 'tr');
    expect(screen.getByLabelText('Dil')).toHaveValue('tr');
    expect(screen.getByLabelText('Görünüm')).toHaveValue('dark');
  });
});
