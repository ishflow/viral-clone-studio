import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { data } from '@/data';
import { getStore, resetStore } from '@/data/mock/store';
import { limiter } from '@/core/rate-limit/rate-limit';
import { ResetForm } from './ResetForm';
import { resetPassword } from './actions';

const submitted = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, delete: vi.fn() }), headers: async () => new Headers() }));
vi.mock('./actions', async (original) => {
  const actual = await original<typeof import('./actions')>();
  return { ...actual, resetPassword: async (prev: null, form: FormData) => { submitted(form); try { return await actual.resetPassword(prev, form); } catch (error) { if (error instanceof Error && error.message.startsWith('REDIRECT:')) return null; throw error; } } };
});
beforeEach(() => { resetStore(); limiter.reset(); submitted.mockClear(); });
afterEach(cleanup);

it('the form sends its link token to the action which invokes only the token-based reset', async () => {
  const withLink = vi.spyOn(data.auth, 'resetPasswordWithLink').mockResolvedValue({ ok: false, reason: 'invalid' });
  const withoutLink = vi.spyOn(data.auth, 'resetPassword');
  // Avoid a React error boundary for this invalid link; verify the rendered hidden field and action separately.
  renderWithI18n(<ResetForm token="bad-link" />);
  expect(document.querySelector('input[name="token"]')).toHaveValue('bad-link');
  await userEvent.type(screen.getByLabelText('New password'), 'new-password');
  const form = new FormData();
  form.set('token', 'bad-link'); form.set('password', 'new-password'); form.set('repeat', 'new-password');
  await userEvent.type(screen.getByLabelText('Repeat new password'), 'new-password');
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
  expect(submitted).toHaveBeenCalled();
  await resetPassword(null, form);
  expect(withLink).toHaveBeenCalledWith('bad-link', 'new-password');
  expect(withoutLink).not.toHaveBeenCalled();
  withLink.mockRestore(); withoutLink.mockRestore();
});

it('a reset changes credentials once, rejects expired/unknown links and consumes other outstanding links', async () => {
  const user = await data.auth.signUp('reset-flow@example.com', 'old-password');
  await data.auth.requestPasswordReset(user.email);
  const record = getStore().tokens.find((entry) => entry.purpose === 'reset')!;
  expect(await data.auth.resetPasswordWithLink('unknown', 'new-password')).toMatchObject({ ok: false });
  record.expiresAt = new Date(0).toISOString();
  expect(await data.auth.resetPasswordWithLink(record.token, 'new-password')).toMatchObject({ reason: 'expired' });
  record.expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const outcomes = await Promise.all([data.auth.resetPasswordWithLink(record.token, 'new-password'), data.auth.resetPasswordWithLink(record.token, 'other-password')]);
  expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
  expect(await data.auth.logIn(user.email, 'old-password')).toMatchObject({ ok: false, reason: 'invalid' });
  expect(await data.auth.logIn(user.email, 'new-password')).toMatchObject({ ok: true });
  expect(await data.auth.checkResetLink(record.token)).toMatchObject({ ok: false, reason: 'used' });
  expect((await data.auth.getUser(user.id))?.sessionVersion).toBe(1);
});
