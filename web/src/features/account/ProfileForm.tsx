'use client';

import { useActionState, useState } from 'react';
import { cx } from '@/shared/lib/cx';
import { keepControlledValues } from '@/shared/lib/form';
import { useT } from '@/core/i18n/I18nProvider';
import type { Locale } from '@/core/i18n/types';
import type { ThemeChoice } from '@/core/theme/theme';
import { Button, Card, Field, Input, Select } from '@/shared/ui';
import { saveProfile, startPasswordChange, type ProfileState } from './actions';

const IDLE: ProfileState = { status: 'idle', errors: {} };

type Text = { name: string; email: string };
type Site = { locale: Locale; theme: ThemeChoice };

/** `unchanged`: the addresses that need no password (the one of the account, the one that waits for its link); null for an account without a password. */
function TextFields({ initial, unchanged, errors }: { initial: Text; unchanged: (string | null)[] | null; errors: ProfileState['errors'] }) {
  const t = useT();
  const [values, setValues] = useState(initial);
  const set = (key: keyof Text) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const error = (field: keyof Text | 'password') => (errors[field] ? t(`account.profile.error.${errors[field]}`) : undefined);
  return (
    <>
      <Field label={t('account.profile.name')} error={error('name')}>
        <Input name="name" type="text" autoComplete="name" placeholder={t('account.profile.namePlaceholder')} value={values.name} onChange={set('name')} />
      </Field>
      <Field label={t('account.profile.email')} error={error('email')}>
        <Input name="email" type="email" autoComplete="email" placeholder={t('account.profile.emailPlaceholder')} value={values.email} onChange={set('email')} />
      </Field>
      {/* The same rule as `saveProfile`: a new address needs the current password. */}
      {unchanged && !unchanged.includes(values.email.trim().toLowerCase()) && (
        <Field label={t('account.profile.currentPassword')} hint={t('account.profile.currentPasswordHint')} error={error('password')}>
          <Input name="password" type="password" autoComplete="current-password" />
        </Field>
      )}
    </>
  );
}

function SiteFields({ initial }: { initial: Site }) {
  const t = useT();
  const [values, setValues] = useState(initial);
  const set = (key: keyof Site) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));
  return (
    <>
      <Field label={t('account.profile.language')} hint={t('account.profile.languageNote')}>
        <Select name="locale" value={values.locale} onChange={set('locale')}>
          <option value="en">{t('common.language.en')}</option>
          <option value="tr">{t('common.language.tr')}</option>
        </Select>
      </Field>
      <Field label={t('account.profile.appearance')}>
        <Select name="theme" value={values.theme} onChange={set('theme')}>
          {(['system', 'dark', 'light'] as const).map((choice) => (
            <option key={choice} value={choice}>{t(`account.profile.theme.${choice}`)}</option>
          ))}
        </Select>
      </Field>
    </>
  );
}

/**
 * `locale` and `theme` are what the site is in right now (its cookies): the one source of both. Saving writes the cookies
 * (and the language on the user as well).
 */
export function ProfileForm({ name, email, pendingEmail, authProvider, locale, theme, className }: Text & Site & { pendingEmail: string | null; authProvider: 'password' | 'google'; className?: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveProfile, IDLE);
  return (
    <Card as="section" aria-labelledby="h-profile" className={cx('flex flex-col gap-4', className)}>
      <h2 id="h-profile" className="m-0 heading-5">{t('account.profile.title')}</h2>
      {/* Every field is controlled: without `keepControlledValues` the selects fall back to the old language and theme after Save. */}
      <form ref={keepControlledValues} action={action} noValidate className="flex flex-col gap-4">
        <TextFields initial={{ name, email }} unchanged={authProvider === 'google' ? null : [email, pendingEmail]} errors={state.errors} />
        {pendingEmail && <p role="status" className="m-0 -mt-2 text-13 leading-snug text-text-2">{t('account.profile.emailPending', { email: pendingEmail })}</p>}
        {/* Keyed by the language and the theme of the site: when one changes (here, or in the header menu), the two selects start
            again from what the site shows, so a later Save cannot put an old choice back. The name and the email are outside the
            key: what was typed and not saved yet stays. */}
        <SiteFields key={`${locale}-${theme}`} initial={{ locale, theme }} />
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" variant="secondary" pending={pending} className="max-nav:w-full">{t('account.profile.save')}</Button>
          <span role="status" className="text-15 text-accent-text">
            {state.status === 'saved' && t('account.profile.saved')}
          </span>
          {state.errors.form && <span role="alert" className="text-15 text-warn">{t(`account.profile.error.${state.errors.form}`)}</span>}
        </div>
      </form>
      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="m-0 text-15 font-semibold">{t('account.profile.passwordTitle')}</h3>
        {authProvider === 'google' ? (
          <p className="m-0 text-13 leading-snug text-text-3">{t('account.profile.passwordGoogle')}</p>
        ) : (
          // A form, not a link: the reset link is sent by a POST, so loading or prefetching an address sends nothing.
          <form action={startPasswordChange}>
            <Button type="submit" variant="secondary" className="max-nav:w-full">{t('account.profile.passwordChange')}</Button>
          </form>
        )}
      </div>
    </Card>
  );
}
