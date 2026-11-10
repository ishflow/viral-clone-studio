import type { LedgerType } from '@/data/ports';
import type { Period } from '@/core/period';
import { first } from '@/shared/lib/query';

export { PERIODS, parsePeriod } from '@/core/period';
export const LEDGER_TYPES: readonly LedgerType[] = ['purchase', 'generation', 'free-video', 'returned', 'refund', 'admin'];

export type Params = Record<string, string | string[] | undefined>;

/** `?type=` of the ledger; unknown is "all" (undefined). */
export function parseLedgerType(raw: string | string[] | undefined): LedgerType | undefined {
  const value = first(raw);
  return (LEDGER_TYPES as readonly string[]).includes(value) ? (value as LedgerType) : undefined;
}

/** The statuses the overview links to: `?status=not-completed` marks the unpaid rows, `?status=refund-requested` the open refund requests. */
export type StatusMark = 'not-completed' | 'refund-requested';
export const parseStatusMark = (raw: string | string[] | undefined): StatusMark | null => {
  const value = first(raw);
  return value === 'not-completed' || value === 'refund-requested' ? value : null;
};

/** A link to `base` with the parts that are not the default. */
export function hrefWith(base: string, { period, type, status }: { period?: Period; type?: LedgerType; status?: StatusMark | null }): string {
  const params = new URLSearchParams();
  if (period && period !== '30d') params.set('period', period);
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}
