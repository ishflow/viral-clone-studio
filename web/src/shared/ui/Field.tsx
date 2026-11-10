import { cloneElement, isValidElement, useId, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { Icon } from './Icon';

const CONTROL =
  'box-border min-h-13 w-full rounded-12 border border-edge-strong bg-bg text-15 text-text aria-invalid:border-[1.5px] aria-invalid:border-warn';

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input {...rest} className={cx(CONTROL, 'px-4', className)} />;
}

export function Select({ className, ...rest }: ComponentProps<'select'>) {
  return <select {...rest} className={cx(CONTROL, 'px-4', className)} />;
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea {...rest} className={cx(CONTROL, 'px-4 py-3 leading-normal resize-y', className)} />;
}

export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  error?: string;
  hint?: string;
  children: ReactElement<Record<string, unknown>>;
  className?: string;
}) {
  const uid = useId();
  const id = (isValidElement(children) && (children.props.id as string | undefined)) || `${uid}-control`;
  const hintId = hint && !error ? `${uid}-hint` : undefined;
  const errorId = error ? `${uid}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-15 text-text-2">
        {label}
      </label>
      {cloneElement(children, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint && !error && (
        <span id={hintId} className="text-13 leading-snug text-text-3">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="flex items-center gap-1.5 text-13 leading-snug text-warn">
          <Icon name="warning" size={16} />
          {error}
        </span>
      )}
    </div>
  );
}
