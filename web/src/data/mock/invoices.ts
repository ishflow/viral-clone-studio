import type { InvoiceStore } from '../ports';
import { findUser, getStore, newestFirst } from './store';

/** Invoice numbers of the fake: VC- and a running number. */
export function invoiceNumber(sequence: number): string {
  return `VC-${String(sequence).padStart(6, '0')}`;
}

export const invoices: InvoiceStore = {
  /** Newest first. */
  async listFor(userId) {
    const own = getStore().invoices.filter((invoice) => invoice.userId === userId);
    return newestFirst(own, (invoice) => invoice.date).map((invoice) => ({ ...invoice }));
  },

  /** The owner, or an admin (the panel links to the invoice of every purchase); null for anyone else. */
  async get(id, viewerId) {
    const invoice = getStore().invoices.find((item) => item.id === id);
    if (!invoice) return null;
    const allowed = invoice.userId === viewerId || findUser(viewerId)?.role === 'admin';
    return allowed ? { ...invoice } : null;
  },
};
