import { forbidden } from 'next/navigation';

/**
 * The data layer decides who is an admin (`Error('forbidden')`), whoever the caller is. A page, an action or a route that gets that
 * answer shows the 403 page: it is never read as "could not load", "try again" or an empty list. Any other error is left to the caller.
 */
export function refuseForbidden(error: unknown): void {
  if (error instanceof Error && error.message === 'forbidden') forbidden();
}
