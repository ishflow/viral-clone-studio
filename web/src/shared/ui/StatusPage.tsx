import type { ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { Icon } from './Icon';
import type { IconName } from './icons';

/**
 * The centred status page of the boards (service error, no access, expired link…): a 72 px icon circle, a title, a text and one or two
 * actions (full width and stacked on a phone). `children` are the actions.
 */
export function StatusPage({ icon, title, text, note, children, className }: { icon: IconName; title: string; text?: ReactNode; note?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center gap-6 text-center', className)}>
      <span className="flex size-18 items-center justify-center rounded-full bg-raised text-warn" aria-hidden="true">
        <Icon name={icon} size={32} strokeWidth={1.5} />
      </span>
      <h1 className="m-0 heading-3 text-balance">{title}</h1>
      {text && <p className="m-0 max-w-115 text-17 leading-normal text-text-2 text-pretty">{text}</p>}
      {note && <p className="m-0 max-w-115 text-13 leading-normal text-text-3 text-pretty">{note}</p>}
      {children && <div className="flex w-full flex-col gap-3 nav:w-auto nav:flex-row [&>*]:self-stretch nav:[&>*]:self-auto">{children}</div>}
    </div>
  );
}
