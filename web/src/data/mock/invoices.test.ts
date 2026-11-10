// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { invoiceNumber } from './invoices';
import { getStore, resetStore } from './store';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('fake invoice store', () => {
  it('listFor returns only that user\'s invoices, newest first', async () => {
    const invoices = await data.invoices.listFor('usr-paying');
    expect(invoices.map((invoice) => [invoice.id, invoice.packName, invoice.credits])).toEqual([
      ['inv-paying-studio', 'Studio', 100],
      ['inv-paying-starter', 'Starter', 10],
    ]);
    expect(invoices.every((invoice) => invoice.userId === 'usr-paying')).toBe(true);
    expect(await data.invoices.listFor('usr-new')).toEqual([]);
  });

  it('get returns the invoice to its owner', async () => {
    expect(await data.invoices.get('inv-demo-standard', 'usr-demo')).toMatchObject({
      id: 'inv-demo-standard', userId: 'usr-demo', purchaseId: 'pur-demo-standard', packName: 'Standard', credits: 30,
    });
  });

  it('get of another user\'s invoice is null', async () => {
    expect(await data.invoices.get('inv-demo-standard', 'usr-paying')).toBeNull();
    expect(await data.invoices.get('inv-demo-standard', 'nobody')).toBeNull();
    expect(await data.invoices.get('inv-missing', 'usr-demo')).toBeNull();
  });

  it('an admin can open any invoice', async () => {
    expect((await data.invoices.get('inv-demo-standard', 'usr-admin'))?.id).toBe('inv-demo-standard');
  });

  it('invoiceNumber gives VC- and a running number of six digits', () => {
    expect(invoiceNumber(1)).toBe('VC-000001');
    expect(invoiceNumber(123)).toBe('VC-000123');
  });

  it('the invoices of the fixtures are numbered 1 to 4 in time order, and a new invoice gets the next number', async () => {
    const byDate = [...getStore().invoices].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    expect(byDate.map((invoice) => invoice.number)).toEqual([1, 2, 3, 4].map(invoiceNumber));

    const { checkoutId } = await data.payments.startCheckout('usr-new', 'pack-starter', '/gallery');
    const purchase = await data.payments.complete(checkoutId, 'paid');
    expect((await data.invoices.get(purchase.invoiceId ?? '', 'usr-new'))?.number).toBe(invoiceNumber(5));
  });
});
