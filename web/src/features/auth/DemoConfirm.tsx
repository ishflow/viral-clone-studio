'use client';

import { useActionState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { Notice } from '@/shared/ui/Notice';
import { confirmEmail } from './actions';
import type { AuthState } from './types';

/** Demo aid, not on the canvas: the fake "I opened the link" step. The page does not draw it in paid mode, and the action refuses there too. */
export function DemoConfirm() {
  const t = useT();
  const [state, action] = useActionState<AuthState, FormData>(() => confirmEmail(), null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <button type="submit" className="min-h-11 cursor-pointer self-start border-0 bg-transparent p-0 text-13 text-text-2 underline hover:text-text">
        {t('auth.verify.demo')}
      </button>
      {state?.form === 'unavailable' && <Notice>{t('auth.error.unavailable')}</Notice>}
    </form>
  );
}
