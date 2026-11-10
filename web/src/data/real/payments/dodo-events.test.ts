// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { receiveDodoWebhook } from './dodo-events';
import type { DodoTranslation } from './dodo-events';
import type { DodoSession, DodoSessions } from './dodo-events';
import { verifyDodoWebhook } from './dodo-signature';
import { signDodoWebhook } from './dodo-test-helpers';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const fixture = (name: string) => readFileSync(new URL(`./fixtures/dodo/${name}.json`, import.meta.url), 'utf8');
/** A fixture with one thing changed, serialised again (translation does not depend on the exact bytes). */
function edited(name: string, change: (body: Json) => void): string {
  const body = JSON.parse(fixture(name)) as Json;
  change(body);
  return JSON.stringify(body);
}
/** What our own store knows: the checkout we opened, the session Dodo gave us, the payment once it paid. */
function stored(...list: DodoSession[]): DodoSessions {
  return {
    byCheckoutId: (id) => list.find((s) => s.checkoutId === id),
    byPaymentId: (id) => list.find((s) => s.paymentId === id),
  };
}
/** Sets the event's own time to this moment: a refund or dispute of a payment not stored yet is asked for again only while it is recent. */
const justNow = (body: Json) => { body.timestamp = new Date().toISOString(); };
const OPEN: DodoSession = { checkoutId: 'checkout-fixture-0001', sessionId: 'cks_fixture0001' };
const PAID: DodoSession = { ...OPEN, paymentId: 'pay_fixture0001' };
const WEBHOOK_ID = 'msg_fixture_delivery_0001';
const SECRET = 'whsec_' + randomBytes(32).toString('base64');
function delivery(raw: string, webhookId: string): Headers {
  const seconds = Math.floor(Date.now() / 1000);
  return new Headers({ 'webhook-id': webhookId, 'webhook-timestamp': String(seconds), 'webhook-signature': signDodoWebhook(raw, webhookId, seconds, SECRET) });
}
/** Translation has one way in, behind the signature check: every case below arrives as a signed delivery. */
function translateDodoEvent(raw: string, webhookId: string, sessions: DodoSessions): DodoTranslation {
  return receiveDodoWebhook(raw, delivery(raw, webhookId), SECRET, sessions);
}

describe('payment events', () => {
  it('turns payment.succeeded into a paid event bound to our checkout, with the price before tax', () => {
    expect(translateDodoEvent(fixture('payment.succeeded'), WEBHOOK_ID, stored(OPEN))).toEqual({
      outcome: 'event',
      dodoType: 'payment.succeeded',
      event: {
        eventId: WEBHOOK_ID,
        checkoutId: 'checkout-fixture-0001',
        providerSessionId: 'cks_fixture0001',
        providerPaymentId: 'pay_fixture0001',
        kind: 'paid',
        amountMinor: 1900,
        currency: 'USD',
        occurredAt: '2026-10-07T03:00:05.123Z',
      },
      payment: {
        totalMinor: 2261,
        taxMinor: 361,
        taxReported: true,
        cart: [{ productId: 'pdt_fixture_standard', quantity: 1 }],
        invoiceUrl: 'https://test.dodopayments.com/invoices/payments/pay_fixture0001',
      },
    });
  });

  it.each([
    ['payment.failed', 'failed', 'declined'],
    ['payment.processing', 'processing', 'pending'],
    ['payment.cancelled', 'cancelled', 'cancelled'],
  ])('turns %s into a %s event', (type, status, kind) => {
    const raw = edited('payment.succeeded', (b) => { b.type = type; b.data.status = status; });
    const result = translateDodoEvent(raw, WEBHOOK_ID, stored(OPEN));
    expect(result).toMatchObject({ outcome: 'event', dodoType: type, event: { kind, checkoutId: OPEN.checkoutId } });
  });

  it('says whether Dodo reported a tax at all, so the gate can tell "no tax" from "tax not known"', () => {
    const taxOf = (change: (b: Json) => void) => translateDodoEvent(edited('payment.succeeded', change), WEBHOOK_ID, stored(OPEN));
    expect(taxOf((b) => { b.data.tax = 0; b.data.total_amount = 1900; })).toMatchObject({ payment: { taxMinor: 0, taxReported: true } });
    expect(taxOf((b) => { b.data.tax = null; b.data.total_amount = 1900; })).toMatchObject({ payment: { taxMinor: 0, taxReported: false } });
    expect(taxOf((b) => { delete b.data.tax; b.data.total_amount = 1900; })).toMatchObject({ payment: { taxMinor: 0, taxReported: false } });
  });

  it('counts a missing tax as no tax', () => {
    const raw = edited('payment.succeeded', (b) => { b.data.tax = null; b.data.total_amount = 1900; });
    expect(translateDodoEvent(raw, WEBHOOK_ID, stored(OPEN))).toMatchObject({ event: { amountMinor: 1900 }, payment: { totalMinor: 1900, taxMinor: 0 } });
  });

  it('passes the paid currency through unchanged so the gate can refuse a non-USD payment', () => {
    const raw = edited('payment.succeeded', (b) => { b.data.currency = 'EUR'; });
    expect(translateDodoEvent(raw, WEBHOOK_ID, stored(OPEN))).toMatchObject({ outcome: 'event', event: { kind: 'paid', currency: 'EUR' } });
  });

  it('accepts a later payment attempt in the same session under its own payment id', () => {
    const raw = edited('payment.succeeded', (b) => { b.data.payment_id = 'pay_second_attempt'; });
    const earlier: DodoSession = { ...OPEN, paymentId: 'pay_declined_attempt' };
    expect(translateDodoEvent(raw, WEBHOOK_ID, stored(earlier))).toMatchObject({ outcome: 'event', event: { providerPaymentId: 'pay_second_attempt' } });
  });
});

