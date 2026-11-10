// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
const cookieStore = { get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined), set: vi.fn(), delete: vi.fn() };
vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
  notFound: () => { throw new Error('NOT_FOUND'); },
}));

import { data } from '@/data';
import { getStore, resetStore } from '@/data/mock/store';
import { forgetReconciliation } from '@/data/real/payments-gateway';
import { paymentStore } from '@/data/real/payments-store';
import { checkPayment, startCheckout } from './actions';

/** Dodo is made up: `paid` holds the payment it reports for a session, `down` makes every answer fail. */
const PRODUCT = 'pdt_madeupstarter';
type Row = Record<string, unknown>;
let calls: string[], paid: Record<string, Row>, down: boolean;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  for (const [name, value] of Object.entries({ VC_PAYMENTS: 'test', DODO_API_KEY_TEST: 'made-up-dodo-test-key', DODO_WEBHOOK_SECRET_TEST: 'whsec_' + randomBytes(32).toString('base64'),
    PUBLIC_BASE_URL: 'http://127.0.0.1:3400', DODO_PRODUCT_PACK_STARTER: PRODUCT, DODO_PRODUCT_PACK_STANDARD: 'pdt_madeupstandard', DODO_PRODUCT_PACK_STUDIO: 'pdt_madeupstudio' })) vi.stubEnv(name, value);
  resetStore();
  forgetReconciliation();
  jar.clear();
  jar.set('vc_session', 'usr-demo');
  calls = [];
  paid = {};
  down = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname, [, table, id] = path.split('/');
    calls.push(`${init.method} ${path}`);
    if (down) return json({ code: 'INTERNAL' }, 500);
    if (init.method === 'POST') return json({ session_id: `cks_${calls.length}`, checkout_url: `https://test.checkout.dodopayments.com/session/cks_${calls.length}` });
    if (table === 'checkouts') return json({ id, payment_id: paid[id!]?.payment_id ?? null, payment_status: paid[id!]?.status ?? null });
    const payment = Object.values(paid).find((row) => row.payment_id === id);
    return payment ? json(payment) : json({ code: 'NOT_FOUND' }, 404);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
// The page module is loaded here, outside any test's own time: on a loaded machine its first load took the first test past its limit.
beforeAll(async () => { await import('@/app/(app)/checkout/return/page'); }, 60000);

type Element = { type: unknown; props: { status?: string; children?: Element[]; checkout?: { status: string } } };
const begin = async (userId = 'usr-demo') => (await data.payments.startCheckout(userId, 'pack-starter', '/gallery')).checkoutId;
const record = (checkoutId: string) => paymentStore().records.find((r) => r.checkoutId === checkoutId)!;
const page = async (search: Record<string, string | undefined>): Promise<Element> => {
  const Page = (await import('@/app/(app)/checkout/return/page')).default;
  return (await Page({ searchParams: Promise.resolve({ returnTo: '/gallery', ...search }) })) as Element;
};
/** Dodo's record of the starter pack paid on the checkout's own session. */
function payAtDodo(checkoutId: string, over: Row = {}): void {
  const sessionId = record(checkoutId).sessionId;
  paid[sessionId] = { payment_id: `pay_${sessionId}`, status: 'succeeded', total_amount: 2261, tax: 361, currency: 'USD', metadata: { checkout_id: checkoutId }, checkout_session_id: sessionId,
    product_cart: [{ product_id: PRODUCT, quantity: 1 }], refunds: [], created_at: '2026-10-07T04:00:00Z', ...over };
}
const reads = () => calls.filter((call) => call.startsWith('GET'));
const nameOf = (element: Element) => (element.type as { name?: string }).name;

