/**
 * Paid mode: the worker spends real money (`VC_PROVIDER=magnific`). Site and worker get the same env (runbook §1), so the site can ask.
 * The one definition for the data layer and the session; the checkout feature keeps its own copy in `features/checkout/paid-mode.ts`.
 */
export function paidMode(): boolean {
  return process.env.VC_PROVIDER === 'magnific';
}
