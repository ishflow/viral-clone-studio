import type { ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { Icon } from './Icon';

// `queued` (hollow circle) and `closed` (hollow square) are neutral: nothing is wrong, nothing is moving.
export type StatusKind = 'done' | 'running' | 'stopped' | 'waiting' | 'queued' | 'closed';

export function StatusLine({ kind, children, className }: { kind: StatusKind; children: ReactNode; className?: string }) {
  const color = kind === 'stopped' ? 'text-warn' : kind === 'waiting' || kind === 'queued' || kind === 'closed' ? 'text-text-2' : 'text-accent-text';
  return (
    <span className={cx('flex items-center gap-2 text-15 font-semibold', color, className)}>
      {kind === 'done' && <Icon name="done" size={18} strokeWidth={2.6} />}
      {kind === 'running' && <span aria-hidden="true" className="size-2 rounded-full bg-accent-text" />}
      {kind === 'stopped' && <span aria-hidden="true" className="size-2 rounded-[2px] bg-warn" />}
      {(kind === 'waiting' || kind === 'queued') && <span aria-hidden="true" className="size-2 rounded-full border-[1.5px] border-current" />}
      {kind === 'closed' && <span aria-hidden="true" className="size-2 rounded-[2px] border-[1.5px] border-current" />}
      {children}
    </span>
  );
}
