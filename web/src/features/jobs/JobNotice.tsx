import type { ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { Icon } from '@/shared/ui/Icon';
import type { IconName } from '@/shared/ui/icons';

/**
 * The info / warning box of a job page: "taking longer than usual" (clock), "reconnecting" (turning circle), "generation is paused"
 * (warning). One pattern: an icon, then the sentence. `info` is read politely, `warn` as an alert.
 */
export function JobNotice({ tone, icon, spin, children }: { tone: 'info' | 'warn'; icon: IconName; spin?: boolean; children: ReactNode }) {
  return (
    <p
      role={tone === 'warn' ? 'alert' : 'status'}
      className={cx(
        'm-0 flex items-start gap-3 rounded-12 border bg-surface px-4 py-3 text-15 leading-normal text-text-2',
        tone === 'warn' ? 'border-warn-edge' : 'border-edge',
      )}
    >
      <Icon name={icon} size={20} className={cx('mt-0.5 flex-none', tone === 'warn' ? 'text-warn' : 'text-text-2', spin && 'animate-spin')} />
      <span>{children}</span>
    </p>
  );
}
