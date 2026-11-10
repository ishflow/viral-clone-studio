'use client';

import { useActionState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { Button, Field, Input } from '@/shared/ui';
import { Notice } from '@/shared/ui/Notice';
import { requestReset } from './actions';
import { errorText } from './parts';
import type { AuthState } from './types';

export function ForgotForm() {
  const t = useT();
  const [state, action, pending] = useActionState<AuthState, FormData>(requestReset, null);
  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      {state?.form === 'rate-limited' && <Notice>{t('auth.error.rateLimited')}</Notice>}
      <Field label={t('auth.field.email')} error={errorText(t, state?.fieldErrors?.email)} className="gap-2 [&>label]:leading-[1.25]">
        <Input type="email" name="email" autoComplete="email" placeholder={t('auth.field.emailPlaceholder')} defaultValue={state?.email} className="bg-surface" />
      </Field>
      <Button type="submit" size="l" fullWidth pending={pending}>
        {t('auth.forgot.submit')}
      </Button>
    </form>
  );
}
