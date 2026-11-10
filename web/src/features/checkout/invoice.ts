import { notFound } from 'next/navigation';
import { data } from '@/data';
import type { Invoice, User } from '@/data/ports';

/** The invoice and its buyer's name and email. Another user's invoice is a 404 (the store lets an admin through). */
export async function loadInvoice(viewer: User, id: string): Promise<{ invoice: Invoice; customerName: string; customerEmail: string }> {
  const invoice = await data.invoices.get(id, viewer.id);
  if (!invoice) notFound();
  const buyer = invoice.userId === viewer.id ? viewer : await data.auth.getUser(invoice.userId);
  return { invoice, customerName: buyer?.name ?? '', customerEmail: buyer?.email ?? '' };
}
