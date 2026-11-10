import type { ComponentProps } from 'react';
import { cx } from '@/shared/lib/cx';

export function Card({ as: Tag = 'div', className, ...rest }: { as?: 'section' | 'div' } & ComponentProps<'div'>) {
  return <Tag {...rest} className={cx('box-border rounded-16 border border-line bg-surface p-6', className)} />;
}
