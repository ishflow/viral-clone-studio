import Link from 'next/link';
import { SITE } from '@/core/config';
import { cx } from '@/shared/lib/cx';

export function Logo({ href = '/', className, onClick }: { href?: string; className?: string; onClick?: () => void }) {
  return (
    <Link
      href={href}
      prefetch={false}
      onClick={onClick}
      aria-label={SITE.name}
      className={cx(
        'flex items-baseline gap-[0.34em] font-display text-24 leading-none font-extrabold tracking-[-0.04em] text-text no-underline',
        className,
      )}
    >
      <svg viewBox="0 0 42 32" fill="none" aria-hidden="true" className="block h-[0.74em] w-[0.97em] flex-none">
        <rect x="1.5" y="1.5" width="15" height="29" rx="3" stroke="currentColor" strokeWidth="3" />
        <rect x="25.5" y="1.5" width="15" height="29" rx="3" strokeWidth="3" className="fill-accent stroke-mark-edge" />
      </svg>
      <span>viral clone</span>
    </Link>
  );
}
