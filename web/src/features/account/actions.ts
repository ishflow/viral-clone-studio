'use server';

import { redirect } from 'next/navigation';
import { setLocale } from '@/core/i18n/actions';
import { refreshShell } from '@/core/session/refresh';
import { requireUser } from '@/core/session/guards';
import { endSession } from '@/core/session/session';
import { setTheme } from '@/core/theme/actions';
import { data } from '@/data';
import { attemptAllowed } from '@/core/rate-limit/attempts';
import { DELETE_WORD, emailLengthOk, parseProfile, type ProfileErrorCode } from './schema';

export type ProfileState = {
  status: 'idle' | 'saved' | 'error';
  errors: Partial<Record<'name' | 'email', ProfileErrorCode>> & { form?: ProfileErrorCode | 'emailWait'; password?: 'passwordRequired' | 'passwordWrong' };
};

/**
 * A new email address is the way into the account, so it needs the current password: an open session alone must not move the account
 * to another address. The address the account has, or the one that already waits for its link, changes nothing and needs none.
 * A Google account has no password to ask for.
 * Every new address sends an email, and the password can be guessed here: both stop at the limit of "send again" (`emailWait`).
 */
export async function saveProfile(_previous: ProfileState, form: FormData): Promise<ProfileState> {
  const user = await requireUser();
  const parsed = parseProfile(form);
  if (!parsed.ok) return { status: 'error', errors: parsed.errors };
  const { name, email, locale, theme } = parsed.value;
  if (![user.email, user.pendingEmail].includes(email.toLowerCase())) {
    if (!emailLengthOk(email)) return { status: 'error', errors: { email: 'emailInvalid' } };
    const password = String(form.get('password') ?? '');
    const asked = user.authProvider === 'password';
    if (asked && !password) return { status: 'error', errors: { password: 'passwordRequired' } };
    if (!(await attemptAllowed('resend', user.email))) return { status: 'error', errors: { form: 'emailWait' } };
    if (asked && !(await data.auth.checkPassword(user.id, password))) return { status: 'error', errors: { password: 'passwordWrong' } };
  }
  try {
    await data.auth.updateProfile(user.id, { name, email, locale });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'email-change-wait') return { status: 'error', errors: { form: 'emailWait' } };
    return { status: 'error', errors: code === 'email-taken' ? { email: 'emailTaken' } : { form: 'failed' } };
  }
  // The cookies are the source of the site's language and theme; the language is kept on the user too (emails, a later device).
  await setLocale(locale);
  await setTheme(theme);
  refreshShell();
  return { status: 'saved', errors: {} };
}

export type RefundState = { status: 'idle' | 'requested' | 'cancelled' | 'error'; credits?: number };

/** "Request refund" in its confirmation window: asks for the refund of one pack of the signed-in user. The data layer decides if it is eligible. */
export async function requestRefund(_previous: RefundState, form: FormData): Promise<RefundState> {
  const user = await requireUser();
  const id = String(form.get('purchaseId') ?? '');
  try {
    const purchase = await data.payments.requestRefund(user.id, id);
    refreshShell();
    return { status: 'requested', credits: purchase.credits };
  } catch {
    return { status: 'error' };
  }
}

/** "Cancel request": the customer takes the request back; the held credits are free again. */
export async function cancelRefund(_previous: RefundState, form: FormData): Promise<RefundState> {
  const user = await requireUser();
  const id = String(form.get('purchaseId') ?? '');
  try {
    const purchase = await data.payments.cancelRefund(user.id, id);
    refreshShell();
    return { status: 'cancelled', credits: purchase.credits };
  } catch {
    return { status: 'error' };
  }
}

/**
 * "Change password" for a password account: the reset link goes to the signed-in address and the page that waits for it opens.
 * A Google account has no password: nothing is sent. The limiter of the reset form applies here too.
 */
export async function startPasswordChange(): Promise<void> {
  const user = await requireUser();
  if (user.authProvider === 'google') return;
  if (await attemptAllowed('reset', user.email)) await data.auth.requestPasswordReset(user.email);
  redirect(`/forgot-password/sent?email=${encodeURIComponent(user.email)}`);
}

export type DeleteState = { status: 'idle' | 'running' | 'failed' };

/**
 * Deletes the signed-in account when the confirmation is exactly DELETE; anything else changes nothing. A job that is queued or running
 * stops it (the data layer says `job-running`): the page disables the button, and this refuses on the server too.
 */
export async function deleteAccount(_previous: DeleteState, form: FormData): Promise<DeleteState> {
  const user = await requireUser();
  if (form.get('confirm') !== DELETE_WORD) return { status: 'idle' };
  try {
    await data.auth.deleteAccount(user.id);
  } catch (error) {
    return { status: error instanceof Error && error.message === 'job-running' ? 'running' : 'failed' };
  }
  await endSession();
  refreshShell();
  redirect('/login?reason=account-deleted');
}
