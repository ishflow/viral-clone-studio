'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { PASSWORD_MIN_LENGTH } from '@/core/config';
import { refreshShell } from '@/core/session/refresh';
import { endSession, getSessionUser, isVerifyLink, safeNext, startSession } from '@/core/session/session';
import { data } from '@/data';
import { RULES } from '@/data/ports';
import { demoAidsAllowed } from '@/core/paid-mode';
import { invited } from '@/core/invite';
import { attemptAllowed, clientKey } from '@/core/rate-limit/attempts';
import type { AuthState, FieldCode, FieldName } from './types';

const emailSchema = z.string().trim().pipe(z.email());
/** A new address is at most 254 characters and its part before the `@` at most 64 (RFC 5321). Only sign-up asks: an account made before the limit still logs in and resets. */
const newEmailSchema = z.string().trim().max(254).refine((value) => value.lastIndexOf('@') <= 64).pipe(z.email());
const text = (form: FormData, key: string): string => {
  const v = form.get(key);
  return typeof v === 'string' ? v : '';
};
const fail = (field: FieldName, code: FieldCode, email?: string): AuthState => ({ fieldErrors: { [field]: code }, email });
const emailOk = (value: string) => emailSchema.safeParse(value).success;
const newEmailOk = (value: string) => newEmailSchema.safeParse(value).success;
const passwordOk = (value: string) => value.length >= PASSWORD_MIN_LENGTH;

/**
 * Sign up with email + password, then wait for the email link. Both fields are checked together.
 * In invite mode an address outside the guest list opens no account. It is asked before the data layer is, so for such an address
 * the answer is the same whether it has an account or not.
 * The list itself can be tried: an address on it answers differently (its account opens, or "email-taken"). The limits only bound
 * that (each caller's own, and the ceiling of all callers together in `rate-limit/attempts.ts`); they do not hide it. So whoever
 * guesses a guest's address can sign it up first. That account is never verified without the guest's mailbox, so no money is reached,
 * but the guest gets mail they did not ask for and has to use "Forgot password". A remaining risk, accepted.
 */
export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = text(form, 'email').trim();
  const password = text(form, 'password');
  const fieldErrors: NonNullable<AuthState>['fieldErrors'] = {};
  if (!newEmailOk(email)) fieldErrors.email = 'invalid-email';
  if (!passwordOk(password)) fieldErrors.password = 'password-short';
  if (fieldErrors.email || fieldErrors.password) return { fieldErrors, email };
  if (!(await attemptAllowed('signUp', email))) return { form: 'rate-limited', email };
  if (!invited(email)) return { form: 'invite-only', email };
  let userId: string;
  try {
    userId = (await data.auth.signUp(email, password)).id;
  } catch (error) {
    if (error instanceof Error && error.message === 'email-taken') return fail('email', 'email-taken', email);
    throw error;
  }
  await startSession(userId);
  refreshShell();
  redirect('/verify-email');
}

/**
 * One form-level error for a wrong or unknown login: the page never says which. Too many tries (`RULES.loginAttempts` in
 * `RULES.loginLockMinutes`) locks the address. A blocked account goes to /blocked (the data layer answers it only for the right password).
 * Over `LIMITS.logIn` (per caller and per address) nothing reaches `data.auth`.
 * An account whose email is not verified goes to /verify-email, whatever `next` says; unless `next` is its verification link, which is completed now that the session is its own.
 * Behind a trusted proxy the lock is the caller's own: the wrong guesses of a stranger do not lock the owner of the address out.
 */
export async function logIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = text(form, 'email').trim();
  const password = text(form, 'password');
  if (!emailOk(email)) return fail('email', 'invalid-email', email);
  if (!password) return fail('password', 'required', email);
  if (!(await attemptAllowed('logIn', email))) return { form: 'rate-limited', email };
  const caller = await clientKey();
  const result = await data.auth.logIn(email, password, caller.shared ? undefined : caller.key);
  if (!result.ok) {
    if (result.reason === 'blocked') redirect('/blocked');
    if (result.reason === 'too-many') return { form: 'locked', email, retryAfter: result.retryAfter ?? undefined };
    return { form: 'credentials', email };
  }
  await startSession(result.user.id);
  refreshShell();
  const next = safeNext(text(form, 'next') || undefined);
  if (!result.user.emailVerified) redirect(isVerifyLink(next) ? next : '/verify-email');
  redirect(next);
}

