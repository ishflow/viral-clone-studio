'use client';

import { useActionState } from 'react';
import { PASSWORD_MIN_LENGTH } from '@/core/config';
import { useT } from '@/core/i18n/I18nProvider';
import { Button, Field, Input } from '@/shared/ui';
import { Notice } from '@/shared/ui/Notice';
import { resetPassword } from './actions';
import { errorText } from './parts';
import type { AuthState } from './types';

/** The new password for the link of the reset email: `token` goes back to the action, which checks it again and uses it up. */
export function ResetForm({ token }: { token: string }) {
  const t = useT();
  const [state, action, pending] = useActionState<AuthState, FormData>(resetPassword, null);
  const fields = state?.fieldErrors;
  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {state?.form === 'rate-limited' && <Notice>{t('auth.error.rateLimited')}</Notice>}
      <Field label={t('auth.reset.new')} hint={t('auth.reset.hint', { min: PASSWORD_MIN_LENGTH })} error={errorText(t, fields?.password)} className="gap-2 [&>label]:leading-[1.25]">
        <Input type="password" name="password" autoComplete="new-password" className="bg-surface" />
      </Field>
      <Field label={t('auth.reset.repeat')} error={errorText(t, fields?.repeat)} className="gap-2 [&>label]:leading-[1.25]">
        <Input type="password" name="repeat" autoComplete="new-password" className="bg-surface" />
      </Field>
      <Button type="submit" size="l" fullWidth pending={pending}>
        {t('auth.reset.submit')}
      </Button>
    </form>
  );
}
