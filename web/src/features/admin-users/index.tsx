import { loadUserDetail, loadUsers } from './load';
import { UserDetailView } from './UserDetailView';
import { UsersView } from './UsersView';

export { usersCsv } from './csv';
export { loadUsers } from './load';

export async function AdminUsers({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { query, list, total } = await loadUsers(await searchParams);
  return <UsersView rows={list} filter={query.filter} q={query.q} total={total} />;
}

export async function AdminUserDetail({ id }: { id: string }) {
  return <UserDetailView {...await loadUserDetail(id)} />;
}