describe('a payment event that cannot be tied to a checkout we opened is rejected', () => {
  it.each<[string, (b: Json) => void, string]>([
    ['no metadata.checkout_id', (b) => { delete b.data.metadata.checkout_id; }, 'checkout-id-missing'],
    ['no metadata at all', (b) => { delete b.data.metadata; }, 'checkout-id-missing'],
    ['an empty metadata.checkout_id', (b) => { b.data.metadata.checkout_id = ''; }, 'checkout-id-missing'],
    ['a metadata.checkout_id that is not text', (b) => { b.data.metadata.checkout_id = 42; }, 'checkout-id-missing'],
    ['a checkout id we never issued', (b) => { b.data.metadata.checkout_id = 'checkout-of-someone-else'; }, 'unknown-checkout'],
    ['a session other than the one stored for that checkout', (b) => { b.data.checkout_session_id = 'cks_other_session'; }, 'session-mismatch'],
    ['no checkout session at all', (b) => { b.data.checkout_session_id = null; }, 'session-mismatch'],
  ])('%s', (_label, change, reason) => {
    expect(translateDodoEvent(edited('payment.succeeded', change), WEBHOOK_ID, stored(OPEN))).toEqual({ outcome: 'rejected', reason, retry: false });
  });

  it('a checkout id that belongs to another stored session', () => {
    const other: DodoSession = { checkoutId: 'checkout-fixture-0002', sessionId: 'cks_fixture0002' };
    const raw = edited('payment.succeeded', (b) => { b.data.metadata.checkout_id = other.checkoutId; });
    expect(translateDodoEvent(raw, WEBHOOK_ID, stored(OPEN, other))).toEqual({ outcome: 'rejected', reason: 'session-mismatch', retry: false });
  });
});

describe('a payment event that contradicts itself is rejected', () => {
  it.each<[string, (b: Json) => void, string]>([
    ['payment.succeeded whose payment is not succeeded', (b) => { b.data.status = 'failed'; }, 'status-mismatch'],
    ['payment.succeeded whose payment has no status', (b) => { b.data.status = null; }, 'status-mismatch'],
    ['payment.succeeded whose body says it is not a payment', (b) => { b.data.payload_type = 'Subscription'; }, 'invalid-payload'],
    ['payment.succeeded that carries a refund', (b) => { b.data = { ...JSON.parse(fixture('refund.succeeded')).data }; }, 'invalid-payload'],
    ['more tax than the total', (b) => { b.data.tax = 2262; }, 'invalid-payload'],
    ['a negative total', (b) => { b.data.total_amount = -1900; b.data.tax = 0; }, 'invalid-payload'],
    ['a total with fractions of a cent', (b) => { b.data.total_amount = 2261.5; }, 'invalid-payload'],
    ['a total sent as text', (b) => { b.data.total_amount = '2261'; }, 'invalid-payload'],
    ['no payment id', (b) => { delete b.data.payment_id; }, 'invalid-payload'],
    ['a currency that is not a three letter code', (b) => { b.data.currency = 'usd '; }, 'invalid-payload'],
  ])('%s', (_label, change, reason) => {
    expect(translateDodoEvent(edited('payment.succeeded', change), WEBHOOK_ID, stored(OPEN))).toEqual({ outcome: 'rejected', reason, retry: false });
  });
});

