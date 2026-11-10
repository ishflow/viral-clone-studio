'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { PASSWORD_MIN_LENGTH } from '@/core/config';
import { useT } from '@/core/i18n/I18nProvider';
import { RULES } from '@/data/ports';
import { Button, Field, Input, LinkButton } from '@/shared/ui';
import { Notice } from '@/shared/ui/Notice';
import { logIn, logInWithGoogle, signUp } from './actions';
import { errorText } from './parts';
import type { AuthState } from './types';

const FORM_TEXT: Record<NonNullable<NonNullable<AuthState>['form']>, string> = {
  credentials: 'auth.error.credentials',
  'demo-deleted': 'auth.error.demoDeleted',
  'rate-limited': 'auth.error.rateLimited',
  unavailable: 'auth.error.unavailable',
  locked: 'auth.error.locked',
  'google-cancelled': 'auth.error.googleCancelled',
  'google-failed': 'auth.error.googleFailed',
  'invite-only': 'auth.signup.invite.text',
};
const GOOGLE_TEXT = FORM_TEXT;

const nextQuery = (next: string) => (next ? `?next=${encodeURIComponent(next)}` : '');

function Tab({ href, current, children }: { href: string; current: boolean; children: string }) {
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={`flex min-h-11 flex-1 items-center justify-center rounded-full text-15 font-semibold no-underline ${current ? 'bg-raised text-text' : 'text-text-3 hover:text-text'}`}
    >
      {children}
    </Link>
  );
}

/** A-Giris: one screen, two tabs. Each tab is a route (`/login`, `/signup`). */
/**
 * `google`: is "Continue with Google" available (`demoAidsAllowed()`; the action refuses it otherwise, so the button is not drawn).
 * `freeOffer`: may the sign-up lead say the first video is free (`freeOffer()` in core; the page decides).
 * `verifyLogin`: a verification link sent the visitor here: it is completed after the log-in (`next` carries it).
 * `inviteOnly`: sign-up is open to invited addresses only (`inviteOnly()` in core): the form says so, and how to write to us. No address is collected here.
 */
