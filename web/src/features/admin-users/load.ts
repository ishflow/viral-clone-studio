import { notFound } from 'next/navigation';
import { requireAdmin } from '@/core/session/guards';
import { data } from '@/data';
import type { UserListRow } from './UsersView';
import type { UserDetailProps } from './UserDetailView';
import { parseUsersQuery } from './query';

const toListRow = ({ user, balance, paidTotal, creditsSpent, videos }: Awaited<ReturnType<typeof data.admin.users>>[number]): UserListRow => ({
  id: user.id, email: user.email, name: user.name, joinedAt: user.joinedAt, lastActiveAt: user.lastActiveAt,
  verified: user.emailVerified, blocked: user.blocked, balance, paidTotal, creditsSpent, videos,
});

/** Users for the list page and the CSV export: the same search and filter. Admin only. */
export async function loadUsers(params: Record<string, string | string[] | undefined>) {
  await requireAdmin();
  const query = parseUsersQuery(params);
  const [rows, all] = await Promise.all([data.admin.users({ filter: query.filter, search: query.q || undefined }), data.admin.users({})]);
  return { query, rows, list: rows.map(toListRow), total: all.length };
}

/** One user with the extra lookups the tables need (invoice numbers, template formats). Unknown id → 404. */
export async function loadUserDetail(id: string): Promise<UserDetailProps> {
  const admin = await requireAdmin();
  const detail = await data.admin.user(id);
  if (!detail) notFound();
  const [invoices, templates] = await Promise.all([data.invoices.listFor(id), data.admin.templates({})]);
  const numberOf = new Map(invoices.map((invoice) => [invoice.id, invoice.number]));
  const formatOf = new Map(templates.map((template) => [template.id, template.format]));
  const { user } = detail;
  return {
    user: { id: user.id, email: user.email, name: user.name, joinedAt: user.joinedAt, lastActiveAt: user.lastActiveAt, verified: user.emailVerified, blocked: user.blocked, block: user.block ? { at: user.block.at, reason: user.block.reason } : null },
    balance: detail.balance, paidTotal: detail.paidTotal, creditsBought: detail.creditsBought, creditsSpent: detail.creditsSpent, videos: detail.videos,
    purchases: detail.purchases.map((p) => ({ id: p.id, at: p.at, packName: p.packName, credits: p.credits, amount: p.amount, status: p.status, invoiceId: p.invoiceId, invoiceNumber: p.invoiceId ? (numberOf.get(p.invoiceId) ?? null) : null, invoiceUrl: p.invoiceUrl ?? null })),
    jobs: detail.jobs.map((j) => ({ id: j.id, startedAt: j.startedAt, templateTitle: j.templateTitle, format: formatOf.get(j.templateId) ?? null, quality: j.input.quality, language: j.input.language, credits: j.credits, status: j.status })),
    ledger: detail.ledger,
    isSelf: admin.id === id,
  };
}
