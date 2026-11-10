import type { ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';

export function EmptyState({ title, text, action, className }: { title: string; text?: string; action?: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'box-border flex flex-col items-center gap-6 rounded-16 border-[1.5px] border-dashed border-edge-strong px-4 py-12 text-center nav:px-6 nav:py-18',
        className,
      )}
    >
      <div className="flex flex-col items-center gap-2">
        <h2 className="m-0 heading-4">{title}</h2>
        {text && <p className="m-0 max-w-[520px] text-15 leading-normal text-text-2 text-pretty">{text}</p>}
      </div>
      {action}
    </div>
  );
}
