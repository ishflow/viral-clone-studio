import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { data } from '@/data';
import { renderWithI18n } from '@/shared/ui/test-utils';
import type { AuthState } from './types';

const logIn = vi.fn();
const signUp = vi.fn();
const logInWithGoogle = vi.fn();
const resendVerification = vi.fn();
const resendReset = vi.fn();
vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt} /> }));
vi.mock('./actions', () => ({
  logIn: (...a: unknown[]) => logIn(...a),
  signUp: (...a: unknown[]) => signUp(...a),
  logInWithGoogle: (...a: unknown[]) => logInWithGoogle(...a),
  resendVerification: () => resendVerification(),
  resendReset: (...a: unknown[]) => resendReset(...a),
  requestReset: vi.fn(),
  resetPassword: vi.fn(),
  confirmEmail: vi.fn(),
  signUpWithAnotherEmail: vi.fn(),
}));

const sessionUser = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/core/session/session', () => ({ getSessionUser: async () => sessionUser.current }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import { AuthForm } from './AuthForm';
import { ResendButton } from './ResendButton';
import { VerifyEmailScreen } from './screens';
import { WelcomeView } from './WelcomeView';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const submit = async (name: string) => userEvent.click(screen.getByRole('button', { name }));

describe('AuthForm states (A-Giris-Durumlar)', () => {
  it('sign up: the password hint, and both field errors at once; an email that is taken offers Log in and Reset password', async () => {
    renderWithI18n(<AuthForm mode="signup" next="" google freeOffer />);
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();
    expect(screen.getByText('Your first video is free: one no-talking video in Fast quality. No card needed.')).toBeInTheDocument();
    signUp.mockResolvedValue({ fieldErrors: { email: 'email-taken' }, email: 'a@b.co' } satisfies AuthState);
    await submit('Sign up');
    expect(await screen.findByText('This email already has an account.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Log in' }).some((l) => l.getAttribute('href') === '/login')).toBe(true);
    expect(screen.getByRole('link', { name: 'Reset password' })).toHaveAttribute('href', '/forgot-password');
  });
  it('log in: wrong password, locked (button disabled), over the limit', async () => {
    renderWithI18n(<AuthForm google mode="login" next="" />);
    logIn.mockResolvedValueOnce({ form: 'credentials' });
    await submit('Log in');
    expect(await screen.findByText('Email or password is not correct.')).toBeInTheDocument();
    logIn.mockResolvedValueOnce({ form: 'locked', retryAfter: 900 });
    await submit('Log in');
    expect(await screen.findByText(/Too many tries\. Wait 15 minutes or reset your password\./)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Log in' }).at(-1)).toBeDisabled();
  });
  it('log in over the rate limit shows the generic "Too many attempts" message', async () => {
    renderWithI18n(<AuthForm google mode="login" next="" />);
    logIn.mockResolvedValue({ form: 'rate-limited' });
    await submit('Log in');
    expect(await screen.findByText('Too many attempts. Try again in a few minutes.')).toBeInTheDocument();
  });
  it('Google: cancelled, failed with its hint, unavailable', async () => {
    renderWithI18n(<AuthForm google mode="login" next="" />);
    logInWithGoogle.mockResolvedValueOnce({ form: 'google-cancelled' });
    await submit('Continue with Google');
    expect(await screen.findByText('Google sign-in was cancelled. Nothing changed.')).toBeInTheDocument();
    logInWithGoogle.mockResolvedValueOnce({ form: 'google-failed' });
    await submit('Continue with Google');
    expect(await screen.findByText(/Google sign-in did not work\. Try again or use your email\./)).toBeInTheDocument();
    logInWithGoogle.mockResolvedValueOnce({ form: 'unavailable' });
    await submit('Continue with Google');
    expect(await screen.findByText('This is not available right now.')).toBeInTheDocument();
  });
  it('the session-ended page: "You were logged out." above the form', () => {
    renderWithI18n(<AuthForm google mode="login" next="/jobs/1" expired />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('You were logged out.');
    expect(screen.getByText('Log in to continue where you left off.')).toBeInTheDocument();
  });
});

describe('ResendButton (60 seconds)', () => {
  it('a refused resend shows the wait and disables the button; an accepted one says "Sent again" with the 60 seconds', async () => {
    resendVerification.mockResolvedValueOnce({ sent: false, retryAfter: 42 });
    renderWithI18n(<ResendButton kind="verify" />);
    await submit('Send again');
    expect(await screen.findByRole('button', { name: 'Send again in 42 s' })).toBeDisabled();
  });
  it('sent: the confirmation names the 60 seconds', async () => {
    resendVerification.mockResolvedValueOnce({ sent: true, retryAfter: 60 });
    renderWithI18n(<ResendButton kind="verify" />);
    await submit('Send again');
    expect(await screen.findByText('Sent again. You can send another in 60 seconds.')).toBeInTheDocument();
  });
  it('Send again pressed inside the wait says that a link was just sent, for the verify mail and for the reset mail', async () => {
    resendVerification.mockResolvedValueOnce({ sent: false, retryAfter: 48 });
    const verify = renderWithI18n(<ResendButton kind="verify" />);
    await submit('Send again');
    expect(await screen.findByText('A link was sent a moment ago. You can ask for another in 48 s.')).toBeInTheDocument();
    verify.unmount();
    resendReset.mockResolvedValueOnce({ sent: false, retryAfter: 30 });
    renderWithI18n(<ResendButton kind="reset" email="a@b.co" />, 'tr');
    await submit('Bağlantıyı tekrar gönder');
    expect(await screen.findByText('Az önce bir bağlantı gönderildi. 30 sn sonra yenisini isteyebilirsin.')).toBeInTheDocument();
  });
  describe('the sentence counts down with the button', () => {
    afterEach(() => vi.useRealTimers());
    const tick = (seconds: number) => act(() => { vi.advanceTimersByTime(seconds * 1000); });

    it('"a link was sent a moment ago" shows the seconds that are left, not the ones it was asked with', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      resendVerification.mockResolvedValueOnce({ sent: false, retryAfter: 48 });
      renderWithI18n(<ResendButton kind="verify" />);
      await submit('Send again');
      expect(await screen.findByText('A link was sent a moment ago. You can ask for another in 48 s.')).toBeInTheDocument();
      tick(5);
      expect(screen.getByText('A link was sent a moment ago. You can ask for another in 43 s.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send again in 43 s' })).toBeDisabled();
    });
    it('"Sent again" counts down the same way', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      resendVerification.mockResolvedValueOnce({ sent: true, retryAfter: 60 });
      renderWithI18n(<ResendButton kind="verify" />);
      await submit('Send again');
      expect(await screen.findByText('Sent again. You can send another in 60 seconds.')).toBeInTheDocument();
      tick(10);
      expect(screen.getByText('Sent again. You can send another in 50 seconds.')).toBeInTheDocument();
    });
    it('the sentence goes away when the wait is over, and the button is open again', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      resendVerification.mockResolvedValueOnce({ sent: false, retryAfter: 3 });
      renderWithI18n(<ResendButton kind="verify" />);
      await submit('Send again');
      await screen.findByText(/A link was sent a moment ago/);
      tick(3);
      expect(screen.queryByText(/A link was sent a moment ago/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Send again' })).toBeEnabled();
    });
  });
  it('over the limiter: the generic message', async () => {
    resendVerification.mockResolvedValueOnce({ form: 'rate-limited' });
    renderWithI18n(<ResendButton kind="verify" />);
    await submit('Send again');
    expect(await screen.findByText('Too many attempts. Try again in a few minutes.')).toBeInTheDocument();
  });
});

