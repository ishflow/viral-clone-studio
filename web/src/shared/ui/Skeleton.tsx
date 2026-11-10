import { cx } from '@/shared/lib/cx';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('animate-pulse rounded-12 bg-surface', className)} />;
}
