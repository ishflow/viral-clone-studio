import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { Icon } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'warn';
export type ButtonSize = 'm' | 'l';

const BASE =
  'inline-flex items-center justify-center box-border rounded-12 font-semibold no-underline cursor-pointer transition-colors disabled:cursor-not-allowed disabled:border-transparent disabled:bg-raised disabled:text-text-3 disabled:hover:bg-raised';

const QUIET_BASE =
  'inline-flex items-center box-border no-underline cursor-pointer transition-colors disabled:cursor-not-allowed disabled:text-text-3';

const SIZES: Record<Exclude<ButtonVariant, 'quiet'>, Record<ButtonSize, string>> = {
  primary: { m: 'min-h-13 px-6 text-15', l: 'min-h-15 px-8 text-17' },
  secondary: { m: 'min-h-13 px-6 text-15', l: 'min-h-15 px-8 text-15' },
  warn: { m: 'min-h-13 px-6 text-15', l: 'min-h-15 px-8 text-15' },
};

const LOOK: Record<ButtonVariant, string> = {
  primary: 'border-0 bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'border border-edge-strong bg-transparent text-text hover:bg-raised',
  warn: 'border border-warn bg-transparent text-warn hover:bg-raised',
  quiet: 'gap-2 min-h-11 bg-transparent text-15 font-medium text-accent-text hover:text-text',
};

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'm',
  fullWidth?: boolean,
  className?: string,
): string {
  return cx(
    variant === 'quiet' ? QUIET_BASE : BASE,
    LOOK[variant],
    variant !== 'quiet' && SIZES[variant][size],
    fullWidth && 'w-full',
    className,
  );
}

type Common = { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean };

export function Button({
  variant = 'primary',
  size = 'm',
  type = 'button',
  pending,
  fullWidth,
  disabled,
  className,
  children,
  ...rest
}: Common & { pending?: boolean } & Omit<ComponentProps<'button'>, 'type'> & { type?: 'button' | 'submit' | 'reset' }) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending ? true : undefined}
      className={buttonClass(variant, size, fullWidth, className)}
    >
      {pending && <Icon name="generating" size={18} className="mr-2 animate-spin" />}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = 'primary',
  size = 'm',
  fullWidth,
  className,
  children,
  ...rest
}: Common & { href: string; children: ReactNode } & Omit<ComponentProps<typeof Link>, 'href'>) {
  return (
    <Link {...rest} href={href} className={buttonClass(variant, size, fullWidth, className)}>
      {children}
    </Link>
  );
}
