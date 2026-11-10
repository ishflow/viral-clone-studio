/** Runs once when the server starts. The Node-only check sits in its own file: Next reads this one for the Edge runtime as well. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  (await import('./instrumentation-node')).checkTrustedProxyConfig();
  (await import('./instrumentation-node')).checkOwnerTestConfig();
  (await import('./instrumentation-node')).checkSessionSecret();
  (await import('./instrumentation-node')).checkMailConfig();
  (await import('./instrumentation-node')).checkPaymentConfig();
  (await import('./instrumentation-node')).checkSiteEngine();
}
