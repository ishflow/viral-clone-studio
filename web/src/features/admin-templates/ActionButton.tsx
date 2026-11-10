'use client';
import { PROVIDER_CAP_MESSAGE } from '@/core/provider-cap-message';

import { useActionState, useRef, useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { Button, type ButtonVariant } from '@/shared/ui';
import type { ActionState } from './actions';
import { ConfirmDialog } from './ConfirmDialog';

const LINK =
  '-m-3 inline-flex min-h-11 cursor-pointer items-center border-0 bg-transparent px-3 text-15 font-medium text-accent-text no-underline hover:text-text disabled:cursor-not-allowed disabled:text-text-3';
const IDLE: ActionState = { status: 'idle' };

/**
 * One button = one guarded server action. Disabled while it runs and once it has worked, so a double click is one effect.
 * With `confirm` the button first opens a dialog; the action is sent only from the dialog's confirm button.
 */
export function ActionButton({
  action, id, label, variant = 'secondary', fullWidth, className, errorKey, confirm,
}: {
  action: (previous: ActionState, form: FormData) => Promise<ActionState>;
  id?: string;
  label: string;
  variant?: ButtonVariant | 'link';
  fullWidth?: boolean;
  className?: string;
  errorKey: string;
  confirm?: { title: string; text: string };
}) {
  const t = useT();
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [asking, setAsking] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const done = state.status === 'done';
  const open = confirm ? () => setAsking(true) : undefined;
  return (
    <form ref={form} action={formAction} className={fullWidth ? 'flex-1' : 'inline-flex flex-col'}>
      {id && <input type="hidden" name="id" value={id} />}
      {variant === 'link' ? (
        <button type={confirm ? 'button' : 'submit'} onClick={open} disabled={pending || done} aria-busy={pending || undefined} className={LINK}>{label}</button>
      ) : (
        <Button type={confirm ? 'button' : 'submit'} onClick={open} variant={variant} pending={pending} disabled={done} fullWidth={fullWidth} className={className}>{label}</Button>
      )}
      {state.status === 'error' && (
        <p role="alert" className="m-0 mt-2 text-13 text-warn">{state.providerCap ? PROVIDER_CAP_MESSAGE : t(state.error === 'transition' ? 'adminTemplates.inbox.transition' : errorKey)}</p>
      )}
      {confirm && (
        <ConfirmDialog
          open={asking} title={confirm.title} text={confirm.text} confirmLabel={label}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            form.current?.requestSubmit();
          }}
        />
      )}
    </form>
  );
}