describe('refund events', () => {
  it('turns refund.succeeded into a refunded event that names the Dodo refund', () => {
    expect(translateDodoEvent(fixture('refund.succeeded'), WEBHOOK_ID, stored(PAID))).toEqual({
      outcome: 'event',
      partialRefund: false,
      dodoType: 'refund.succeeded',
      event: {
        eventId: WEBHOOK_ID,
        checkoutId: 'checkout-fixture-0001',
        providerSessionId: 'cks_fixture0001',
        providerPaymentId: 'pay_fixture0001',
        providerRefundId: 'ref_fixture0001',
        kind: 'refunded',
        amountMinor: 2261,
        currency: 'USD',
        occurredAt: '2026-10-07T04:10:00.500Z',
      },
    });
  });

  it('says what a refund of a payment that is not stored was about, with the currency its amount is in: the number alone does not say how much of the payment went back', () => {
    const raw = edited('refund.succeeded', (b) => { b.data.amount = 190000; b.data.currency = 'INR'; });
    expect(translateDodoEvent(raw, WEBHOOK_ID, stored(OPEN))).toEqual({ outcome: 'rejected', reason: 'unknown-payment', retry: false,
      about: { dodoType: 'refund.succeeded', paymentId: 'pay_fixture0001', refundId: 'ref_fixture0001', partialRefund: false, amountMinor: 190000, currency: 'INR' } });
  });

  it.each<[string, (b: Json) => void]>([['null for its amount', (b) => { b.data.amount = null; }], ['no amount at all', (b) => { delete b.data.amount; }]])
  ('still tells of a refund Dodo gives %s: the refund went through, only how much it gave back is not known, and that is said beside the event', (_label, change) => {
    const translated = translateDodoEvent(edited('refund.succeeded', change), WEBHOOK_ID, stored(PAID));
    expect(translated).toMatchObject({ outcome: 'event', dodoType: 'refund.succeeded', amountUnknown: true, partialRefund: false, event: { kind: 'refunded', providerRefundId: 'ref_fixture0001', providerPaymentId: 'pay_fixture0001', currency: 'USD' } });
    // Of a payment that is not stored, the note of it carries no amount either.
    expect(translateDodoEvent(edited('refund.succeeded', change), WEBHOOK_ID, stored(OPEN))).toEqual({ outcome: 'rejected', reason: 'unknown-payment', retry: false,
      about: { dodoType: 'refund.succeeded', paymentId: 'pay_fixture0001', refundId: 'ref_fixture0001', partialRefund: false, currency: 'USD' } });
    // A refund whose amount is named says nothing of the kind.
    expect(translateDodoEvent(fixture('refund.succeeded'), WEBHOOK_ID, stored(PAID))).not.toHaveProperty('amountUnknown');
  });

  it('turns refund.failed into a refund-failed event', () => {
    const raw = edited('refund.succeeded', (b) => { b.type = 'refund.failed'; b.data.status = 'failed'; });
    expect(translateDodoEvent(raw, WEBHOOK_ID, stored(PAID))).toMatchObject({ outcome: 'event', event: { kind: 'refund-failed', providerRefundId: 'ref_fixture0001' } });
  });

  it.each<[string, (b: Json) => void, DodoSession, string]>([
    ['a checkout id other than the payment\'s own', (b) => { b.data.metadata.checkout_id = 'checkout-of-someone-else'; }, PAID, 'payment-mismatch'],
    ['a payment other than the one stored for that checkout', (b) => { b.data.payment_id = 'pay_other'; }, PAID, 'unknown-payment'],
    ['a checkout that has no paid payment stored', () => {}, OPEN, 'unknown-payment'],
    ['refund.succeeded whose refund is still pending', (b) => { b.data.status = 'pending'; }, PAID, 'status-mismatch'],
    ['a body that says it is not a refund', (b) => { b.data.payload_type = 'Payment'; }, PAID, 'invalid-payload'],
    ['a refund amount sent as text', (b) => { b.data.amount = '2261'; }, PAID, 'invalid-payload'],
    ['a negative refund amount', (b) => { b.data.amount = -2261; }, PAID, 'invalid-payload'],
    ['a refund amount with fractions of a cent', (b) => { b.data.amount = 2261.5; }, PAID, 'invalid-payload'],
    ['no refund currency', (b) => { b.data.currency = null; }, PAID, 'invalid-payload'],
  ])('rejects a refund with %s', (_label, change, session, reason) => {
    expect(translateDodoEvent(edited('refund.succeeded', (b) => { justNow(b); change(b); }), WEBHOOK_ID, stored(session))).toEqual({ outcome: 'rejected', reason, retry: reason === 'unknown-payment', ...(reason === 'unknown-payment' ? { about: expect.any(Object) } : {}) });
  });
});

