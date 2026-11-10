import { z } from 'zod';
import { dodoAddress } from '@/core/payments/dodo-address';
import type { ProviderEvent } from '@/core/payments/state';
import { verifyDodoWebhook } from './dodo-signature';
import type { DodoSignatureFailure } from './dodo-signature';

/**
 * Turns a Dodo webhook into the gate's `ProviderEvent`. `receiveDodoWebhook` is the only way in: it
 * verifies the exact bytes first, and the verified webhook id becomes the event id, so a redelivery
 * (same id, same body) translates to the very same event and is applied once.
 * Nothing here reads the store or the network, and nothing throws.
 */

/** What we stored for a checkout we opened: Dodo's session, and its payment once one succeeded. */
export interface DodoSession { checkoutId: string; sessionId: string; paymentId?: string }
export interface DodoSessions {
  byCheckoutId(checkoutId: string): DodoSession | undefined;
  byPaymentId(paymentId: string): DodoSession | undefined;
}
/** Extra facts of a payment the gate needs for its price rule; not part of the event identity. */
export interface DodoPaymentFacts {
  totalMinor: number; taxMinor: number;
  /** False when Dodo sent no tax at all: `taxMinor` is then 0 by assumption, not by report. */
  taxReported: boolean;
  cart: { productId: string; quantity: number }[]; invoiceUrl: string | null;
}
export type DodoRejection =
  | 'invalid-json' | 'invalid-envelope' | 'invalid-payload' | 'status-mismatch'
  | 'checkout-id-missing' | 'unknown-checkout' | 'session-mismatch' | 'payment-mismatch' | 'unknown-payment';
export type DodoTranslation =
  /** The signature check refused the delivery: nothing was parsed. */
  | { outcome: 'unverified'; reason: DodoSignatureFailure }
  /** `partialRefund` is set on refund events: Dodo itself called the refund a part. The gate does not rely on it alone: it measures the amount against what was paid. */
  /** `amountUnknown`: Dodo told of the refund without its amount. The event's own amount is then 0 and says nothing. */
  | { outcome: 'event'; dodoType: string; event: ProviderEvent; payment?: DodoPaymentFacts; partialRefund?: boolean; amountUnknown?: true }
  /** A type we do not act on: keep it for the record, change nothing. */
  | { outcome: 'ignored'; dodoType: string; eventId: string }
  /** Authentic but not safely tied to one of our checkouts: no credit, no state change. */
  /** `retry`: the payment it names may only not be stored yet (Dodo promises no order), so the same delivery should come again. */
  | { outcome: 'rejected'; reason: DodoRejection; retry: boolean; about?: DodoAbout };
/** What a refund or a dispute of a payment we have not stored was about: enough to apply it if that payment is credited later, and nothing else of its body. */
export interface DodoAbout { dodoType: string; paymentId: string; refundId?: string; partialRefund?: boolean; /** Of a refund: how much went back, and in which currency that is counted. */ amountMinor?: number; currency?: string; disputeId?: string; /** Of a dispute: when the stage happened. */ occurredAt?: string }

const id = z.string().min(1).max(200);
const minor = z.number().int().nonnegative().safe();
const currency = z.string().regex(/^[A-Z]{3}$/);
const metadata = z.record(z.string(), z.unknown()).nullish();
const envelopeSchema = z.object({ type: z.string().min(1).max(100), timestamp: z.iso.datetime({ offset: true }), data: z.record(z.string(), z.unknown()) });
const paymentSchema = z.object({
  payload_type: z.literal('Payment'), payment_id: id, status: z.string().nullish(), total_amount: minor, tax: minor.nullish(), currency,
  checkout_session_id: z.string().nullish(), metadata,
  product_cart: z.array(z.object({ product_id: id, quantity: minor.positive() })).nullish(),
  // Nothing is decided on the invoice's address: whatever form it comes in, the payment is read, and only an address of Dodo's own is kept.
  invoice_url: z.unknown().optional(),
});
const refundSchema = z.object({ payload_type: z.literal('Refund'), refund_id: z.string().min(1).max(500), payment_id: id, status: z.string(), amount: minor.nullish(), currency, metadata, is_partial: z.boolean().nullish() });
// A dispute whose own id is missing or cannot be read is still a dispute: it is reported without one. So is one whose amount comes in another form.
const disputeSchema = z.object({ payload_type: z.literal('Dispute'), dispute_id: id.optional().catch(undefined), payment_id: id, amount: z.unknown().optional(), currency });

