import { requireAdmin } from '@/core/session/guards';
import { data } from '@/data';
import type { JobStatus } from '@/data/ports';
import type { OverviewSignup } from './OverviewView';
import { parsePeriod } from '@/core/period';
import { readSeries } from '../admin-common/series';
import { providerOutOfCredits } from '../admin-common/credits';

const LATEST = 5;
/** A queued job counts as running, a closed one as stopped (the overview shows three states). */
const firstVideoOf = (status: JobStatus | undefined): OverviewSignup['firstVideo'] =>
  status === undefined ? 'none' : status === 'queued' ? 'running' : status === 'closed' ? 'stopped' : status;

/** Everything `/admin` shows for one period. Admin only. */
export async function loadOverview(rawPeriod: string | string[] | undefined) {
  await requireAdmin();
  const period = parsePeriod(rawPeriod);
  const [numbers, allPurchases, users, jobs, chart] = await Promise.all([
    data.admin.overview(period), data.admin.purchases(period), data.admin.users({}), data.admin.jobs({}), readSeries(() => data.admin.dailySeries(period)),
  ]);
  const emailOf = new Map(users.map((row) => [row.user.id, row.user.email]));
  const firstJob = (userId: string) => jobs.filter((job) => job.userId === userId).sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
  const signups: OverviewSignup[] = users.slice(0, LATEST).map(({ user }) => ({
    id: user.id, joinedAt: user.joinedAt, email: user.email, verified: user.emailVerified, firstVideo: firstVideoOf(firstJob(user.id)?.status),
  }));
  const purchases = allPurchases.filter((p) => p.status !== 'not-completed').slice(0, LATEST).map((p) => ({
    id: p.id, at: p.at, userId: p.userId, email: emailOf.get(p.userId) ?? null, packName: p.packName, amount: p.amount,
    refunded: p.status === 'refunded' || p.status === 'refund-sent',
  }));
  return { period, numbers, purchases, signups, chart, outOfCredits: providerOutOfCredits(jobs) };
}