describe('dispute events', () => {
  it.each(['opened', 'expired', 'accepted', 'cancelled', 'challenged', 'won', 'lost'])('turns dispute.%s into a dispute event found by the stored payment: only a won one ends the dispute', (stage) => {
    const raw = edited('dispute.opened', (b) => { b.type = `dispute.${stage}`; b.data.dispute_status = `dispute_${stage}`; });
    expect(translateDodoEvent(raw, WEBHOOK_ID, stored(PAID))).toEqual({
      outcome: 'event',
      dodoType: `dispute.${stage}`,
      event: {
        eventId: WEBHOOK_ID,
        checkoutId: 'checkout-fixture-0001',
        providerSessionId: 'cks_fixture0001',
        providerPaymentId: 'pay_fixture0001',
        providerDisputeId: 'dp_fixture0001',
        kind: stage === 'won' ? 'dispute-won' : 'disputed',
        amountMinor: 2261,
        currency: 'USD',
        occurredAt: '2026-10-09T11:30:00.000Z',
      },
    });
  });

  it.each([undefined, null, '', 7, 'x'.repeat(201)])('still reports the dispute when its own id is missing or cannot be read (%j): it names no dispute, and the pack is frozen all the same', (disputeId) => {
    const raw = edited('dispute.opened', (b) => { if (disputeId === undefined) delete b.data.dispute_id; else b.data.dispute_id = disputeId; });
    const translated = translateDodoEvent(raw, WEBHOOK_ID, stored(PAID));
    expect(translated).toMatchObject({ outcome: 'event', event: { kind: 'disputed', providerPaymentId: 'pay_fixture0001' } });
    expect(translated).not.toHaveProperty('event.providerDisputeId');
  });

  it('still reports the dispute when its amount is not a whole number of cents', () => {
    const raw = edited('dispute.opened', (b) => { b.data.amount = '22.61'; });
    expect(translateDodoEvent(raw, WEBHOOK_ID, stored(PAID))).toMatchObject({ outcome: 'event', event: { kind: 'disputed', amountMinor: 0 } });
  });

  it('rejects a dispute whose body says it is not a dispute', () => {
    const raw = edited('dispute.opened', (b) => { b.data.payload_type = 'Payment'; });
    expect(translateDodoEvent(raw, WEBHOOK_ID, stored(PAID))).toEqual({ outcome: 'rejected', reason: 'invalid-payload', retry: false });
  });

  it('rejects a dispute about a payment we have not stored', () => {
    expect(translateDodoEvent(edited('dispute.opened', justNow), WEBHOOK_ID, stored(OPEN))).toEqual({ outcome: 'rejected', reason: 'unknown-payment', retry: true, about: expect.any(Object) });
  });
});

describe('event types we do not act on', () => {
  it('keeps an unknown event type for the record without producing a payment event', () => {
    expect(translateDodoEvent(fixture('subscription.active'), WEBHOOK_ID, stored(PAID))).toEqual({ outcome: 'ignored', dodoType: 'subscription.active', eventId: WEBHOOK_ID });
  });

  it.each(['payment.refunded', 'payment.succeeded ', 'PAYMENT.SUCCEEDED', 'constructor', '__proto__', 'toString'])('ignores the look-alike type %j even with a full payment body', (type) => {
    const raw = edited('payment.succeeded', (b) => { b.type = type; });
    expect(translateDodoEvent(raw, WEBHOOK_ID, stored(OPEN))).toEqual({ outcome: 'ignored', dodoType: type, eventId: WEBHOOK_ID });
  });
});

