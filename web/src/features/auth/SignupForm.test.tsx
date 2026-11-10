import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';

vi.mock('./actions', () => ({
  signUp: vi.fn(async () => ({ fieldErrors: { password: 'password-short' }, email: 'a@b.co' })),
  logIn: vi.fn(),
  logInWithGoogle: vi.fn(),
}));

import { AuthForm } from './AuthForm';
import { signUp } from './actions';

afterEach(cleanup);

describe('AuthForm (sign up)', () => {
  it('shows the server field error with the minimum length number', async () => {
    renderWithI18n(<AuthForm mode="signup" next="" google freeOffer />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    await waitFor(() => expect(screen.getByText('Use at least 8 characters.')).toBeTruthy());
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBe('true');
  });
  it('the tab switch is two links', () => {
    renderWithI18n(<AuthForm google mode="login" next="/jobs/1" />);
    expect(screen.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe('/signup?next=%2Fjobs%2F1');
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('aria-current')).toBe('page');
  });
  it('the sign-up lead is not shown while the offer is off', () => {
    const { unmount } = renderWithI18n(<AuthForm mode="signup" next="" google freeOffer />);
    expect(screen.getByText(/Your first video is free/)).toBeTruthy();
    unmount();
    renderWithI18n(<AuthForm mode="signup" next="" google />);
    expect(screen.queryByText(/Your first video is free/)).toBeNull();
  });
  it('no Google button and no divider when Google sign-in is unavailable', () => {
    const { container, unmount } = renderWithI18n(<AuthForm mode="login" next="" google />);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('or with email');
    unmount();
    const { container: bare } = renderWithI18n(<AuthForm mode="login" next="" google={false} />);
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
    expect(bare.textContent).not.toMatch(/or with email/);
  });
  it('in invite mode the sign-up form says so before anything is typed, with the way to write to us; the log-in form and an open site do not', () => {
    const { unmount } = renderWithI18n(<AuthForm mode="signup" next="" google={false} inviteOnly />);
    expect(screen.getByText(/Sign-up is by invitation only for now\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'write to us' }).getAttribute('href')).toBe('/contact');
    unmount();
    renderWithI18n(<AuthForm mode="login" next="" google={false} inviteOnly />);
    expect(screen.queryByText(/by invitation/)).toBeNull();
    cleanup();
    renderWithI18n(<AuthForm mode="signup" next="" google={false} />);
    expect(screen.queryByText(/by invitation/)).toBeNull();
  });
  it('an address that was not invited gets the same message as the answer of the form, announced, and keeps what was typed', async () => {
    vi.mocked(signUp).mockResolvedValueOnce({ form: 'invite-only', email: 'stranger@example.com' });
    renderWithI18n(<AuthForm mode="signup" next="" google={false} inviteOnly />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'stranger@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sign-up is by invitation only for now. If you would like to leave your address, write to us.');
    expect(alert.querySelector('a')?.getAttribute('href')).toBe('/contact');
    expect(screen.getByLabelText('Email')).toHaveValue('stranger@example.com');
  });
  it('the invitation message in Turkish', () => {
    renderWithI18n(<AuthForm mode="signup" next="" google={false} inviteOnly />, 'tr');
    expect(screen.getByText(/Şimdilik yalnız davetle üye olunuyor\./)).toHaveTextContent('Şimdilik yalnız davetle üye olunuyor. Adresini bırakmak istersen bize yaz.');
    expect(screen.getByRole('link', { name: 'bize yaz' }).getAttribute('href')).toBe('/contact');
  });
  it('sent here by a verification link, the log-in form says to log in first and where to go without the password, in English and Turkish', () => {
    const { unmount } = renderWithI18n(<AuthForm mode="login" next="/verify-email/confirm?token=abc" google={false} verifyLogin />);
    expect(screen.getByRole('status')).toHaveTextContent('Log in first to confirm your email. If you do not know your password, use “Forgot password”.');
    unmount();
    renderWithI18n(<AuthForm mode="login" next="/verify-email/confirm?token=abc" google={false} verifyLogin />, 'tr');
    expect(screen.getByRole('status')).toHaveTextContent('E-postanı doğrulamak için önce giriş yap. Şifreni bilmiyorsan “Şifremi unuttum”u kullan.');
    cleanup();
    renderWithI18n(<AuthForm mode="login" next="" google={false} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('in invite mode the invitation note is a visible status above the form, before the fields', () => {
    const { container } = renderWithI18n(<AuthForm mode="signup" next="" google={false} inviteOnly />);
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('Sign-up is by invitation only for now.');
    const form = container.querySelector('form')!;
    expect(note.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.className).toContain('text-15');
  });
});
