import { requireAdmin } from '@/core/session/guards';
import { loadRevenue, purchasesCsv } from '@/features/admin-revenue';

/** The purchases of the chosen period as a download; admin only (anyone else gets the 404). */
export async function GET(request: Request) {
  await requireAdmin();
  const { purchases } = await loadRevenue(Object.fromEntries(new URL(request.url).searchParams));
  return new Response(purchasesCsv(purchases), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="purchases.csv"', 'cache-control': 'no-store' },
  });
}
