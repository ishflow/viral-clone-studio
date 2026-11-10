import { requireUser } from '@/core/session/guards';
import { InvoiceSheet, loadInvoice } from '@/features/checkout';
import { recordTitle } from '@/core/i18n/page-title';
import { data } from '@/data';

export const generateMetadata = async ({ params }: { params: Promise<{ id: string }> }) =>
  recordTitle('invoice', async (viewer) => (viewer ? data.invoices.get((await params).id, viewer.id) : true));

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/invoices/${encodeURIComponent(id)}`);
  const { invoice, customerName, customerEmail } = await loadInvoice(user, id);
  return <InvoiceSheet invoice={invoice} customerName={customerName} customerEmail={customerEmail} />;
}
