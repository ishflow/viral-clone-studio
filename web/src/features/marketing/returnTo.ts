import { safeNext } from '@/core/session/session';

/** `?returnTo=` from the pricing URL: only an accepted same-site path survives, anything else is dropped. */
export function resolveReturnTo(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const safe = safeNext(raw);
  return safe === raw ? safe : undefined;
}
