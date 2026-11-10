import { loadJob } from './load';
import { getI18n } from '@/core/i18n/server';
import { personSwapOpen } from '@/core/person-swap';
import { getBalanceLabel } from '@/core/session/balance';
import { data } from '@/data';
import type { Job, Template, User } from '@/data/ports';
import { ClosedView } from './ClosedView';
import { BalanceNow } from './HeaderBalance';
import { QueuedView } from './QueuedView';
import { ResultScreen } from './ResultScreen';
import { RunningView, type JobTemplate } from './RunningView';
import { StoppedView } from './StoppedView';
import { secondsSince } from './steps';
import { waitsInLine } from './waiting';

const asJobTemplate = (job: Job, template: Template | null): JobTemplate => ({
  id: job.templateId,
  title: job.templateTitle,
  image: template?.image ?? job.variants[0]?.image ?? '',
  video: template?.video ?? null,
  seconds: template?.seconds ?? 0,
  openable: template !== null,
  shotFrames: template?.shots.map((shot) => shot.image ?? ''),
});

/** Roughly how long is left: the estimate for the whole job, minus the share of the stages that is done. */
function minutesLeft(job: Job, total: number): number {
  const share = job.steps.reduce((sum, step) => sum + (step.status === 'done' ? 1 : step.total > 0 ? step.done / step.total : 0), 0) / Math.max(1, job.steps.length);
  return Math.max(1, Math.ceil(total * (1 - share)));
}

/** The view follows the job's status. */
async function screenOf(user: User, job: Job, template: Template | null) {
  const shown = asJobTemplate(job, template);
  if (job.status === 'done' && job.variants.length > 0) return <ResultScreen job={job} template={shown} user={user} />;
  if (job.status === 'stopped') return <StoppedView job={job} quote={await data.jobs.resumeQuote(job.id, user.id)} seconds={shown.seconds} swapOpen={await personSwapOpen()} />;
  if (job.status === 'closed') return <ClosedView job={job} balance={await data.ledger.balance(user.id)} swapOpen={await personSwapOpen()} />;
  if (waitsInLine(job)) return <QueuedView job={job} seconds={shown.seconds} />;
  const total = (await data.jobs.estimate(user.id, job.input).catch(() => null))?.minutes ?? 1;
  const elapsedSeconds = secondsSince(job.startedAt);
  return <RunningView job={job} template={shown} minutesLeft={minutesLeft(job, total)} elapsedSeconds={elapsedSeconds} />;
}

/**
 * `/jobs/[id]`: one route. Reading the job is what returns the credits (or the free video) of one that stopped, so the balance is read
 * last, with the owner as stored now, and the header is told (see `BalanceNow`).
 */
export async function JobView({ id }: { id: string }) {
  const { user, job, template } = await loadJob(id);
  const screen = await screenOf(user, job, template);
  const { t } = await getI18n();
  return (
    <>
      {screen}
      <BalanceNow label={await getBalanceLabel((await data.auth.getUser(user.id)) ?? user, t)} />
    </>
  );
}
