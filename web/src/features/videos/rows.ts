import type { EngineQueue, Format, Job, JobStatus, Quality, StepKey, StopReason, Template } from '@/data/ports';

/** The four parts of the filter. `queued` counts as Running, `closed` as Stopped (the job did not deliver, nothing is going on). */
export type VideoFilter = 'all' | 'running' | 'done' | 'stopped';
const FILTERS: VideoFilter[] = ['all', 'running', 'done', 'stopped'];

export function filterOf(status: JobStatus): Exclude<VideoFilter, 'all'> {
  return status === 'queued' ? 'running' : status === 'closed' ? 'stopped' : status;
}

export interface VideoRow {
  id: string;
  templateId: string;
  title: string;
  /** The poster of the first delivered video; before there is one, the first frame made for a shot of the job; before that, the template's picture (a template made from a link has none). */
  image: string | null;
  productNames: string[];
  quality: Quality;
  variants: number;
  /** Length of the video; shown for talking videos and for a person swap only. */
  seconds: number | null;
  /** A person swap: no products, one variant, kept 30 days, its own stages. Absent: a product video. */
  swap?: boolean;
  /** A person swap while person swap is switched off: its pages are not there, so the row links to none of them. Absent: open, or a product video. */
  swapClosed?: boolean;
  status: JobStatus;
  /** The step the detail line talks about (running: the one in progress; stopped: the one that stopped). */
  step: { key: StepKey; done: number; total: number } | null;
  minutesLeft: number;
  /** Credits that came back when the job stopped (a stopped or closed job). */
  returned: number;
  /** Started on the free video: what comes back is the free video, not credits. */
  free: boolean;
  queuePosition: number | null;
  /** The line of a video the engine has not begun (its status here is `queued`): the videos in front of it and the minutes until it starts. */
  engineQueue: EngineQueue | null;
  /** A finished job whose videos are still kept; false after 12 months (B13). */
  stored: boolean;
  /** The videos a finished job delivered (the number "Delete these 3 videos?" names). */
  delivered: number;
  /** Why a stopped job stopped (null for any other status); a content-rule or unclear-request stop has no options to see. */
  reason: StopReason | null;
  /** When the job started (ISO); the delete window names the video by its day. */
  startedAt: string;
}

/** Display estimate only: minutes one variant takes, by format (the numbers of the estimate on the generate form). */
const MINUTES: Record<Format, number> = { 'no-talking': 7, talking: 12 };

export function parseFilter(value: string | undefined): VideoFilter {
  return FILTERS.find((f) => f === value) ?? 'all';
}

export function filterRows(rows: VideoRow[], filter: VideoFilter): VideoRow[] {
  return filter === 'all' ? rows : rows.filter((row) => filterOf(row.status) === filter);
}

/** True while a video of the list waits in line or is being made: the list then keeps itself fresh. */
export function hasLiveRow(rows: VideoRow[]): boolean {
  return rows.some((row) => row.status === 'running' || row.status === 'queued');
}

function currentStep(job: Job): VideoRow['step'] {
  if (job.status === 'done' || job.status === 'closed' || job.status === 'queued') return null;
  const wanted = job.status === 'stopped' ? 'stopped' : 'running';
  const step = job.steps.find((s) => s.status === wanted) ?? job.steps.find((s) => s.status !== 'done');
  return step ? { key: step.key, done: step.done, total: step.total } : null;
}

export function toRow(job: Job, template: Template | null, swapOpen = true): VideoRow {
  const format: Format = template?.format ?? 'no-talking';
  // A job the site holds as running whose run waits behind others is in a line, not running: it reads as queued, like a job of the site queue.
  const engineQueue = job.status === 'running' ? (job.engineQueue ?? null) : null;
  const left = job.steps.reduce((sum, s) => sum + (s.total ? 1 - s.done / s.total : 0), 0) / Math.max(job.steps.length, 1);
  return {
    id: job.id,
    templateId: job.templateId,
    title: job.templateTitle,
    image: job.variants.find((variant) => variant.status === 'done' && variant.image)?.image || job.shots?.find((shot) => shot.image)?.image || template?.image || null,
    productNames: job.input.products.map((p) => p.name),
    quality: job.input.quality,
    variants: job.input.variants,
    seconds: format === 'talking' || job.swap ? (template?.seconds ?? null) : null,
    swap: Boolean(job.swap),
    ...(job.swap && !swapOpen && { swapClosed: true }),
    status: engineQueue ? 'queued' : job.status,
    step: engineQueue ? null : currentStep(job),
    minutesLeft: Math.max(1, Math.ceil(left * MINUTES[format] * job.input.variants)),
    returned: job.creditsReturned,
    free: job.freeVideo,
    queuePosition: job.queuePosition,
    engineQueue,
    stored: job.videoStored,
    delivered: Math.max(1, job.variants.filter((variant) => variant.status === 'done').length),
    reason: job.stoppedReason,
    startedAt: job.startedAt,
  };
}
