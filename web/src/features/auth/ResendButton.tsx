'use client';

import { useActionState, useEffect, useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { RULES } from '@/data/ports';
import { Button } from '@/shared/ui';
import { Notice } from '@/shared/ui/Notice';
import { resendReset, resendVerification } from './actions';
import type { AuthState } from './types';

/**
 * "Send again" with the wait of `RULES.resendSeconds` between two links: the server refuses an earlier one (`retryAfter`), the button
 * shows the seconds that are left. `kind` picks the email; `email` is only needed for the reset link.
 */
export function ResendButton({ kind, email }: { kind: 'verify' | 'reset'; email?: string }) {
  const t = useT();
  const ns = kind === 'verify' ? 'verify' : 'sent';
  const [state, action, pending] = useActionState<AuthState, FormData>(async (prev, form) => {
    const out = kind === 'verify' ? await resendVerification() : await resendReset(prev, form);
    return out ? { ...out, at: Date.now() } : out;
  }, null);
  const [now, setNow] = useState(0);
  // The wait the answer started: the server's `retryAfter`, or the full wait after a link that was sent.
  const wait = state?.retryAfter ?? (state?.sent ? RULES.resendSeconds : 0);
  useEffect(() => {
    if (!wait) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state, wait]);
  const elapsed = state?.at ? Math.max(0, now - state.at) / 1000 : 0;
  const left = wait ? Math.max(0, Math.ceil(wait - elapsed)) : 0;
  return (
    <form action={action} className="flex flex-col gap-3">
      {email && <input type="hidden" name="email" value={email} />}
      <Button type="submit" variant="secondary" fullWidth pending={pending} disabled={left > 0}>
        {left > 0 ? t(`auth.${ns}.wait`, { seconds: left }) : t(`auth.${ns}.resend`)}
      </Button>
      <div aria-live="polite" className="empty:hidden">
        {state?.form === 'rate-limited' ? (
          <Notice>{t('auth.error.rateLimited')}</Notice>
        ) : left > 0 && state && !state.sent ? (
          <Notice tone="info" icon="clock">{t(`auth.${ns}.tooSoon`, { seconds: left })}</Notice>
        ) : left > 0 && state?.sent ? (
          <Notice tone="info" icon="done">{t(`auth.${ns}.resent`, { seconds: left })}</Notice>
        ) : null}
      </div>
    </form>
  );
}