type Handled = { payload: 'Payment' | 'Refund'; kind: ProviderEvent['kind']; status: string } | { payload: 'Dispute'; kind: 'disputed' | 'dispute-won' };
/** A Map, not an object: a type named `constructor` must not find anything. */
const HANDLED = new Map<string, Handled>([
  ['payment.succeeded', { payload: 'Payment', kind: 'paid', status: 'succeeded' }],
  ['payment.failed', { payload: 'Payment', kind: 'declined', status: 'failed' }],
  ['payment.processing', { payload: 'Payment', kind: 'pending', status: 'processing' }],
  ['payment.cancelled', { payload: 'Payment', kind: 'cancelled', status: 'cancelled' }],
  ['refund.succeeded', { payload: 'Refund', kind: 'refunded', status: 'succeeded' }],
  ['refund.failed', { payload: 'Refund', kind: 'refund-failed', status: 'failed' }],
  // Every stage of a dispute keeps the pack frozen but the one that ends it in our favour: the money stays with us.
  ...['opened', 'expired', 'accepted', 'cancelled', 'challenged', 'lost'].map((stage): [string, Handled] => [`dispute.${stage}`, { payload: 'Dispute', kind: 'disputed' }]),
  ['dispute.won', { payload: 'Dispute', kind: 'dispute-won' }],
]);

const rejected = (reason: DodoRejection, retry = false, about?: DodoAbout): DodoTranslation => ({ outcome: 'rejected', reason, retry, ...(about ? { about } : {}) });
/** The store's answer counts only when it is the very record asked for, with a session Dodo gave us. An inherited key of a plain-object store fails here. */
function opened(session: DodoSession | undefined): session is DodoSession {
  return typeof session === 'object' && session !== null && typeof session.sessionId === 'string' && session.sessionId !== '';
}
function paidWith(session: DodoSession | undefined, paymentId: string): session is DodoSession {
  return opened(session) && session.paymentId === paymentId;
}
function checkoutIdOf(meta: Record<string, unknown> | null | undefined): string | null {
  const value = meta?.checkout_id;
  return typeof value === 'string' ? value : null;
}

/** `raw` must be the request body exactly as received. */
export function receiveDodoWebhook(raw: string, headers: Headers, secret: string, sessions: DodoSessions, now = Date.now()): DodoTranslation {
  const verified = verifyDodoWebhook(raw, headers, secret, now);
  return verified.ok ? translate(raw, verified.webhookId, sessions, now) : { outcome: 'unverified', reason: verified.reason };
}

/**
 * A refund or a dispute can arrive before the payment it names (Dodo promises no order): while the event is this young it is asked for again.
 * After that the payment is not one we are waiting for (a second payment, one the price rule refused, another product of the same business):
 * the notice is final, so Dodo does not repeat for a day what we will never store.
 */
const WAIT_FOR_PAYMENT_MS = 3600000;

