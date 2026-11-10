import Link from 'next/link';
import { cx } from '@/shared/lib/cx';

export type SegmentedOption = { value: string; label: string };

const ITEM = 'flex min-h-11 min-w-11 flex-[1_0_auto] items-center justify-center rounded-full border-0 px-3 nav:flex-none nav:px-4 text-15 font-medium no-underline cursor-pointer';
const ON = 'bg-raised text-text';
const OFF = 'bg-transparent text-text-3 hover:text-text';

type Props = {
  label: string;
  options: SegmentedOption[];
  value: string;
  className?: string;
} & ({ onChange: (value: string) => void; hrefFor?: never } | { hrefFor: (value: string) => string; onChange?: never });

export function Segmented({ label, options, value, onChange, hrefFor, className }: Props) {
  return (
    <div role="group" aria-label={label} className={cx('flex flex-nowrap gap-1 overflow-x-auto rounded-full border border-line p-1', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return hrefFor ? (
          <Link key={o.value} href={hrefFor(o.value)} aria-current={on ? 'page' : undefined} className={cx(ITEM, on ? ON : OFF)}>
            {o.label}
          </Link>
        ) : (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange?.(o.value)} className={cx(ITEM, on ? ON : OFF)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