const DEMO_USER_ID = 'usr-demo';

/**
 * "Continue with Google". This is the demo stand-in for OAuth: it signs in the fixture customer `usr-demo`
 * and talks to no provider. A real OAuth callback replaces this body. In paid mode it refuses.
 * The provider's own answers "cancelled" and "failed" arrive as `result` (a callback would carry them); the demo form never sends one.
 * The demo account can be gone (someone tried "Delete account" as the demo user) or blocked by the admin: the form says so
 * instead of starting a session nobody can use.
 */
export async function logInWithGoogle(_prev: AuthState, form: FormData): Promise<AuthState> {
  if (!demoAidsAllowed()) return { form: 'unavailable' };
  const result = text(form, 'result');
  if (result === 'cancelled') return { form: 'google-cancelled' };
  if (result === 'failed') return { form: 'google-failed' };
  const demo = await data.auth.getUser(DEMO_USER_ID);
  if (!demo) return { form: 'demo-deleted' };
  if (demo.blocked) redirect('/blocked');
  await startSession(demo.id);
  refreshShell();
  redirect(safeNext(text(form, 'next') || undefined));
}

/**
 * "Change it" on the verify page. The sign-up page sends a signed-in visitor to the gallery, so the session ends first.
 * The account that waits for its verification stays as it is.
 */
export async function signUpWithAnotherEmail(): Promise<void> {
  await endSession();
  refreshShell();
  redirect('/signup');
}

/** Demo aid: the fake "I opened the link in the email" step. Refuses in paid mode: only the emailed link verifies an address. */
export async function confirmEmail(): Promise<AuthState> {
  if (!demoAidsAllowed()) return { form: 'unavailable' };
  const user = await getSessionUser();
  if (!user) redirect('/login');
  await data.auth.verifyEmail(user.id);
  refreshShell();
  redirect('/welcome');
}

/** "Send again": at most one link per `RULES.resendSeconds` (the data layer's rule); `retryAfter` is the wait that is left. */
export async function resendVerification(): Promise<AuthState> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!(await attemptAllowed('resend', user.email))) return { form: 'rate-limited' };
  const answer = await data.auth.resendVerification(user.id);
  return { sent: answer.sent, retryAfter: answer.retryAfter };
}

/** The answer is the same for an unknown address. */
export async function requestReset(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = text(form, 'email').trim();
  if (!emailOk(email)) return fail('email', 'invalid-email', email);
  // Over the limit: the same generic state for every address; nothing says whether the email exists.
  if (!(await attemptAllowed('reset', email))) return { form: 'rate-limited', email };
  await data.auth.requestPasswordReset(email);
  redirect(`/forgot-password/sent?email=${encodeURIComponent(email)}`);
}

export async function resendReset(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = text(form, 'email').trim();
  if (!emailOk(email)) return { sent: true, email, retryAfter: RULES.resendSeconds };
  if (!(await attemptAllowed('reset', email))) return { form: 'rate-limited', email };
  const answer = await data.auth.requestPasswordReset(email);
  return { sent: answer.sent, email, retryAfter: answer.retryAfter };
}

/**
 * The new password, through the single-use link of the reset email (`token`). A link that no longer works goes to the page that says so.
 * The data layer updates the hash and revokes all earlier sessions; this browser signs in again.
 */
export async function resetPassword(_prev: AuthState, form: FormData): Promise<AuthState> {
  const token = text(form, 'token');
  const password = text(form, 'password');
  const repeat = text(form, 'repeat');
  if (!passwordOk(password)) return fail('password', 'password-short');
  if (password !== repeat) return fail('repeat', 'mismatch');
  if (!(await attemptAllowed('setPassword', token))) return { form: 'rate-limited' };
  const result = await data.auth.resetPasswordWithLink(token, password);
  if (!result.ok) redirect('/reset-password/invalid');
  await endSession();
  refreshShell();
  redirect('/login?reason=password-reset');
}
