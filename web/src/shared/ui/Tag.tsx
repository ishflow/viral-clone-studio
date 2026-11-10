import type { ComponentProps } from 'react';
import { cx } from '@/shared/lib/cx';

/** `accent`: the text in the accent colour (the `Free` label of a card), not the scrim's own. */
export function Tag({ className, accent, ...rest }: ComponentProps<'span'> & { accent?: boolean }) {
  return <span {...rest} className={cx('rounded-full bg-scrim px-2.5 py-[5px] text-13 font-medium', accent ? 'text-accent' : 'text-on-scrim', className)} />;
}