function translate(raw: string, webhookId: string, sessions: DodoSessions, now: number): DodoTranslation {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return rejected('invalid-json'); }
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) return rejected('invalid-envelope');
  const { type, data } = envelope.data, handled = HANDLED.get(type);
  if (!handled) return { outcome: 'ignored', dodoType: type, eventId: webhookId };
  const occurredAt = new Date(envelope.data.timestamp).toISOString();
  const young = now - Date.parse(occurredAt) < WAIT_FOR_PAYMENT_MS;

  if (handled.payload === 'Payment') {
    const parsed = paymentSchema.safeParse(data);
    if (!parsed.success) return rejected('invalid-payload');
    const p = parsed.data, taxMinor = p.tax ?? 0;
    if (taxMinor > p.total_amount) return rejected('invalid-payload');
    if (p.status !== handled.status) return rejected('status-mismatch');
    const checkoutId = checkoutIdOf(p.metadata);
    if (!checkoutId) return rejected('checkout-id-missing');
    const session = sessions.byCheckoutId(checkoutId);
    if (typeof session !== 'object' || session === null || session.checkoutId !== checkoutId) return rejected('unknown-checkout');
    if (!opened(session) || p.checkout_session_id !== session.sessionId) return rejected('session-mismatch');
    return {
      outcome: 'event', dodoType: type,
      // amountMinor is the price before tax: Dodo adds the buyer's tax on top of the pack price.
      event: { eventId: webhookId, checkoutId, providerSessionId: session.sessionId, providerPaymentId: p.payment_id, kind: handled.kind, amountMinor: p.total_amount - taxMinor, currency: p.currency, occurredAt },
      payment: { totalMinor: p.total_amount, taxMinor, taxReported: typeof p.tax === 'number', cart: (p.product_cart ?? []).map((item) => ({ productId: item.product_id, quantity: item.quantity })), invoiceUrl: dodoAddress(p.invoice_url) },
    };
  }

  if (handled.payload === 'Refund') {
    const parsed = refundSchema.safeParse(data);
    if (!parsed.success) return rejected('invalid-payload');
    // A refund Dodo gives no amount for went through all the same: it is told, and how much it gave back is left unknown.
    const r = parsed.data, told = typeof r.amount === 'number' ? { amountMinor: r.amount } : {};
    if (r.status !== handled.status) return rejected('status-mismatch');
    // Tied to the payment we stored, like a dispute: a refund made in the Dodo panel carries no checkout id of ours.
    const session = sessions.byPaymentId(r.payment_id);
    if (!paidWith(session, r.payment_id)) return rejected('unknown-payment', young, { dodoType: type, paymentId: r.payment_id, refundId: r.refund_id, partialRefund: r.is_partial === true, ...told, currency: r.currency });
    const checkoutId = session.checkoutId, named = checkoutIdOf(r.metadata);
    if (named !== null && named !== checkoutId) return rejected('payment-mismatch');
    return {
      outcome: 'event', dodoType: type, partialRefund: r.is_partial === true, ...(typeof r.amount === 'number' ? {} : { amountUnknown: true as const }),
      event: { eventId: webhookId, checkoutId, providerSessionId: session.sessionId, providerPaymentId: r.payment_id, providerRefundId: r.refund_id, kind: handled.kind, amountMinor: r.amount ?? 0, currency: r.currency, occurredAt },
    };
  }

  // A dispute carries no metadata, so it is tied to a checkout through the payment we stored for it.
  const parsed = disputeSchema.safeParse(data);
  if (!parsed.success) return rejected('invalid-payload');
  const d = parsed.data, session = sessions.byPaymentId(d.payment_id);
  const dispute = d.dispute_id ? { disputeId: d.dispute_id } : {};
  if (!paidWith(session, d.payment_id)) return rejected('unknown-payment', young, { dodoType: type, paymentId: d.payment_id, ...dispute, occurredAt });
  // Dodo sends the disputed amount as text; the gate freezes on the event, not on this number.
  const amountMinor = typeof d.amount === 'string' && /^\d{1,15}$/.test(d.amount) ? Number(d.amount) : minor.safeParse(d.amount).data ?? 0;
  return {
    outcome: 'event', dodoType: type,
    event: { eventId: webhookId, checkoutId: session.checkoutId, providerSessionId: session.sessionId, providerPaymentId: d.payment_id, ...(d.dispute_id ? { providerDisputeId: d.dispute_id } : {}), kind: handled.kind, amountMinor, currency: d.currency, occurredAt },
  };
}