describe('bodies that are not a Dodo event are rejected, never thrown', () => {
  it.each([
    ['text that is not JSON', 'not json', 'invalid-json'],
    ['an empty body', '', 'invalid-json'],
    ['JSON null', 'null', 'invalid-envelope'],
    ['a JSON array', '[]', 'invalid-envelope'],
    ['an event without a type', JSON.stringify({ timestamp: '2026-10-07T03:00:05Z', data: {} }), 'invalid-envelope'],
    ['an event without a timestamp', JSON.stringify({ type: 'payment.succeeded', data: {} }), 'invalid-envelope'],
    ['an event whose timestamp is not a date', JSON.stringify({ type: 'payment.succeeded', timestamp: 'soon', data: {} }), 'invalid-envelope'],
    ['an event without data', JSON.stringify({ type: 'payment.succeeded', timestamp: '2026-10-07T03:00:05Z' }), 'invalid-envelope'],
    ['a type longer than 100 characters', JSON.stringify({ type: 't'.repeat(101), timestamp: '2026-10-07T03:00:05Z', data: {} }), 'invalid-envelope'],
  ])('%s', (_label, raw, reason) => {
    expect(translateDodoEvent(raw, WEBHOOK_ID, stored(PAID))).toEqual({ outcome: 'rejected', reason, retry: false });
  });
});

describe('the same delivery arriving twice', () => {
  it('gives the same event under the same webhook id, byte for byte, so the gate applies it once', () => {
    const raw = fixture('payment.succeeded');
    const first = translateDodoEvent(raw, WEBHOOK_ID, stored(OPEN));
    // By the retry the first delivery has been applied: the store now also knows the payment.
    const again = translateDodoEvent(raw, WEBHOOK_ID, stored(PAID));
    expect(first.outcome).toBe('event');
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
  });

  it('takes the event id from the signed webhook id, never from the body', () => {
    const raw = edited('payment.succeeded', (b) => { b.id = 'evt_from_body'; b.data.event_id = 'evt_from_data'; b.data.metadata.event_id = 'evt_from_metadata'; });
    expect(translateDodoEvent(raw, 'msg_a', stored(OPEN))).toMatchObject({ event: { eventId: 'msg_a' } });
    expect(translateDodoEvent(raw, 'msg_b', stored(OPEN))).toMatchObject({ event: { eventId: 'msg_b' } });
  });

  it('keeps one identity through a signed retry with a fresh timestamp', () => {
    const secret = `whsec_${randomBytes(32).toString('base64')}`, raw = fixture('payment.succeeded');
    const deliver = (seconds: number) => {
      const headers = new Headers({ 'webhook-id': WEBHOOK_ID, 'webhook-timestamp': String(seconds), 'webhook-signature': signDodoWebhook(raw, WEBHOOK_ID, seconds, secret) });
      const verified = verifyDodoWebhook(raw, headers, secret, seconds * 1000);
      if (!verified.ok) throw new Error(verified.reason);
      return translateDodoEvent(raw, verified.webhookId, stored(OPEN));
    };
    expect(deliver(1_791_342_005)).toEqual(deliver(1_791_342_005 + 1800));
  });
});

