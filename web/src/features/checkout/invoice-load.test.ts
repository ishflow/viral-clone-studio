// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

import { data } from '@/data';
import { resetStore } from '@/data/mock/store';
import { loadInvoice } from './invoice';

beforeEach(resetStore);

async function invoiceOf(userId: string) {
  const { checkoutId } = await data.payments.startCheckout(userId, 'pack-standard', '/gallery');
  const purchase = await data.payments.complete(checkoutId, 'paid');
  return purchase.invoiceId!;
}

describe('loadInvoice', () => {
  it('opens the own invoice with the buyer email', async () => {
    const id = await invoiceOf('usr-demo');
    const user = (await data.auth.getUser('usr-demo'))!;
    const loaded = await loadInvoice(user, id);
    expect(loaded.invoice.id).toBe(id);
    expect(loaded.customerEmail).toBe('demo@viralclone.app');
    expect(loaded.customerName).toBe(user.name);
  });
  it("is 404 for another user's invoice", async () => {
    const id = await invoiceOf('usr-demo');
    const other = (await data.auth.getUser('usr-new'))!;
    await expect(loadInvoice(other, id)).rejects.toThrow('NOT_FOUND');
  });
  it('is 404 for an unknown id', async () => {
    const user = (await data.auth.getUser('usr-demo'))!;
    await expect(loadInvoice(user, 'nope')).rejects.toThrow('NOT_FOUND');
  });
  it('lets an admin open any invoice, showing the buyer email', async () => {
    const id = await invoiceOf('usr-demo');
    const admin = (await data.auth.getUser('usr-admin'))!;
    expect((await loadInvoice(admin, id)).customerEmail).toBe('demo@viralclone.app');
  });
});
