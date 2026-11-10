import { requireAdmin } from '@/core/session/guards';
import { loadUsers, usersCsv } from '@/features/admin-users';

/** The user list as a download. Same search and filter as the page; admin only (anyone else gets the 404). */
export async function GET(request: Request) {
  await requireAdmin();
  const { rows } = await loadUsers(Object.fromEntries(new URL(request.url).searchParams));
  return new Response(usersCsv(rows), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="users.csv"', 'cache-control': 'no-store' },
  });
}
