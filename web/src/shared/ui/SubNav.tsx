import Link from 'next/link';
import { cx } from '@/shared/lib/cx';

/** Second-level tabs (Revenue: Purchases · Credits). `currentHref` is the href of the active tab. */
export function SubNav({ label, items, currentHref }: { label: string; items: { href: string; label: string }[]; currentHref: string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-x-6 border-b border-line">
      {items.map((item) => {
        const on = item.href === currentHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            className={cx(
              'flex min-h-11 min-w-11 items-center text-15 font-medium no-underline',
              on ? 'text-text shadow-[inset_0_-2px_0_var(--accent-text)]' : 'text-text-3 hover:text-text',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
