// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
const cookieStore = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  set: vi.fn((name: string, value: string) => void jar.set(name, value)),
  delete: vi.fn((name: string) => void jar.delete(name)),
};
vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

import { GET as getStart } from '@/app/(app)/checkout/start/route';
import { data } from '@/data';
import { getStore, resetStore } from '@/data/mock/store';
import { settleCheckout, startCheckout } from './actions';
import { loadResult } from './queries';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const redirectOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return (error as Error).message.replace('REDIRECT:', '');
  }
  return null;
};

beforeEach(() => {
  resetStore();
  jar.clear();
  vi.clearAllMocks();
  jar.set('vc_session', 'usr-demo');
});

describe('GET /checkout/start', () => {
  it('opens no checkout (a link can be prefetched): it only sends an old address to the pricing page', async () => {
    const res = await getStart();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/pricing');
    expect(getStore().checkouts).toHaveLength(0);
  });
});

describe('startCheckout (the Buy form, a POST)', () => {
  it('does not keep a returnTo longer than any real path (B1)', async () => {
    const to = await redirectOf(() => startCheckout('pack-standard', `/gallery?x=${'a'.repeat(5000)}`));
    expect(new URL(to!, 'http://x').searchParams.get('returnTo')).toBe('/gallery');
    expect(getStore().checkouts.every((c) => c.returnTo.length <= 2000)).toBe(true);
  });
  it('a loop cannot open checkouts without end: the 21st unfinished one of a day is not opened, and another buyer is not affected (B1)', async () => {
    for (let i = 0; i < 20; i++) expect(await redirectOf(() => startCheckout('pack-standard'))).toMatch(/^\/checkout\/mock\//);
    expect(await redirectOf(() => startCheckout('pack-standard'))).toBe('/pricing?notice=too-many-checkouts');
    expect(getStore().checkouts).toHaveLength(20);
    jar.set('vc_session', 'usr-paying');
    expect(await redirectOf(() => startCheckout('pack-standard'))).toMatch(/^\/checkout\/mock\//);
  });
  it('a checkout left unfinished stops counting a day after it was opened: leaving the payment page does not close the shop for good', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
      for (let i = 0; i < 20; i++) await redirectOf(() => startCheckout('pack-standard'));
      vi.setSystemTime(new Date('2026-10-02T09:59:59Z'));
      expect(await redirectOf(() => startCheckout('pack-standard'))).toBe('/pricing?notice=too-many-checkouts');
      vi.setSystemTime(new Date('2026-10-02T10:00:01Z'));
      expect(await redirectOf(() => startCheckout('pack-standard'))).toMatch(/^\/checkout\/mock\//);
    } finally {
      vi.useRealTimers();
    }
  });
  it('a buyer who finishes every checkout (pays, or cancels) is never refused, however many there are', async () => {
    for (let i = 0; i < 25; i++) {
      const to = await redirectOf(() => startCheckout('pack-standard'));
      expect(to).toMatch(/^\/checkout\/mock\//);
      const checkoutId = new URL(to!, 'http://x').pathname.split('/').pop()!;
      await redirectOf(() => settleCheckout(form({ checkoutId, outcome: i % 2 ? 'paid' : 'cancelled' })));
    }
    expect(getStore().checkouts).toHaveLength(25);
  });
  it('opens a checkout and redirects to the provider page, keeping returnTo and the pack', async () => {
    const to = new URL((await redirectOf(() => startCheckout('pack-standard', '/templates/tpl-eye/generate')))!, 'http://x');
    expect(to.pathname).toMatch(/^\/checkout\/mock\/[0-9a-f-]{36}$/);
    expect(to.searchParams.get('returnTo')).toBe('/templates/tpl-eye/generate');
    expect(to.searchParams.has('pack')).toBe(false);
    const checkout = await data.payments.getCheckout(to.pathname.split('/').pop()!, 'usr-demo');
    expect(checkout).toMatchObject({ status: 'open', returnTo: '/templates/tpl-eye/generate', pack: { id: 'pack-standard' } });
  });
  it('keeps the way back to a stopped job', async () => {
    const to = new URL((await redirectOf(() => startCheckout('pack-starter', '/jobs/job-demo-stopped')))!, 'http://x');
    expect(to.searchParams.get('returnTo')).toBe('/jobs/job-demo-stopped');
  });
  it('replaces a missing or unsafe returnTo with the gallery', async () => {
    for (const bad of [undefined, 'https://evil.example', '//evil.example', 7]) {
      const to = await redirectOf(() => (startCheckout as (pack: string, returnTo: unknown) => Promise<void>)('pack-standard', bad));
      expect(new URL(to!, 'http://x').searchParams.get('returnTo')).toBe('/gallery');
    }
  });
  it('sends an unknown pack back to pricing and opens nothing', async () => {
    expect(await redirectOf(() => startCheckout('nope'))).toBe('/pricing');
    expect(await redirectOf(() => (startCheckout as (pack: unknown) => Promise<void>)(undefined))).toBe('/pricing');
    expect(getStore().checkouts).toHaveLength(0);
  });
  it('sends a signed-out visitor to login and back to pricing (with the way back), and opens nothing', async () => {
    jar.clear();
    expect(await redirectOf(() => startCheckout('pack-standard'))).toBe(`/login?next=${encodeURIComponent('/pricing')}`);
    expect(await redirectOf(() => startCheckout('pack-standard', '/jobs/job-1'))).toBe(`/login?next=${encodeURIComponent('/pricing?returnTo=%2Fjobs%2Fjob-1')}`);
    expect(getStore().checkouts).toHaveLength(0);
  });
  it('sends a user whose email is not verified to /verify-email, and opens nothing', async () => {
    jar.set('vc_session', 'usr-unverified');
    expect(await redirectOf(() => startCheckout('pack-standard'))).toBe('/verify-email');
    expect(getStore().checkouts).toHaveLength(0);
  });
});

describe('settleCheckout', () => {
  const begin = async (returnTo = '/gallery') => (await data.payments.startCheckout('usr-demo', 'pack-standard', returnTo)).checkoutId;
  const balance = () => data.ledger.balance('usr-demo');

  it('pay: adds the credits and opens the success page with the purchase', async () => {
    const before = await balance();
    const id = await begin('/templates/tpl-eye/generate');
    const to = await redirectOf(() => settleCheckout(form({ checkoutId: id, outcome: 'paid' })));
    const url = new URL(to!, 'http://x');
    expect(url.pathname).toBe('/checkout/return');
    expect(url.searchParams.get('checkout')).toBe(id);
    expect(url.searchParams.get('returnTo')).toBe('/templates/tpl-eye/generate');
    const stored = await data.payments.getCheckout(id, 'usr-demo');
    expect(stored?.status).toBe('paid');
    const purchase = (await data.payments.purchasesFor('usr-demo')).find((p) => p.id === stored?.purchaseId);
    expect(purchase).toMatchObject({ status: 'paid', packName: 'Standard' });
    expect(await balance()).toBe(before + purchase!.credits);
  });
  it('decline: opens the failed page and leaves the balance alone', async () => {
    const before = await balance();
    const id = await begin();
    const to = await redirectOf(() => settleCheckout(form({ checkoutId: id, outcome: 'declined', returnTo: '/gallery' })));
    expect(new URL(to!, 'http://x').pathname).toBe('/checkout/return');
    expect((await data.payments.getCheckout(id, 'usr-demo'))?.status).toBe('declined');
    expect(await balance()).toBe(before);
  });
  it('paying twice with the same checkout adds credits once', async () => {
    const before = await balance();
    const invoicesBefore = (await data.invoices.listFor('usr-demo')).length;
    const id = await begin();
    const input = form({ checkoutId: id, outcome: 'paid', returnTo: '/gallery' });
    const first = await redirectOf(() => settleCheckout(input));
    const second = await redirectOf(() => settleCheckout(input));
    expect(second).toBe(first);
    expect(await balance()).toBe(before + 30);
    expect(await data.invoices.listFor('usr-demo')).toHaveLength(invoicesBefore + 1);
  });
  it('a declined checkout stays declined when paid afterwards', async () => {
    const before = await balance();
    const id = await begin();
    await redirectOf(() => settleCheckout(form({ checkoutId: id, outcome: 'declined', returnTo: '/gallery' })));
    const to = await redirectOf(() => settleCheckout(form({ checkoutId: id, outcome: 'paid', returnTo: '/gallery' })));
    expect(new URL(to!, 'http://x').pathname).toBe('/checkout/return');
    expect((await data.payments.getCheckout(id, 'usr-demo'))?.status).toBe('declined');
    expect(await balance()).toBe(before);
  });
  it("refuses another user's checkout and changes nothing for the owner", async () => {
    const id = await begin();
    const balanceBefore = await balance();
    const ledgerBefore = (await data.ledger.entries('usr-demo')).length;
    const purchasesBefore = (await data.payments.purchasesFor('usr-demo')).length;
    jar.set('vc_session', 'usr-new');
    for (const outcome of ['paid', 'declined']) {
      await expect(settleCheckout(form({ checkoutId: id, outcome }))).rejects.toThrow('NOT_FOUND');
    }
    expect(await balance()).toBe(balanceBefore);
    expect((await data.ledger.entries('usr-demo')).length).toBe(ledgerBefore);
    expect((await data.payments.purchasesFor('usr-demo')).length).toBe(purchasesBefore);
    expect((await data.payments.getCheckout(id, 'usr-demo'))?.status).toBe('open');
  });
  it('takes returnTo from the stored checkout, not from the form', async () => {
    const id = await begin('/templates/tpl-eye/generate');
    const to = await redirectOf(() => settleCheckout(form({ checkoutId: id, outcome: 'paid', returnTo: 'https://evil.example' })));
    expect(new URL(to!, 'http://x').searchParams.get('returnTo')).toBe('/templates/tpl-eye/generate');
  });
  it('sends a signed-out visitor to login', async () => {
    jar.clear();
    await expect(settleCheckout(form({ checkoutId: 'c-1', outcome: 'paid' }))).rejects.toThrow(`REDIRECT:/login?next=${encodeURIComponent('/checkout/mock/c-1')}`);
  });
  it('sends a user whose email is not verified to /verify-email and settles nothing', async () => {
    const id = await begin();
    jar.set('vc_session', 'usr-unverified');
    await expect(settleCheckout(form({ checkoutId: id, outcome: 'paid' }))).rejects.toThrow('REDIRECT:/verify-email');
    expect((await data.payments.getCheckout(id, 'usr-demo'))?.status).toBe('open');
  });
});

describe('loadResult (what a result page shows)', () => {
  const demo = async () => (await data.auth.getUser('usr-demo'))!;
  const settle = async (outcome: 'paid' | 'declined') => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-standard', '/gallery');
    return data.payments.complete(checkoutId, outcome);
  };

  it('a paid purchase on the success page: the purchase, the balance of now and a safe way back', async () => {
    const before = await data.ledger.balance('usr-demo');
    const purchase = await settle('paid');
    const result = await loadResult(await demo(), { purchase: purchase.id, returnTo: 'https://evil.example' }, 'success');
    expect(result).toMatchObject({ purchase: { id: purchase.id, status: 'paid' }, balance: before + purchase.credits, returnTo: '/gallery', draft: null });
  });

  it('the video waiting behind the way back comes along', async () => {
    const purchase = await settle('paid');
    const result = await loadResult(await demo(), { purchase: purchase.id, returnTo: '/templates/tpl-eye/generate' }, 'success');
    expect(result.returnTo).toBe('/templates/tpl-eye/generate');
    expect(result.draft).toMatchObject({ title: (await data.catalog.get('tpl-eye', 'usr-demo'))!.title });
  });

  it('a paid purchase opened on the failed page goes to the success page, with the way back', async () => {
    const purchase = await settle('paid');
    const to = await redirectOf(async () => loadResult(await demo(), { purchase: purchase.id, returnTo: '/videos' }, 'failed'));
    expect(to).toBe(`/checkout/success?purchase=${purchase.id}&returnTo=%2Fvideos`);
  });

  it('a purchase that was not paid opened on the success page goes to the failed page', async () => {
    const purchase = await settle('declined');
    const to = await redirectOf(async () => loadResult(await demo(), { purchase: purchase.id }, 'success'));
    expect(to).toBe(`/checkout/failed?purchase=${purchase.id}&returnTo=%2Fgallery`);
  });

  it("another user's purchase, or no purchase, is not found", async () => {
    const purchase = await settle('paid');
    const other = (await data.auth.getUser('usr-paying'))!;
    await expect(loadResult(other, { purchase: purchase.id }, 'success')).rejects.toThrow('NOT_FOUND');
    await expect(loadResult(await demo(), {}, 'success')).rejects.toThrow('NOT_FOUND');
  });
});

describe('settleCheckout: the provider answers that are not final (B4)', () => {
  const begin = async (returnTo = '/gallery') => (await data.payments.startCheckout('usr-demo', 'pack-standard', returnTo)).checkoutId;

  it('pending, cancelled and expired go to the return route and write no purchase and no credits', async () => {
    const before = await data.ledger.balance('usr-demo');
    const purchases = (await data.payments.purchasesFor('usr-demo')).length;
    for (const outcome of ['pending', 'cancelled', 'expired'] as const) {
      const id = await begin();
      const to = await redirectOf(() => settleCheckout(form({ checkoutId: id, outcome })));
      expect(new URL(to!, 'http://x').pathname).toBe('/checkout/return');
      expect((await data.payments.getCheckout(id, 'usr-demo'))?.status).toBe(outcome);
    }
    expect(await data.ledger.balance('usr-demo')).toBe(before);
    expect((await data.payments.purchasesFor('usr-demo')).length).toBe(purchases);
  });

  it('a cancelled checkout takes no payment afterwards, and the answer is still the return route', async () => {
    const id = await begin();
    await redirectOf(() => settleCheckout(form({ checkoutId: id, outcome: 'cancelled' })));
    const to = await redirectOf(() => settleCheckout(form({ checkoutId: id, outcome: 'paid' })));
    expect(new URL(to!, 'http://x').pathname).toBe('/checkout/return');
    expect((await data.payments.getCheckout(id, 'usr-demo'))?.status).toBe('cancelled');
  });
});

describe('the return route', () => {
  const begin = async () => (await data.payments.startCheckout('usr-demo', 'pack-standard', '/gallery')).checkoutId;
  const page = async (checkout: string | undefined) => {
    const Page = (await import('@/app/(app)/checkout/return/page')).default;
    const element = await Page({ searchParams: Promise.resolve({ checkout, returnTo: '/gallery' }) });
    return element;
  };

  it('paid and declined checkouts go on to their result pages', async () => {
    const paid = await begin();
    await data.payments.complete(paid, 'paid');
    const purchase = (await data.payments.getCheckout(paid, 'usr-demo'))!.purchaseId;
    await expect(page(paid)).rejects.toThrow(`REDIRECT:/checkout/success?purchase=${purchase}`);
    const declined = await begin();
    await data.payments.complete(declined, 'declined');
    await expect(page(declined)).rejects.toThrow('REDIRECT:/checkout/failed?purchase=');
  });

  it('pending shows the confirming page, cancelled and expired their own pages; an unknown or foreign checkout is a 404', async () => {
    const id = await begin();
    await data.payments.notify(id, 'pending');
    const element = (await page(id)) as { type: { name: string }; props: { checkout: { status: string } } };
    expect(element.type.name).toBe('ConfirmingView');
    const gone = await begin();
    await data.payments.notify(gone, 'cancelled');
    expect(((await page(gone)) as { type: { name: string }; props: { status: string } }).props.status).toBe('cancelled');
    await expect(page('nope')).rejects.toThrow('NOT_FOUND');
    jar.set('vc_session', 'usr-new');
    await expect(page(id)).rejects.toThrow('NOT_FOUND');
  });
});

describe('paid mode (VC_PROVIDER=magnific): no fake money (C2)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('settleCheckout refuses: complete and notify are not called, the checkout stays open', async () => {
    const id = (await data.payments.startCheckout('usr-demo', 'pack-standard', '/gallery')).checkoutId;
    const complete = vi.spyOn(data.payments, 'complete');
    const notify = vi.spyOn(data.payments, 'notify');
    vi.stubEnv('VC_PROVIDER', 'magnific');
    for (const outcome of ['paid', 'declined', 'pending']) {
      expect(await redirectOf(() => settleCheckout(form({ checkoutId: id, outcome })))).toBe('/pricing');
    }
    expect(complete).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect((await data.payments.getCheckout(id, 'usr-demo'))?.status).toBe('open');
  });

  it('the provider page is a 404 in paid mode and shows the checkout otherwise', async () => {
    const id = (await data.payments.startCheckout('usr-demo', 'pack-standard', '/gallery')).checkoutId;
    const Page = (await import('@/app/(app)/checkout/mock/[checkoutId]/page')).default;
    expect(await Page({ params: Promise.resolve({ checkoutId: id }) })).toBeTruthy();
    vi.stubEnv('VC_PROVIDER', 'magnific');
    await expect(Page({ params: Promise.resolve({ checkoutId: id }) })).rejects.toThrow('NOT_FOUND');
  });
});