describe('review round 1', () => {
  const refundOf = (change: (b: Json) => void = () => {}) => edited('refund.succeeded', change);
  const disputeOf = (change: (b: Json) => void = () => {}) => edited('dispute.opened', change);
  /** A store keyed by a plain object, the way a careless caller would build it. */
  function plainObjectStore(): DodoSessions {
    const byCheckout: Record<string, DodoSession> = {}, byPayment: Record<string, DodoSession> = {};
    return { byCheckoutId: (id) => byCheckout[id], byPaymentId: (id) => byPayment[id] };
  }

  it('translates nothing that is not verified: the store is not even asked', () => {
    const raw = fixture('payment.succeeded'), headers = delivery(raw, WEBHOOK_ID);
    const never: DodoSessions = { byCheckoutId: () => { throw new Error('asked'); }, byPaymentId: () => { throw new Error('asked'); } };
    expect(receiveDodoWebhook(raw + ' ', headers, SECRET, never)).toEqual({ outcome: 'unverified', reason: 'no-matching-signature' });
    expect(receiveDodoWebhook(raw, new Headers(), SECRET, never)).toEqual({ outcome: 'unverified', reason: 'missing-header' });
    expect(receiveDodoWebhook(raw, headers, SECRET, never, NaN)).toEqual({ outcome: 'unverified', reason: 'timestamp-out-of-tolerance' });
      });

  it('ties a refund to the payment we stored even when it carries no checkout id (a refund made in the Dodo panel)', () => {
    for (const change of [(b: Json) => { b.data.metadata = {}; }, (b: Json) => { b.data.metadata = null; }, (b: Json) => { delete b.data.metadata; }, () => {}])
      expect(translateDodoEvent(refundOf(change), WEBHOOK_ID, stored(PAID))).toMatchObject({ outcome: 'event', event: { kind: 'refunded', checkoutId: PAID.checkoutId, providerPaymentId: PAID.paymentId, providerSessionId: PAID.sessionId }, partialRefund: false });
  });

  it('refuses a refund whose checkout id names another checkout than the payment\'s own', () => {
    expect(translateDodoEvent(refundOf((b) => { b.data.metadata = { checkout_id: 'another-checkout' }; }), WEBHOOK_ID, stored(PAID))).toEqual({ outcome: 'rejected', reason: 'payment-mismatch', retry: false });
  });

  it('asks for a later retry when a refund or a dispute names a payment that is not stored yet, and for none when the refusal is final', () => {
    expect(translateDodoEvent(refundOf(justNow), WEBHOOK_ID, stored(OPEN))).toEqual({ outcome: 'rejected', reason: 'unknown-payment', retry: true, about: expect.any(Object) });
    expect(translateDodoEvent(disputeOf(justNow), WEBHOOK_ID, stored(OPEN))).toEqual({ outcome: 'rejected', reason: 'unknown-payment', retry: true, about: expect.any(Object) });
    expect(translateDodoEvent(fixture('payment.succeeded'), WEBHOOK_ID, stored())).toEqual({ outcome: 'rejected', reason: 'unknown-checkout', retry: false });
    expect(translateDodoEvent('{', WEBHOOK_ID, stored())).toEqual({ outcome: 'rejected', reason: 'invalid-json', retry: false });
  });

  it('a refund or a dispute of a payment that is not stored says what kind of notice it was and which payment and refund it names, and nothing else of its body: it can then be applied if that payment is credited later', () => {
    const about = (raw: string) => { const t = translateDodoEvent(raw, WEBHOOK_ID, stored(OPEN)); return t.outcome === 'rejected' ? t.about : t; };
    expect(about(refundOf())).toEqual({ dodoType: 'refund.succeeded', paymentId: 'pay_fixture0001', refundId: 'ref_fixture0001', partialRefund: false, amountMinor: 2261, currency: 'USD' });
    expect(about(refundOf((b) => { b.data.is_partial = true; }))).toEqual({ dodoType: 'refund.succeeded', paymentId: 'pay_fixture0001', refundId: 'ref_fixture0001', partialRefund: true, amountMinor: 2261, currency: 'USD' });
    expect(about(refundOf((b) => { b.type = 'refund.failed'; b.data.status = 'failed'; }))).toEqual({ dodoType: 'refund.failed', paymentId: 'pay_fixture0001', refundId: 'ref_fixture0001', partialRefund: false, amountMinor: 2261, currency: 'USD' });
    expect(about(disputeOf((b) => { b.type = 'dispute.won'; }))).toEqual({ dodoType: 'dispute.won', paymentId: 'pay_fixture0001', disputeId: 'dp_fixture0001', occurredAt: '2026-10-09T11:30:00.000Z' });
    // Every other refusal names nothing.
    expect(translateDodoEvent(refundOf((b) => { b.data.metadata = { checkout_id: 'another-checkout' }; }), WEBHOOK_ID, stored(PAID))).not.toHaveProperty('about');
  });

  it('stops asking for a retry once the event is an hour old: a payment that is still not stored by then is not one we are waiting for', () => {
    const aged = (ms: number) => (b: Json) => { b.timestamp = new Date(Date.now() - ms).toISOString(); };
    for (const of_ of [refundOf, disputeOf]) {
      expect(translateDodoEvent(of_(aged(3600000 - 5000)), WEBHOOK_ID, stored(OPEN))).toEqual({ outcome: 'rejected', reason: 'unknown-payment', retry: true, about: expect.any(Object) });
      expect(translateDodoEvent(of_(aged(3600000 + 5000)), WEBHOOK_ID, stored(OPEN))).toEqual({ outcome: 'rejected', reason: 'unknown-payment', retry: false, about: expect.any(Object) });
      expect(translateDodoEvent(of_(aged(30 * 86400000)), WEBHOOK_ID, stored(OPEN))).toEqual({ outcome: 'rejected', reason: 'unknown-payment', retry: false, about: expect.any(Object) });
      // A time ahead of our clock is not old.
      expect(translateDodoEvent(of_(aged(-3600000)), WEBHOOK_ID, stored(OPEN))).toEqual({ outcome: 'rejected', reason: 'unknown-payment', retry: true, about: expect.any(Object) });
      // Age never turns a refund or dispute of a stored payment away.
      expect(translateDodoEvent(of_(aged(30 * 86400000)), WEBHOOK_ID, stored(PAID))).toMatchObject({ outcome: 'event' });
    }
  });

  it('marks a partial refund, so the gate does not settle it as a whole one', () => {
    expect(translateDodoEvent(refundOf((b) => { b.data.is_partial = true; }), WEBHOOK_ID, stored(PAID))).toMatchObject({ outcome: 'event', partialRefund: true });
  });

  it.each([['empty', ''], ['missing', undefined], ['not text', 7]])('refuses a payment when the stored session id is %s, whatever the body says about its session', (_name, sessionId) => {
    const broken = stored({ checkoutId: OPEN.checkoutId, sessionId } as unknown as DodoSession);
    for (const change of [(b: Json) => { delete b.data.checkout_session_id; }, (b: Json) => { b.data.checkout_session_id = null; }, (b: Json) => { b.data.checkout_session_id = ''; }, (b: Json) => { b.data.checkout_session_id = String(sessionId ?? ''); }])
      expect(translateDodoEvent(edited('payment.succeeded', change), WEBHOOK_ID, broken)).toEqual({ outcome: 'rejected', reason: 'session-mismatch', retry: false });
  });

  it('finds nothing through an inherited key: checkout_id or payment_id "constructor" and "__proto__" are refused even over a plain-object store', () => {
    for (const key of ['constructor', '__proto__', 'toString']) {
      expect(translateDodoEvent(edited('payment.succeeded', (b) => { b.data.metadata = { checkout_id: key }; delete b.data.checkout_session_id; }), WEBHOOK_ID, plainObjectStore())).toMatchObject({ outcome: 'rejected' });
      expect(translateDodoEvent(disputeOf((b) => { b.data.payment_id = key; }), WEBHOOK_ID, plainObjectStore())).toMatchObject({ outcome: 'rejected', reason: 'unknown-payment' });
      expect(translateDodoEvent(refundOf((b) => { b.data.payment_id = key; b.data.metadata = {}; }), WEBHOOK_ID, plainObjectStore())).toMatchObject({ outcome: 'rejected', reason: 'unknown-payment' });
    }
  });

  it('refuses a session the store returns for another checkout or another payment than the one asked for', () => {
    const wrong: DodoSessions = { byCheckoutId: () => ({ ...OPEN, checkoutId: 'another-checkout' }), byPaymentId: () => ({ ...PAID, paymentId: 'pay_another' }) };
    expect(translateDodoEvent(fixture('payment.succeeded'), WEBHOOK_ID, wrong)).toMatchObject({ outcome: 'rejected', reason: 'unknown-checkout' });
    expect(translateDodoEvent(disputeOf(), WEBHOOK_ID, wrong)).toMatchObject({ outcome: 'rejected', reason: 'unknown-payment' });
    expect(translateDodoEvent(refundOf(), WEBHOOK_ID, wrong)).toMatchObject({ outcome: 'rejected', reason: 'unknown-payment' });
  });

  it.each(['javascript:alert(1)', 'http://test.dodopayments.com/invoices/1', 'https://evil.example/invoices/1', 'https://evil.example/.dodopayments.com', 'https://dodopayments.com.evil.example/x', 'https://xdodopayments.com/invoices/1', 'https://test.xdodopayments.com/invoices/1', 'https://user:secret@test.dodopayments.com/invoices/1', 'https://x@test.dodopayments.com/invoices/1', 'not a url'])('keeps no invoice link %s', (url) => {
    expect(translateDodoEvent(edited('payment.succeeded', (b) => { b.data.invoice_url = url; }), WEBHOOK_ID, stored(OPEN))).toMatchObject({ outcome: 'event', payment: { invoiceUrl: null } });
  });

  it('an invoice link too long to keep does not refuse the paid notice: the payment is still reported', () => {
    const paid = translateDodoEvent(edited('payment.succeeded', (b) => { b.data.invoice_url = 'https://test.dodopayments.com/' + 'i'.repeat(5000); }), WEBHOOK_ID, stored(OPEN));
    expect(paid).toMatchObject({ outcome: 'event', event: { kind: 'paid' }, payment: { invoiceUrl: null } });
  });

  it.each<[string, string, (b: Json) => void]>([
    ['a negative total with no tax', 'payment.succeeded', (b) => { b.data.total_amount = -1900; b.data.tax = null; }],
    ['a negative tax', 'payment.succeeded', (b) => { b.data.tax = -1; }],
    ['a fractional tax', 'payment.succeeded', (b) => { b.data.tax = 0.5; }],
    ['an empty payment id', 'payment.succeeded', (b) => { b.data.payment_id = ''; }],
    ['a payment id of 201 characters', 'payment.succeeded', (b) => { b.data.payment_id = 'p'.repeat(201); }],
    ['none of a product in the cart', 'payment.succeeded', (b) => { b.data.product_cart[0].quantity = 0; }],
    ['a negative quantity', 'payment.succeeded', (b) => { b.data.product_cart[0].quantity = -1; }],
    ['a fractional quantity', 'payment.succeeded', (b) => { b.data.product_cart[0].quantity = 1.5; }],
    ['a negative refund amount', 'refund.succeeded', (b) => { b.data.amount = -1; }],
    ['a fractional refund amount', 'refund.succeeded', (b) => { b.data.amount = 0.5; }],
    ['a refund id of 501 characters', 'refund.succeeded', (b) => { b.data.refund_id = 'r'.repeat(501); }],
    ['an empty refund payment id', 'refund.succeeded', (b) => { b.data.payment_id = ''; }],
  ])('refuses %s', (_name, name, change) => {
    expect(translateDodoEvent(edited(name, change), WEBHOOK_ID, stored(PAID))).toEqual({ outcome: 'rejected', reason: 'invalid-payload', retry: false });
  });
});

