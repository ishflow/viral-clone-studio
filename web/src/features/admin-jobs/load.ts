import type { EngineQueue, JobStatus, JobStep, Format, Quality, StopDetail, StopReason } from '@/data/ports';
import { requireAdmin } from '@/core/session/guards';
import { data } from '@/data';
import { parseJobsQuery, periodStart, type JobFilter, type JobPeriod } from './query';

export type JobRow = {
  id: string; userId: string; email: string; templateTitle: string; startedAt: string; finishedAt: string | null;
  format: Format | null; quality: Quality; language: string; credits: number; cost: string | null;
  status: JobStatus; stoppedReason: StopReason | null; stoppedDetail: StopDetail | null; steps: JobStep[];
  creditsReturned: number; queuePosition: number | null; engineQueue: EngineQueue | null; balance: number;
};
export type JobsData = {
  rows: JobRow[]; total: number; selected: JobRow | null; status: JobFilter; q: string; period: JobPeriod;
  tiles: { running: number; done: number; stopped: number; averageSeconds: number | null; cost: string | null };
};

/** A job the site holds as running whose run the engine has not begun: in a line, not running. */
const waiting = (job: { status: JobStatus; engineQueue?: EngineQueue | null }) => job.status === 'running' && Boolean(job.engineQueue);

/** Jobs for `/admin/jobs`: filtered by search, status and period; tiles for the period. Admin only. */
export async function loadJobs(params: Record<string, string | string[] | undefined>, now = new Date()): Promise<JobsData> {
  await requireAdmin();
  const query = parseJobsQuery(params);
  const [all, users, templates] = await Promise.all([
    data.admin.jobs({}),
    data.admin.users({}),
    data.admin.templates({}),
  ]);
  const emailOf = new Map(users.map((row) => [row.user.id, row.user.email]));
  const balanceOf = new Map(users.map((row) => [row.user.id, row.balance]));
  const formatOf = new Map(templates.map((template) => [template.id, template.format]));
  const since = periodStart(query.period, now);
  const needle = query.q.toLowerCase();
  const toRow = (job: (typeof all)[number]): JobRow => ({
    id: job.id, userId: job.userId, email: emailOf.get(job.userId) ?? '', templateTitle: job.templateTitle, startedAt: job.startedAt,
    finishedAt: job.finishedAt, format: formatOf.get(job.templateId) ?? null, quality: job.input.quality, language: job.input.language,
    credits: job.credits, cost: null, status: waiting(job) ? 'queued' : job.status, stoppedReason: job.stoppedReason, stoppedDetail: job.stoppedDetail ?? null, steps: job.steps,
    creditsReturned: job.creditsReturned, queuePosition: job.queuePosition, engineQueue: waiting(job) ? job.engineQueue ?? null : null, balance: balanceOf.get(job.userId) ?? 0,
  });
  const inPeriod = all.filter((job) => since === null || new Date(job.startedAt).getTime() >= since);
  const rows = inPeriod
    .map(toRow)
    .filter((row) => query.status === 'all' || row.status === query.status)
    .filter((row) => !needle || row.email.toLowerCase().includes(needle) || row.templateTitle.toLowerCase().includes(needle));
  const finished = inPeriod.filter((job) => job.status === 'done' && job.finishedAt);
  const seconds = finished.map((job) => (new Date(job.finishedAt as string).getTime() - new Date(job.startedAt).getTime()) / 1000);
  const selected = rows.find((row) => row.id === query.job) ?? (query.job ? null : (rows.find((row) => row.status === 'stopped') ?? null));
  return {
    rows, total: all.length, selected, status: query.status, q: query.q, period: query.period,
    tiles: {
      running: all.filter((job) => job.status === 'running' && !waiting(job)).length,
      done: inPeriod.filter((job) => job.status === 'done').length,
      stopped: inPeriod.filter((job) => job.status === 'stopped').length,
      averageSeconds: seconds.length ? seconds.reduce((a, b) => a + b, 0) / seconds.length : null,
      cost: null,
    },
  };
}
