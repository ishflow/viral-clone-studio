import { data } from '@/data';
import { RULES, type Job, type User } from '@/data/ports';
import { ResultView, type ResultExtras } from './ResultView';
import type { JobTemplate } from './RunningView';

const DAY_MS = 86_400_000;

/** What the result page needs besides the job: the report window, the balance, and the price of each stopped variant (only while its images are kept). */
async function extrasOf(job: Job, user: User): Promise<ResultExtras> {
  const finished = job.finishedAt ? Date.parse(job.finishedAt) : NaN;
  const reportOpen = Number.isFinite(finished) && Date.now() - finished <= RULES.reportDays * DAY_MS;
  const stopped = job.imagesStored ? job.variants.filter((variant) => variant.status === 'stopped') : [];
  const costs = await Promise.all(stopped.map(async (variant) => [variant.id, await data.jobs.variantCost(job.id, user.id, variant.id).catch(() => null)] as const));
  return {
    reportOpen,
    balance: await data.ledger.balance(user.id),
    variantCosts: Object.fromEntries(costs.filter((entry): entry is readonly [string, number] => entry[1] !== null)),
  };
}

/** `/jobs/[id]` of a delivered job: the result with what only the server knows. */
export async function ResultScreen({ job, template, user }: { job: Job; template: JobTemplate; user: User }) {
  return <ResultView job={job} template={template} extras={await extrasOf(job, user)} />;
}