export function AuthForm({ mode, next, google: googleAvailable, freeOffer = false, inviteOnly = false, expired = false, passwordReset = false, emailChanged = false, accountDeleted = false, verifyLogin = false }: { mode: 'login' | 'signup'; next: string; google: boolean; freeOffer?: boolean; inviteOnly?: boolean; expired?: boolean; passwordReset?: boolean; emailChanged?: boolean; accountDeleted?: boolean; verifyLogin?: boolean }) {
  const t = useT();
  const signup = mode === 'signup';
  const [state, action, pending] = useActionState<AuthState, FormData>(signup ? signUp : logIn, null);
  const [google, googleAction, googlePending] = useActionState<AuthState, FormData>(logInWithGoogle, null);
  const fields = state?.fieldErrors;
  const refused = state?.form === 'invite-only';
  const inviteNote = (
    <>
      {t('auth.signup.invite.text')} {t('auth.signup.invite.before')} <Link href="/contact">{t('auth.signup.invite.link')}</Link>
      {t('auth.signup.invite.after')}
    </>
  );

  return (
    <>
      <div role="group" aria-label={t('auth.tabs.label')} className="flex rounded-full border border-edge bg-surface p-1">
        <Tab href={`/login${nextQuery(next)}`} current={!signup}>
          {t('auth.tabs.login')}
        </Tab>
        <Tab href={`/signup${nextQuery(next)}`} current={signup}>
          {t('auth.tabs.signup')}
        </Tab>
      </div>

      <h1 className="m-0 font-display text-32 leading-none font-extrabold tracking-[-0.03em]">
        {t(signup ? 'auth.signup.title' : expired ? 'auth.login.expiredTitle' : 'auth.login.title')}
      </h1>
      {signup && inviteOnly && !refused && <Notice tone="info" icon="info" className="text-15 leading-normal font-medium">{inviteNote}</Notice>}
      {signup && freeOffer && <p className="m-0 text-15 leading-normal text-text-2">{t('auth.signup.lead')}</p>}
      {!signup && passwordReset && <p role="status" className="m-0 text-15 leading-normal text-accent-text">{t('auth.login.passwordReset')}</p>}
      {!signup && emailChanged && <p role="status" className="m-0 text-15 leading-normal text-accent-text">{t('auth.login.emailChanged')}</p>}
      {!signup && accountDeleted && <p role="status" className="m-0 text-15 leading-normal text-accent-text">{t('auth.login.accountDeleted')}</p>}
      {!signup && verifyLogin && <p role="status" className="m-0 text-15 leading-normal text-accent-text">{t('auth.login.verifyLogin')}</p>}
      {!signup && expired && <p className="m-0 text-15 leading-normal text-text-2">{t('auth.login.expiredLead')}</p>}

      {googleAvailable && (
        <>
          {/* Demo stand-in for OAuth: signs in the fixture customer. */}
          <form action={googleAction} className="flex flex-col gap-2">
            <input type="hidden" name="next" value={next} />
            <Button type="submit" variant="secondary" fullWidth pending={googlePending}>
              {t('auth.google')}
            </Button>
            {google?.form && (
              <Notice>
                {t(GOOGLE_TEXT[google.form] ?? 'auth.error.credentials')}
                {google.form === 'google-failed' && <> {t('auth.error.googleFailedHint')}</>}
              </Notice>
            )}
          </form>

          <div aria-hidden="true" className="flex items-center gap-4 text-13 leading-[1.25] text-text-3">
            <span className="h-px flex-1 bg-line" />
            {t('auth.or')}
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form action={action} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        {state?.form && (
          <Notice>
            {refused ? inviteNote : t(FORM_TEXT[state.form] ?? 'auth.error.credentials')}
            {state.form === 'locked' && <> {t('auth.error.lockedHint', { minutes: RULES.loginLockMinutes })}</>}
          </Notice>
        )}
        <Field label={t('auth.field.email')} error={errorText(t, fields?.email)} className="gap-2 [&>label]:leading-[1.25]">
          <Input type="email" name="email" autoComplete="email" placeholder={t('auth.field.emailPlaceholder')} defaultValue={state?.email} className="bg-surface" />
        </Field>
        {fields?.email === 'email-taken' && (
          <p className="m-0 -mt-2 flex flex-wrap items-center gap-x-1 text-13">
            <LinkButton href={`/login${nextQuery(next)}`} variant="quiet" className="text-13">{t('auth.error.emailTakenLogin')}</LinkButton>
            <span aria-hidden="true" className="text-text-3">·</span>
            <LinkButton href="/forgot-password" variant="quiet" className="text-13">{t('auth.error.emailTakenReset')}</LinkButton>
          </p>
        )}
        <Field label={t('auth.field.password')} hint={signup ? t('auth.signup.hint', { min: PASSWORD_MIN_LENGTH }) : undefined} error={errorText(t, fields?.password)} className="gap-2 [&>label]:leading-[1.25]">
          <Input type="password" name="password" autoComplete={signup ? 'new-password' : 'current-password'} className="bg-surface" />
        </Field>
        <Button type="submit" size="l" fullWidth pending={pending} disabled={state?.form === 'locked'}>
          {t(signup ? 'auth.signup.submit' : 'auth.login.submit')}
        </Button>
      </form>

      <div className="flex flex-col gap-2 text-13 leading-normal text-text-3">
        {signup ? (
          <p className="m-0">
            {t('auth.signup.terms.before')} <Link href="/legal/terms">{t('auth.signup.terms.terms')}</Link> {t('auth.signup.terms.and')}{' '}
            <Link href="/legal/privacy">{t('auth.signup.terms.privacy')}</Link>
            {t('auth.signup.terms.after')}
          </p>
        ) : (
          <LinkButton href="/forgot-password" variant="quiet" className="self-start">
            {t('auth.login.forgot')}
          </LinkButton>
        )}
      </div>
    </>
  );
}
