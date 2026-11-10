import { ownerTestConfig } from '../paid-mode';
import { dodoConfig } from '@/data/real/payments/dodo-provider';
import type { DodoConfig } from '@/data/real/payments/dodo-provider';
import { dodoSecretUsable } from '@/data/real/payments/dodo-signature';
/** `secret` and `cronSecret` are functions, like the Dodo key: printing the settings (a log line, `inspect`, JSON) cannot show them. */
interface Settings { secret:()=>string; base:string; cronSecret:()=>string|undefined }
/** `secret` signs the webhooks of the mode: our own offline one in `fake`, Dodo's `whsec_` one in `test`. */
export type PaymentConfig = ({mode:'fake'} & Settings) | ({mode:'test'; dodo:DodoConfig} & Settings);
/** Demo ports remain the default; the signed offline pipeline is explicitly selected with VC_PAYMENTS=fake, Dodo's test mode with VC_PAYMENTS=test. */
export function paymentPipelineEnabled(): boolean { return process.env.VC_PAYMENTS !== undefined; }
export function paymentConfig(env: Record<string,string|undefined> = process.env): PaymentConfig {
  const mode = env.VC_PAYMENTS ?? 'fake';
  if (!['fake','test','live'].includes(mode)) throw new Error('invalid-payment-mode');
  if ((mode === 'test' && (env.DODO_API_KEY_LIVE || env.DODO_WEBHOOK_SECRET_LIVE)) || (mode === 'live' && (env.DODO_API_KEY_TEST || env.DODO_WEBHOOK_SECRET_TEST))) throw new Error('mixed-payment-keys');
  if (mode === 'live' && env.VC_PAYMENTS_LIVE_CONFIRM !== 'yes') throw new Error('live-confirm-required');
  if (mode === 'live') throw new Error('payment-adapter-unavailable'); // C10 intentionally absent
  // Neither fake nor test payments cost the buyer anything, so neither may pay for real generation.
  if (env.VC_PROVIDER === 'magnific' && !ownerTestConfig(env)) throw new Error(`${mode}-payments-in-paid-mode`);
  const dodo = mode === 'test' ? dodoConfig(env) : undefined;
  const secret = (dodo ? env.DODO_WEBHOOK_SECRET_TEST : env.VC_PAYMENTS_WEBHOOK_SECRET) ?? '';
  // A secret no webhook could ever match must not start the site.
  if (dodo ? !dodoSecretUsable(secret) : secret.length < 32) throw new Error(dodo ? 'dodo-webhook-secret-required' : 'webhook-secret-required');
  const base = env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:3201';
  const url = new URL(base);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('invalid-payment-base-url');
  const cronSecret = env.INTERNAL_CRON_SECRET;
  const settings = {secret:()=>secret, base:url.origin, cronSecret:()=>cronSecret};
  return dodo ? {mode:'test', dodo, ...settings} : {mode:'fake', ...settings};
}
export function redact(text: string, env: Record<string,string|undefined> = process.env): string {
  for (const [name,value] of Object.entries(env)) if (value && /SECRET|KEY|PASSWORD|TOKEN/.test(name)) text=text.split(value).join('[redacted]');
  return text;
}