describe('the return page of a Dodo checkout', () => {
  it('paid: the server reads the payment at Dodo, the credits are written once and the buyer lands on the success page; reloading changes nothing', async () => {
    const id = await begin(), before = await data.ledger.balance('usr-demo');
    payAtDodo(id);
    await expect(page({ checkout: id })).rejects.toThrow('REDIRECT:/checkout/success?purchase=');
    expect(await data.ledger.balance('usr-demo')).toBe(before + 10);
    for (let n = 0; n < 3; n++) await expect(page({ checkout: id, payment_id: 'pay_again', status: 'succeeded' })).rejects.toThrow(`REDIRECT:/checkout/success?purchase=${record(id).purchaseId}`);
    expect(await data.ledger.balance('usr-demo')).toBe(before + 10);
    expect(reads()).toHaveLength(2);
  });

  it('the invoice link of the page after paying is the one Dodo itself answered with: an address in the browser\'s own address is never used', async () => {
    const Success = (await import('@/app/(app)/checkout/success/page')).default;
    const receiptOf = async (purchase: string, extra: Record<string, string>) =>
      ((await Success({ searchParams: Promise.resolve({ purchase, returnTo: '/gallery', ...extra }) })) as unknown as { props: { receipt: { invoiceUrl?: string } } }).props.receipt;
    const claimed = { invoice_url: 'https://test.dodopayments.com/invoices/payments/pay_claimed', invoiceUrl: 'https://elsewhere.example/invoice' };
    const plain = await begin();
    payAtDodo(plain);
    await expect(page({ checkout: plain, ...claimed })).rejects.toThrow('REDIRECT:/checkout/success');
    expect((await receiptOf(record(plain).purchaseId!, claimed)).invoiceUrl).toBeUndefined();
    const real = await begin('usr-demo');
    payAtDodo(real, { invoice_url: 'https://test.dodopayments.com/invoices/payments/pay_real' });
    await expect(page({ checkout: real, ...claimed })).rejects.toThrow('REDIRECT:/checkout/success');
    expect((await receiptOf(record(real).purchaseId!, claimed)).invoiceUrl).toBe('https://test.dodopayments.com/invoices/payments/pay_real');
  });
  it('nothing in the address makes a checkout paid: Dodo says nobody paid, so no credit is written whatever the address claims', async () => {
    const id = await begin(), other = await begin('usr-admin'), before = await data.ledger.balance('usr-demo');
    payAtDodo(other);
    const untouched = JSON.stringify([getStore().ledger, getStore().purchases, paymentStore().records, paymentStore().events]);
    for (const claim of [{ status: 'succeeded' }, { status: 'succeeded', payment_id: 'pay_made_up' }, { status: 'succeeded', payment_id: `pay_${record(other).sessionId}`, checkout_id: other },
      { paid: '1', payment_status: 'succeeded', email: 'someone@example.com' }]) {
      forgetReconciliation();
      const element = await page({ checkout: id, ...claim });
      expect(element.props.children!.map(nameOf)).toEqual(['PollRefresh', 'StoppedCheckoutView']);
      expect(element.props.children![1]!.props.status).toBe('cancelled');
    }
    expect(JSON.stringify([getStore().ledger, getStore().purchases, paymentStore().records, paymentStore().events])).toBe(untouched);
    expect(await data.ledger.balance('usr-demo')).toBe(before);
    // Only the signed-in buyer's own session was asked about, never anything the address named.
    expect(new Set(reads())).toEqual(new Set([`GET /checkouts/${record(id).sessionId}`]));
  });

  it('another account\'s checkout, an unknown one and a signed-out visitor see nothing and cause no question to Dodo', async () => {
    const other = await begin('usr-admin');
    payAtDodo(other);
    calls = [];
    const untouched = JSON.stringify(getStore());
    await expect(page({ checkout: other, status: 'succeeded' })).rejects.toThrow('NOT_FOUND');
    await expect(page({ checkout: 'no-such-checkout', status: 'succeeded' })).rejects.toThrow('NOT_FOUND');
    await expect(page({ checkout: undefined })).rejects.toThrow('NOT_FOUND');
    await expect(checkPayment((() => { const form = new FormData(); form.set('checkoutId', other); return form; })())).rejects.toThrow('NOT_FOUND');
    jar.clear();
    await expect(page({ checkout: other, status: 'succeeded' })).rejects.toThrow('REDIRECT:/login');
    expect(calls).toEqual([]);
    expect(JSON.stringify(getStore())).toBe(untouched);
  });

  it('waiting: a payment still in work, or a Dodo that does not answer, shows the confirming page and writes nothing', async () => {
    const id = await begin(), before = await data.ledger.balance('usr-demo');
    payAtDodo(id, { status: 'processing' });
    expect(nameOf(await page({ checkout: id }))).toBe('ConfirmingView');
    forgetReconciliation();
    down = true;
    expect(nameOf(await page({ checkout: id, status: 'succeeded' }))).toBe('ConfirmingView');
    expect(await data.ledger.balance('usr-demo')).toBe(before);
    expect(record(id).status).toBe('pending');
  });

  it('declined: a card Dodo refused goes on to the failed page, and "Check again" is the same safe read', async () => {
    const id = await begin(), before = await data.ledger.balance('usr-demo');
    payAtDodo(id, { status: 'failed' });
    await expect(page({ checkout: id })).rejects.toThrow('REDIRECT:/checkout/failed?purchase=');
    forgetReconciliation();
    payAtDodo(id);
    const form = new FormData();
    form.set('checkoutId', id);
    await expect(checkPayment(form)).rejects.toThrow(`REDIRECT:/checkout/return?checkout=${id}`);
    expect(await data.ledger.balance('usr-demo')).toBe(before + 10);
  });
});

describe('the Buy form when the payment page cannot be opened', () => {
  it('Dodo not answering sends the buyer back to pricing with a notice, keeps the way back, and charges nothing', async () => {
    down = true;
    const before = await data.ledger.balance('usr-demo');
    const to = await startCheckout('pack-starter', '/generate/pulse-reveal').catch((error: Error) => error.message);
    expect(to).toBe(`REDIRECT:/pricing?notice=payment-unavailable&returnTo=${encodeURIComponent('/generate/pulse-reveal')}`);
    expect(await startCheckout('pack-starter').catch((error: Error) => error.message)).toBe('REDIRECT:/pricing?notice=payment-unavailable');
    expect(await data.ledger.balance('usr-demo')).toBe(before);
    expect(getStore().purchases.filter((p) => p.userId === 'usr-demo' && p.at > new Date(Date.now() - 60000).toISOString())).toEqual([]);
  });

  it('a checkout whose opening call never answered gets the same notice when it is asked for again: it was never opened, so nothing was charged', async () => {
    const open = vi.spyOn(data.payments, 'startCheckout').mockRejectedValue(new Error('checkout-not-opened'));
    expect(await startCheckout('pack-starter', '/generate/pulse-reveal').catch((error: Error) => error.message)).toBe(`REDIRECT:/pricing?notice=payment-unavailable&returnTo=${encodeURIComponent('/generate/pulse-reveal')}`);
    open.mockRejectedValue(new Error('made-up failure'));
    expect(await startCheckout('pack-starter').catch((error: Error) => error.message)).toBe('made-up failure');
    open.mockRestore();
  });
});
