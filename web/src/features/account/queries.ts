import { data } from '@/data';
import type { User } from '@/data/ports';
import { readTheme } from '@/core/theme/theme';
import type { AccountData } from './AccountView';

const ACTIVITY_LIMIT = 20;

export async function loadAccount(user: User, themeCookie: string | undefined): Promise<AccountData> {
  const [balance, held, entries, purchases, packs, jobs] = await Promise.all([
    data.ledger.balance(user.id),
    data.ledger.held(user.id),
    data.ledger.entries(user.id),
    data.payments.purchasesFor(user.id),
    data.payments.packs(),
    data.jobs.listFor(user.id),
  ]);
  return {
    isAdmin: user.role === 'admin', name: user.name, email: user.email, theme: readTheme(themeCookie), balance,
    entries: entries.slice(0, ACTIVITY_LIMIT), packNames: packs.map((p) => p.name), purchases, held,
    authProvider: user.authProvider, pendingEmail: user.pendingEmail,
    jobRunning: jobs.some((job) => job.status === 'running' || job.status === 'queued'),
  };
}
