import type { AdminUserRow } from '@/data/ports';
import { toCsv } from '@/shared/lib/csv';

/** The user list as a file. Machine headers, no money columns (money is undecided). */
export function usersCsv(rows: AdminUserRow[]): string {
  return toCsv([
    ['email', 'name', 'joined', 'verified', 'balance', 'credits_spent', 'videos', 'status'],
    ...rows.map(({ user, balance, creditsSpent, videos }) => [
      user.email, user.name, user.joinedAt.slice(0, 10), user.emailVerified ? 'yes' : 'no', balance, creditsSpent, videos, user.blocked ? 'blocked' : 'active',
    ]),
  ]);
}