describe('a field Dodo sends in another form than documented, where nothing is decided on it', () => {
  it.each<[string, unknown, number]>([['a number', 2261, 2261], ['a number that is no whole amount', 22.61, 0], ['an object', { value: 2261 }, 0], ['nothing', undefined, 0], ['text', '2261', 2261]])
  ('a dispute whose amount is %s is still a dispute: the pack is frozen on the event, not on that number', (_label, amount, amountMinor) => {
    const raw = edited('dispute.opened', (b) => { if (amount === undefined) delete b.data.amount; else b.data.amount = amount; });
    expect(translateDodoEvent(raw, WEBHOOK_ID, stored(PAID))).toMatchObject({ outcome: 'event', event: { kind: 'disputed', checkoutId: PAID.checkoutId, providerPaymentId: PAID.paymentId, amountMinor } });
  });
  it.each<[string, unknown]>([['a number', 5], ['an object', { href: 'https://test.dodopayments.com/invoices/payments/pay_fixture0001' }], ['a list', ['https://test.dodopayments.com/invoices/payments/pay_fixture0001']], ['true', true]])
  ('a paid payment whose invoice address is %s is still a paid payment: it is credited by the same rules, and no address is kept', (_label, invoice) => {
    const plain = translateDodoEvent(fixture('payment.succeeded'), WEBHOOK_ID, stored(OPEN));
    const odd = translateDodoEvent(edited('payment.succeeded', (b) => { b.data.invoice_url = invoice; }), WEBHOOK_ID, stored(OPEN));
    expect(plain.outcome).toBe('event');
    expect(odd).toEqual({ ...plain, payment: { ...(plain as { payment: object }).payment, invoiceUrl: null } });
  });
});
