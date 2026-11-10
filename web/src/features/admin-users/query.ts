import { first } from '@/shared/lib/query';

export const USER_FILTERS = ['all', 'paying', 'free-only', 'not-verified', 'blocked'] as const;
export type UserFilter = (typeof USER_FILTERS)[number];

/** `?filter=` and `?q=` from the URL; an unknown filter falls back to "all". */
export function parseUsersQuery(params: Record<string, string | string[] | undefined>): { filter: UserFilter; q: string } {
  const filter = first(params.filter);
  return { filter: (USER_FILTERS as readonly string[]).includes(filter) ? (filter as UserFilter) : 'all', q: first(params.q).trim().slice(0, 100) };
}

/** `/admin/users` or its export, with only the parts that are not the default. */
export function usersHref(base: string, { filter, q }: { filter: UserFilter; q: string }): string {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('filter', filter);
  if (q) params.set('q', q);
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}
