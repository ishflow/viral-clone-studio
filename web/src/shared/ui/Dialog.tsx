'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
  dismissible = true,
  describedBy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  /** false: Escape does nothing (a request is running). Default true. */
  dismissible?: boolean;
  /** id of the element that describes the dialog. */
  describedBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const handled = useRef(false);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof el.showModal === 'function') el.showModal();
    else el.setAttribute('open', '');
    if (!el.contains(document.activeElement)) {
      el.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]')?.focus();
    }
    return () => {
      if (typeof el.close === 'function' && el.open) el.close();
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;

  // Escape reaches us as keydown (and as the native `cancel` in browsers); close once per press.
  const close = () => {
    if (!dismissible || handled.current) return;
    handled.current = true;
    queueMicrotask(() => {
      handled.current = false;
    });
    onCloseRef.current();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      }}
      className={cx(
        'box-border m-0 mt-auto w-full max-w-none rounded-t-24 border border-edge bg-surface px-4 pt-3 pb-8 text-text backdrop:bg-scrim',
        'nav:m-auto nav:max-w-xl nav:rounded-24 nav:p-6',
        className,
      )}
    >
      <div className="flex flex-col gap-6">
        {/* The grab bar of the phone sheet (decoration: the sheet closes with its buttons and Escape). */}
        <span data-sheet-handle aria-hidden="true" className="h-1 w-11 self-center rounded-full bg-edge-strong nav:hidden" />
        <h2 id={titleId} className="m-0 heading-4">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