it.each(['en', 'tr'] as const)('password-reset landing shows the login success message in %s', (locale) => {
  renderWithI18n(<AuthForm google mode="login" next="" passwordReset />, locale);
  expect(screen.getByRole('status')).toHaveTextContent(locale === 'en' ? 'Your password changed. Log in with your new password.' : 'Şifren değişti. Yeni şifrenle giriş yap.');
});

it.each(['en', 'tr'] as const)('the login page of a changed email says so in %s and does not say the session ended', (locale) => {
  renderWithI18n(<AuthForm google mode="login" next="/account" emailChanged />, locale);
  expect(screen.getByRole('status')).toHaveTextContent(locale === 'en' ? 'Your email changed. Log in with your new address.' : 'E-postan değişti. Yeni adresinle giriş yap.');
  expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent(/logged out|kapandı/);
});

it.each(['en', 'tr'] as const)('the login page after an account was deleted says so in %s', (locale) => {
  renderWithI18n(<AuthForm google mode="login" next="" accountDeleted />, locale);
  expect(screen.getByRole('status')).toHaveTextContent(locale === 'en' ? 'Your account was deleted.' : 'Hesabın silindi.');
});

describe('WelcomeView when no template is ready yet', () => {
  const card = { id: 'tpl-a', title: 'Fragrance layering recipe', image: '/samples/a.jpg', video: null, seconds: 8, meta: 'Fragrance · reference 1.9M views' };
  it('replaces the empty "Start with one of these" list with a box that says so, the price of preparing, and a link to add a video', () => {
    renderWithI18n(<WelcomeView cards={[]} freeOffer />);
    expect(screen.queryByRole('heading', { name: 'Start with one of these' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'See all templates' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'No ready templates yet.' })).toBeInTheDocument();
    expect(screen.getByText('Start with a video you like: add its link and it becomes your own template. Preparing it costs 1 credit.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add your own video' })).toHaveAttribute('href', '/templates/new');
  });
  it('keeps the list and no box while there are templates', () => {
    renderWithI18n(<WelcomeView cards={[card]} freeOffer />);
    expect(screen.getByRole('heading', { name: 'Start with one of these' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No ready templates yet.' })).toBeNull();
  });
});

describe('the verify screen', () => {
  const unverified = { id: 'usr-unverified', email: 'a-very-long-address-that-would-push-the-page-sideways@example-company-name.com', emailVerified: false, freeVideoAvailable: false };
  const offer = async (freeFirstVideo: boolean) => {
    const limits = await data.admin.limits();
    vi.spyOn(data.admin, 'limits').mockResolvedValue({ ...limits, freeFirstVideo });
  };
  afterEach(() => vi.restoreAllMocks());

  it('has a log out button, so a person with the wrong account can leave without deleting cookies', async () => {
    sessionUser.current = unverified;
    await offer(true);
    renderWithI18n(await VerifyEmailScreen());
    expect(screen.getByRole('button', { name: 'Log out' })).toHaveAttribute('type', 'submit');
  });
  it('promises the free video only while the offer is on', async () => {
    sessionUser.current = unverified;
    await offer(true);
    const { unmount } = renderWithI18n(await VerifyEmailScreen());
    expect(screen.getByText(/get your free video/)).toBeInTheDocument();
    unmount();
    await offer(false);
    renderWithI18n(await VerifyEmailScreen());
    expect(screen.queryByText(/free video/)).toBeNull();
    expect(screen.getByText(/Open it to activate your account\./)).toBeInTheDocument();
  });
  it('breaks a long address anywhere instead of pushing the page sideways', async () => {
    sessionUser.current = unverified;
    await offer(true);
    renderWithI18n(await VerifyEmailScreen());
    expect(screen.getByText(unverified.email)).toHaveClass('break-all');
  });
});
