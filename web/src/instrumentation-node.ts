import { mailConfig } from '@/core/payments/mail-config';
import { ownerTestConfig } from './core/paid-mode';
import { checkTrustedProxy } from './core/rate-limit/trusted-proxy';
import { providerCaps } from '../../viraleditor/src/robust/provider-policy';
import { engine } from './data/engine';
import { sessionKey } from '@/core/session/secret';
import { paymentConfig, paymentPipelineEnabled, redact } from '@/core/payments/config';

/**
 * The start-up check of the Node server. A session secret that is missing in paid mode, or too short, stops the process (exit 1, the reason in
 * the log) instead of letting the site serve with a key nobody chose: Next itself only logs an error from the hook and keeps serving.
 */
export function checkSessionSecret(): void {
  try {
    sessionKey();
  } catch (error) {
    console.error(`site-not-started: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/** Next logs hook exceptions and keeps serving; a failed exclusive lock must exit. */
export function checkSiteEngine(): void {
  if (process.env.VC_ENGINE !== 'sqlite') return;
  try { engine(); } catch (error) {
    console.error(`site-not-started: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/** The payment pipeline is opt-in (`VC_PAYMENTS` set, or paid mode): then its config must be valid, otherwise the site does not start. */
export function checkPaymentConfig(): void {
  if (!paymentPipelineEnabled() && (process.env.VC_PROVIDER !== 'magnific' || ownerTestConfig(process.env))) return;
  try {
    // Real payments are written "command first, then the call": on the in-memory store a restart would lose the command and what it paid for.
    const config = paymentConfig();
    if (config.mode === 'test' && process.env.VC_ENGINE !== 'sqlite') throw new Error('test-payments-require-sqlite');
    // The sweep's door answers 401 to everyone without a secret of this length: the minute's tour would never run, and a payment whose webhook is lost would never be credited.
    if (config.mode === 'test' && (config.cronSecret()?.length ?? 0) < 32) throw new Error('sweep-secret-required');
  } catch (error) {
    console.error(`site-not-started: ${redact(error instanceof Error ? error.message : String(error))}`);
    process.exit(1);
  }
}

/** Cloudflare named as the proxy of a site that can be reached past it: the caller's address would be anybody's word. */
export function checkTrustedProxyConfig(): void {
  try { checkTrustedProxy(); } catch (error) {
    console.error(`site-not-started: ${error instanceof Error ? error.message : 'invalid-trusted-proxy'}`);
    process.exit(1);
  }
}

let ownerWarned = false;
export function checkOwnerTestConfig(): void {
  try {
    const owner = ownerTestConfig(process.env);
    if (process.env.VC_PROVIDER === 'magnific') providerCaps(process.env);
    if (owner && process.env.VC_ENGINE !== 'sqlite') throw new Error('owner-test-requires-sqlite');
    if (owner && !ownerWarned) { console.warn('OWNER TEST: real Magnific money is spent / gerçek Magnific parası harcanır'); ownerWarned = true; }
  } catch (error) { console.error(`site-not-started: ${error instanceof Error ? error.message : 'owner-test-invalid'}`); process.exit(1); }
}

/** Validate mail independently from payment selection. */
export function checkMailConfig():void {
  try { mailConfig(); } catch(error) { console.error(`site-not-started: ${error instanceof Error?error.message:'invalid-mail-config'}`); process.exit(1); }
}
