import type { ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { Icon } from './Icon';
import type { IconName } from './icons';

/**
 * A message with an icon: `warn` is a problem (announced at once, `role="alert"`), `info` is a status (`role="status"`).
 * The text is the first child; `children` may carry links.
 */
export function Notice({ tone = 'warn', icon = 'warning', children, className }: { tone?: 'warn' | 'info'; icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <p role={tone === 'warn' ? 'alert' : 'status'} className={cx('m-0 flex items-start gap-1.5 text-13 leading-snug', tone === 'warn' ? 'text-warn' : 'text-accent-text', className)}>
      <Icon name={icon} size={16} className="mt-px flex-none" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
