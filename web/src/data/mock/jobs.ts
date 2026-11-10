import { engine } from '../engine';
import {
  EstimateChangedError, GenerationPausedError, InsufficientCreditsError, NotFoundError, PaidChangedError, PriceChangedError, RULES, SampleRunningError,
} from '../ports';
import type { ClosedReason, Estimate, GenerateInput, Id, Job, JobRunner, JobStatus, Paid, ProductInput, ResumeQuote, StopReason, Template, User } from '../ports';
import { STEP_KEYS, jobCost } from './demo-values';
import { balanceOf, writeEntry, writeRecord } from './ledger';
import { jobImagesKept } from '../real/media-retention';
import { dropSwapPhotos, swapPhotosDue, swapReviewOver, swapVideoDue } from '../real/swap-photos';
import { keepEmail } from './mailer';
import { FREE_VIDEOS_PER_DAY, findUser, getStore, keyOf, newestFirst, now } from './store';
import type { JobRecord } from './store';
import { visibleTemplate } from './visible';

const DAY_MS = 86_400_000, HOUR_MS = 3_600_000;
const addDays = (iso: string, days: number): string => new Date(Date.parse(iso) + days * DAY_MS).toISOString();
const addMonths = (iso: string, months: number): string => {
  const date = new Date(iso);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
};
const past = (iso: string | null): boolean => iso !== null && Date.parse(iso) <= now().getTime();

/** The status as the engine left it in the record: it writes there, which the compiler cannot see. */
const statusOf = (job: JobRecord): JobStatus => job.status;
const limits = () => getStore().limits;

/**
 * The stops the owner does not continue. `content-rule` (B12): it would be stopped again, for the admin too. `submission-unknown`: a
 * request may or may not exist at the provider and we look into it ourselves; a resume by the owner would charge for a job that may stop
 * again at once. The free retry of the admin is let through (see `restart`).
 */
const notResumable = (reason: StopReason | null): boolean => reason === 'content-rule' || reason === 'submission-unknown';
/**
 * A person swap the provider refused the photograph of would be refused again, for the admin too: a new job with another photograph is
 * the way on. One whose person was not found is a fault of the template: its owner cannot continue it, the admin can once it is mended.
 */
const photoRefused = (job: JobRecord): boolean => job.stoppedDetail === 'photo-refused';
const ownerStuck = (job: JobRecord): boolean => notResumable(job.stoppedReason) || photoRefused(job) || job.stoppedDetail === 'person-missing';
/**
 * A person swap while person swap is switched off (`SwapSwitches.personSwap`; a store without the switch: off): its owner spends nothing
 * on it, on no way (Error('swap-closed')). Switched on again, it goes on as any stopped job. The free retry of the admin is let through.
 */
const swapClosed = (job: JobRecord): boolean => !!job.swap && limits().personSwap !== true;
/** How long a stopped job can be continued before it closes itself: a person swap for as long as its photographs are kept. */
const stoppedDays = (job: JobRecord): number => (job.swap ? RULES.swapStoppedPhotosKeptDays : RULES.stoppedKeptDays);
/** A person swap an admin has not looked at yet: charged and `queued`, and in nobody's line until the admin approves it. */
const awaitsReview = (job: JobRecord): boolean => job.swap?.review === 'waiting';
/** The jobs of a user that wait for a place, oldest first. */
const lineOf = (userId: Id): JobRecord[] => getStore().jobs
  .filter((job) => job.userId === userId && job.status === 'queued' && !awaitsReview(job))
  .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));

/** Credits charged and not given back: what a stop returns. */
const unreturned = (job: JobRecord): number => job.credits - job.returnedCredits;

/**
 * B1, B15: the moment a job stops, what it was charged comes back. Credits as a `returned` entry (by the system, into the packs they
 * came from); on the free video, the free video comes back (a `returned` entry of 0). Once per charge: `refundEntryId` marks it.
 */
function giveBack(job: JobRecord, credits: number): void {
  const charge = getStore().ledger.find((entry) => entry.id === job.chargeEntryId);
  if (job.freeVideo) {
    if (job.refundEntryId) return;
    const owner = findUser(job.userId);
    if (owner) owner.freeVideoAvailable = true;
    job.refundEntryId = writeEntry(job.userId, 'returned', 0, job.templateTitle, { jobId: job.id }).id;
    return;
  }
  if (credits <= 0) return;
  const entry = writeEntry(job.userId, 'returned', credits, job.templateTitle, { jobId: job.id, backTo: charge?.lots ?? [] });
  job.returnedCredits += credits;
  if (job.returnedCredits >= job.credits) job.refundEntryId = entry.id;
}

/** A job just stopped: its time, the credits (or the free video) back, the email. */
function onStopped(job: JobRecord): void {
  job.stoppedAt ??= now().toISOString();
  giveBack(job, unreturned(job));
  const owner = findUser(job.userId);
  if (owner) keepEmail('stopped', owner.email, {
    jobId: job.id, templateTitle: job.templateTitle, reason: job.stoppedReason ?? '',
    returned: String(job.returnedCredits), free: job.freeVideo ? '1' : '0',
    resumeCost: String(quoteFor(job, owner).cost),
    ...(swapClosed(job) && { swapClosed: '1' }),   // the mail then offers no continue and no price of one
    // A swap the provider refused the photograph of, or whose person was not found, is not continued by its owner: the mail asks for a new job.
    ...(!swapClosed(job) && job.swap && (job.stoppedDetail === 'photo-refused' || job.stoppedDetail === 'person-missing') && { swapStop: job.stoppedDetail }),
    // What was made, as "done/total" for each step that has work: the mail is written in the reader's language, so it carries no words.
    ...Object.fromEntries(job.steps.filter((step) => (step.key === 'images' || step.key === 'clips' || step.key === 'music') && step.total > 0).map((step) => [step.key, `${step.done}/${step.total}`])),
  });
}

/** A job just ended with its videos: a variant that stopped returns its share (B2), and the email goes out. */
function onDone(job: JobRecord): void {
  const stopped = job.variants.filter((variant) => variant.status === 'stopped').length;
  if (stopped > 0 && job.input.variants > 0) giveBack(job, Math.min(unreturned(job), (job.credits / job.input.variants) * stopped));
  const owner = findUser(job.userId);
  if (owner && !job.sample) { // a template's sample is the admin's work, not a customer's video: no "ready" email
    const minutes = Math.max(0, Math.ceil((Date.parse(job.finishedAt ?? now().toISOString()) - Date.parse(job.startedAt)) / 60_000));
    const image = job.variants.find((variant) => variant.status === 'done')?.image;
    keepEmail('ready', owner.email, { jobId: job.id, templateTitle: job.templateTitle, minutes: String(minutes),
      quality: job.input.quality, ...(engine().template(job.templateId) ? { seconds: String(engine().template(job.templateId)!.seconds) } : {}),
      ...(image ? { image } : {}) });
  }
}

/**
 * A stopped regeneration returns the shares of its own run's charge exactly once. Legacy records
 * without per-run entries retain their original fallback; new regenerations always save their shares.
 */
function onRegenerationStopped(job: JobRecord, wereGenerating: Id[]): void {
  const stopped = job.variants.filter((variant) => wereGenerating.includes(variant.id) && variant.status === 'stopped');
  for (const variant of stopped) {
    const charges = Object.values(job.regenerationCharges ?? {}).filter(charge => charge.variantId === variant.id);
    if (charges.length) {
      const charge = charges.at(-1)!;
      if (charge.refundEntryId) continue;
      const entry = writeEntry(job.userId, 'returned', charge.credits, job.templateTitle,
        { jobId: job.id, backTo: charge.lots });
      charge.refundEntryId = entry.id;
      job.returnedCredits += charge.credits;
      if (job.returnedCredits >= job.credits) job.refundEntryId = entry.id;
    } else {
      // Legacy records predate per-run shares.
      giveBack(job, Math.min(unreturned(job), job.variantCharges?.[variant.id] ?? jobCost(templateFormat(job), job.input.quality, 1)));
    }
  }
}

/**
 * The engine closes a stopped job (its saved parts go); the record says why and when. Nothing is charged. The photographs of a person swap go with it.
 * `close`: the engine's own, when the engine itself asks (`sweepSwapJobs`).
 */
function closeJob(job: JobRecord, reason: 'customer' | 'expired', close: (job: JobRecord) => void = (item) => engine().close(item)): void {
  close(job);
  job.status = 'closed';
  job.closedReason = reason;
  job.closedAt = reason === 'expired' && job.stoppedAt ? addDays(job.stoppedAt, stoppedDays(job)) : now().toISOString();
  dropSwapPhotos(job);
}

/**
 * A person swap that waits for the admin's look and will never start. What it was charged comes back, it is closed, and its
 * photographs are deleted at once; its owner gets one mail (`refused`), unless it was the owner who gave up. `by`: null, the admin refused the photographs; `customer`, its owner gave the wait up; `expired`,
 * nobody looked within `RULES.swapReviewHours`. Only a job that still waits for the look: a second call, whoever makes it, changes
 * and returns nothing.
 */
export function refuseSwap(job: JobRecord, by: ClosedReason | null = null): void {
  if (job.status !== 'queued' || !job.swap || !awaitsReview(job)) return;
  job.swap.review = 'rejected';
  giveBack(job, unreturned(job));
  job.status = 'closed';
  job.closedReason = by;
  job.closedAt = by === 'expired' ? new Date(Date.parse(job.startedAt) + RULES.swapReviewHours * HOUR_MS).toISOString() : now().toISOString();
  dropSwapPhotos(job);
  // One mail for a refusal its owner did not make: this is the only place a job is refused, and a refused job is refused no second time
  const owner = by === 'customer' ? undefined : findUser(job.userId);
  if (owner) keepEmail('refused', owner.email, { jobId: job.id, templateTitle: job.templateTitle, returned: String(job.returnedCredits), returnTo: `/jobs/${job.id}` });
}

/**
 * What the rules no longer keep of a person swap goes: its photographs (`swapPhotosDue`), and the files of its video
 * `RULES.swapVideosKeptDays` after it was done. A file that cannot be deleted now is tried again on the next read.
 */
function tidySwap(job: JobRecord): void {
  if (swapPhotosDue(job, now())) dropSwapPhotos(job);
  if (!swapVideoDue(job, now())) return;
  try {
    engine().deleteMedia(job);
    job.swapVideoGoneAt = now().toISOString();
  } catch {
    // still there: the next read tries again
  }
}

const regenerating = (job: JobRecord): boolean => job.variants.some((variant) => variant.status === 'generating');

/**
 * What the time alone does to a job: a stopped one closes itself when it can be continued no longer (`stoppedDays`), a person swap
 * nobody looked at is refused `RULES.swapReviewHours` after it was started.
 */
function expire(job: JobRecord, close?: (job: JobRecord) => void): void {
  if (job.status === 'stopped' && job.stoppedAt && past(addDays(job.stoppedAt, stoppedDays(job)))) closeJob(job, 'expired', close);
  if (swapReviewOver(job, now())) refuseSwap(job, 'expired');
}

/**
 * Brings a job up to the current time (the engine knows how far it is). A job ends (done or stopped) once, so its email goes out once.
 * A stopped job closes itself `RULES.stoppedKeptDays` after it stopped (B17); a person swap nobody looked at is refused
 * `RULES.swapReviewHours` after it was started.
 */
function refresh(job: JobRecord): JobRecord {
  if (job.status === 'running' || (job.status === 'done' && regenerating(job))) {
    const before = job.status;
    const generating = job.variants.filter((variant) => variant.status === 'generating').map((variant) => variant.id);
    engine().refresh(job);
    const status = statusOf(job);
    if (before === 'running' && status === 'stopped') onStopped(job);
    if (before === 'running' && status === 'done') onDone(job);
    if (before === 'done') onRegenerationStopped(job, generating);
  }
  expire(job);
  if (job.swap) tidySwap(job);
  return job;
}

/**
 * The person swaps whose time ran out while nobody read them, for the engine's own sweep (when it opens, and every few minutes while
 * it works): one nobody looked at is refused with everything returned, a stopped one is closed with its saved parts; the photographs
 * of both go. `close` is the engine's: the sweep runs inside it, also while it opens. A read at the same moment finds the job closed,
 * and returns nothing a second time.
 */
export function sweepSwapJobs(close: (job: JobRecord) => void): void {
  for (const job of getStore().jobs) if (job.swap) expire(job, close);
}

/** Hands a queued job to the engine. When the engine does not take it, the job stops (`engine-error`) and its credits come back. */
function promote(job: JobRecord): void {
  job.status = 'running';
  try {
    engine().start(job, job.approved ?? engine().paid(job.templateId, job.input.variants), false);
  } catch {
    job.status = 'stopped';
    job.stoppedReason = 'engine-error';
    onStopped(job);
  }
}

/** B3: the queued jobs of a user start, oldest first, while the user has fewer than `jobsAtOnce` running and generation is not paused. */
function promoteQueued(userId: Id): void {
  if (limits().generationPaused) return;
  const own = getStore().jobs.filter((job) => job.userId === userId);
  for (const job of lineOf(userId)) {
    if (own.filter((item) => item.status === 'running').length >= limits().jobsAtOnce) return;
    promote(job);
  }
}

/** Every job of a user up to the current time, and their queue moved on. */
export function refreshUser(userId: Id): JobRecord[] {
  const own = getStore().jobs.filter((job) => job.userId === userId);
  own.forEach(refresh);
  promoteQueued(userId);
  own.forEach(refresh);
  return own;
}

/**
 * A job that was just handed to the engine, as far as the engine can say. When the engine cannot say, the job is returned as it was
 * recorded: it is started and charged, and an error here would make the customer start, and pay for, a second one.
 */
export function afterStart(job: JobRecord): JobRecord {
  try {
    return refresh(job);
  } catch {
    return job;
  }
}

function minutesOf(job: JobRecord): number | null {
  try {
    return engine().minutes(job.templateId, job.input.variants);
  } catch {
    return null;
  }
}

/** A copy for the caller, without the fields only the runner needs, with the fields computed from the record and the rules. */
export function toJob(job: JobRecord): Job {
  const { id, userId, templateId, templateTitle, input, credits, status, steps, stoppedReason, startedAt, finishedAt, variants } = job;
  const queue = status === 'queued' ? lineOf(userId) : [];
  const minutes = status === 'running' ? minutesOf(job) : null;
  const ranFor = now().getTime() - Date.parse(job.clockFrom ?? startedAt);
  const videoExpiresAt = !finishedAt ? null : job.swap ? addDays(finishedAt, RULES.swapVideosKeptDays) : addMonths(finishedAt, RULES.videosKeptMonths);
  const endedAt = finishedAt ?? job.stoppedAt;
  const imagesExpireAt = endedAt ? addDays(endedAt, RULES.imagesKeptDays) : null;
  const imagesStored = !past(imagesExpireAt);
  return structuredClone({
    id, userId, templateId, templateTitle, input, credits, status, steps, stoppedReason, stoppedDetail: job.stoppedDetail ?? null, startedAt, finishedAt, variants,
    freeVideo: job.freeVideo,
    creditsReturned: job.returnedCredits,
    queuePosition: status === 'queued' && !awaitsReview(job) ? queue.findIndex((item) => item.id === id) + 1 : null,
    engineQueue: status === 'running' ? (job.engineQueue ?? null) : null,
    delayed: minutes !== null && ranFor > minutes * 60_000 * RULES.delayedFactor,
    paused: limits().generationPaused && (status === 'queued' || status === 'running'),
    stoppedAt: job.stoppedAt,
    continueUntil: status === 'stopped' && job.stoppedAt ? addDays(job.stoppedAt, stoppedDays(job)) : null,
    closedAt: job.closedAt, closedReason: job.closedReason,
    videoExpiresAt, imagesExpireAt,
    videoStored: status === 'done' && !past(videoExpiresAt) && !job.swapVideoGoneAt,
    imagesStored,
    deletedAt: job.deletedAt,
    // the files made are of the pictures that are kept no longer (or of a job that is closed): `/media` refuses them, by the same rule
    ...(job.shots && { shots: job.shots.map((shot) => (jobImagesKept(job) ? shot : { ...shot, image: null, ...(shot.clipUrl !== undefined && { clipUrl: null }) })) }),
    ...(job.made && { made: jobImagesKept(job) ? job.made : { music: [], shared: [] } }),
    ...(job.swap && { swap: job.swap }),
  });
}

/** Every stored job, brought up to the current time, the queues moved on. For the admin queries. */
export function liveJobs(): JobRecord[] {
  const { jobs } = getStore();
  for (const userId of new Set(jobs.map((job) => job.userId))) refreshUser(userId);
  return jobs;
}

/** What continuing a stopped job costs now. Pure: it changes nothing. */
function quoteFor(job: JobRecord, user: User | undefined): ResumeQuote {
  const missing = engine().missing(job);
  const resumable = job.status === 'stopped' && !ownerStuck(job) && !swapClosed(job);
  const coveredByFreeVideo = resumable && job.freeVideo && !!user?.freeVideoAvailable;
  const freeUsedElsewhere = resumable && job.freeVideo && !coveredByFreeVideo;
  const fullPrice = job.freeVideo ? jobCost(templateFormat(job), job.input.quality, job.input.variants) : job.returnedCredits;
  const cost = !resumable || coveredByFreeVideo ? 0 : fullPrice;
  const balance = balanceOf(job.userId);
  return {
    resumable, cost, charged: job.credits, returned: job.returnedCredits, free: job.freeVideo, coveredByFreeVideo, freeUsedElsewhere,
    balance, enough: balance >= cost, missing,
    continueUntil: job.status === 'stopped' && job.stoppedAt ? addDays(job.stoppedAt, stoppedDays(job)) : null,
  };
}

function templateFormat(job: JobRecord): Template['format'] {
  return engine().template(job.templateId)?.format ?? 'no-talking';
}

/**
 * Stopped → running, from the stopped step. The owner pays what `quoteFor` says (K6: the credits that came back; B15: the free video
 * again, or the price when it was used elsewhere); a retry by the admin is free. With `confirmedCost`, a cost that is not the confirmed
 * one stops here, before anything changes. The engine is asked once what is missing: that is what it is given as approved.
 */
export function restart(job: JobRecord, charge: boolean, confirmedCost?: number): JobRecord {
  if (job.status !== 'stopped') return job;
  // The admin is refused on a content rule only. With an unknown request the free retry goes to the engine, which never sends such a request
  // again: one that has its ticket is asked for by the ticket, one that has none stops the run again until it is settled. The reason kept
  // here is the one of the moment the job stopped (a request settled with the command line leaves it as it was), so it cannot be the gate.
  if (job.stoppedReason === 'content-rule' || photoRefused(job) || (charge && ownerStuck(job))) throw new Error('not-resumable');
  if (charge && swapClosed(job)) throw new Error('swap-closed');
  if (limits().generationPaused) throw new GenerationPausedError();
  const user = findUser(job.userId);
  const quote = quoteFor(job, user);
  const cost = charge ? quote.cost : 0;
  if (confirmedCost !== undefined && cost !== confirmedCost) throw new PriceChangedError(cost);
  if (cost > quote.balance) throw new InsufficientCreditsError(cost, quote.balance); // before anything changes
  // Ö2: the free video went elsewhere, so this job is paid from now on. The engine has to see that: a paid job is not in the free share.
  const paidFromNow = job.freeVideo && cost > 0;
  if (paidFromNow) job.freeVideo = false;
  try {
    engine().resume(job, quote.missing); // first: when the engine refuses, nothing was charged
    // The charge is taken once because the job is not stopped any more (see the first line): an engine that leaves it stopped gets no charge.
    if (statusOf(job) !== 'running') throw new Error('engine-error');
  } catch (error) {
    if (paidFromNow) job.freeVideo = true;
    throw error;
  }
  job.stoppedAt = null;
  if (!charge) return job;
  if (quote.coveredByFreeVideo) {
    if (user) user.freeVideoAvailable = false;
    job.chargeEntryId = writeEntry(job.userId, 'free-video', 0, job.templateTitle, { jobId: job.id }).id;
    job.refundEntryId = null;
  } else if (cost > 0) {
    job.chargeEntryId = writeRecord(job.userId, 'generation', -cost, job.templateTitle, { jobId: job.id }).id;
    if (paidFromNow) job.credits = cost;
    else job.returnedCredits = Math.max(0, job.returnedCredits - cost);
    job.refundEntryId = null;
  }
  return job;
}

function estimateFor(userId: Id, input: GenerateInput): { estimate: Estimate; paid: Paid; template: Template; user: User; withheld: boolean } {
  const user = findUser(userId);
  if (!user) throw new NotFoundError('user');
  const template = visibleTemplate(input.templateId, userId);
  if (!template || template.swap) throw new NotFoundError('template');   // a person-swap video makes no product video: `SwapRunner` starts its jobs
  if (template.preparation === 'preparing' || template.preparation === 'failed') throw new Error('template-not-ready');
  if (limits().generationPaused) throw new GenerationPausedError();
  const cost = jobCost(template.format, input.quality, input.variants);
  const paid = engine().paid(template.id, input.variants);
  const freeVideo = user.emailVerified && user.freeVideoAvailable
    && template.format === 'no-talking' && input.quality === 'fast' && input.variants === 1;
  // B1: while no free video can start the job has its price: who has credits pays, and the free video stays for a day that has a place.
  const coveredByFreeVideo = freeVideo && freeVideoOpen(paid);
  const credits = coveredByFreeVideo ? 0 : cost;
  const balance = balanceOf(userId);
  const estimate: Estimate = {
    images: paid.images, clips: paid.clips, clipSeconds: paid.clipSeconds, musicTracks: paid.music, minutes: engine().minutes(template.id, input.variants),
    credits, coveredByFreeVideo, balance, enough: balance >= credits,
  };
  return { estimate, paid, template, user, withheld: freeVideo && !coveredByFreeVideo };
}

const PAID_KEYS = ['images', 'clips', 'clipSeconds', 'music', 'voice'] as const;

/**
 * K1: the jobs that took a free video today, the whole site. The day is the UTC day, as for the provider's daily cap. Counted in the
 * ledger, which a deleted account leaves behind; a job that stopped and went on with its free video is one job.
 */
function freeVideosToday(): number {
  const day = now().toISOString().slice(0, 10);
  return new Set(getStore().ledger.filter((entry) => entry.type === 'free-video' && entry.at.startsWith(day)).map((entry) => entry.relatedJobId)).size;
}

/**
 * B1: may a job start on the free video now? Not while the free videos of the day (K1) are used up, or their share of the provider's
 * daily cap (K2), which only an engine that reserves a provider budget knows. Reads only: nothing is counted or reserved.
 */
function freeVideoOpen(paid: Paid): boolean {
  return freeVideosToday() < (limits().freeVideosPerDay ?? FREE_VIDEOS_PER_DAY)
    && (engine().freeShareOpen?.(paid) ?? true);
}

/** A job record that has not begun: the engine fills in its steps when it starts it. */
export function newJob(userId: Id, template: Template, input: GenerateInput, credits: number, sample = false): JobRecord {
  return {
    id: crypto.randomUUID(), userId, templateId: template.id, templateTitle: template.title, input: structuredClone(input),
    credits, status: 'running', steps: [], stoppedReason: null, startedAt: now().toISOString(), finishedAt: null, variants: [],
    resumedAt: null, pinnedElapsed: null, refundEntryId: null, clockFrom: null, variantRuns: {}, approved: null, chargeEntryId: null,
    sample, freeVideo: false, returnedCredits: 0, stoppedAt: null, closedAt: null, closedReason: null, deletedAt: null,
  };
}

/** The job of this owner, brought up to the current time. Anyone else, and a deleted job, gets "not found". */
function ownJob(id: Id, ownerId: Id): JobRecord {
  const job = getStore().jobs.find((item) => item.id === id && item.userId === ownerId && !item.deletedAt);
  if (!job) throw new NotFoundError('job');
  refreshUser(ownerId);
  return job;
}

/** One synchronous step: between the key check, the balance check and the writes nothing else can run. */
function startJob(userId: Id, input: GenerateInput, idempotencyKey: string, confirmed: Pick<Estimate, 'credits' | 'coveredByFreeVideo'>): JobRecord {
  const store = getStore();
  const key = keyOf('job', userId, idempotencyKey);
  const existing = store.jobs.find((job) => job.id === store.keys.get(key));
  if (existing) return existing;

  // A job that ended frees its slot before this one is counted. An engine that cannot say how far the jobs are does not stop the start:
  // the count is then the one of the last read.
  try {
    refreshUser(userId);
  } catch {
    // counted as last seen
  }
  const { estimate, paid, template, user, withheld } = estimateFor(userId, input);
  // K1, K2: no free video can start now, and there are no credits for the price. Nothing is written and the engine is not asked: the
  // free video stays. Whatever was confirmed: the answer of a day that is used up, not a changed price the account cannot pay either.
  if (withheld && !estimate.enough) throw new Error('free-video-cap');
  if (estimate.credits !== confirmed.credits || estimate.coveredByFreeVideo !== confirmed.coveredByFreeVideo) {
    throw new EstimateChangedError(estimate);
  }
  if (!estimate.enough) throw new InsufficientCreditsError(estimate.credits, estimate.balance);
  const job = newJob(userId, template, input, estimate.credits);
  job.approved = paid;
  job.freeVideo = estimate.coveredByFreeVideo;
  const running = store.jobs.filter((item) => item.userId === userId && item.status === 'running').length;
  if (running >= limits().jobsAtOnce) {
    // B3: charged now, handed to the engine when a slot is free. Nothing has run: every stage waits (the engine rewrites them when it starts).
    engine().reserveQueued?.(job, paid); // provider admission before the queued job's charge
    job.status = 'queued';
    job.steps = STEP_KEYS.map((key) => ({ key, status: 'waiting', done: 0, total: key === 'images' ? paid.images : key === 'clips' ? paid.clips : 1 }));
  }
  else engine().start(job, paid, false); // first: when the engine refuses, nothing was charged. The engine counts the job on the template.

  job.chargeEntryId = writeRecord(userId, estimate.coveredByFreeVideo ? 'free-video' : 'generation', 0 - estimate.credits, template.title, { jobId: job.id }).id;
  if (estimate.coveredByFreeVideo) user.freeVideoAvailable = false;
  store.jobs.push(job);
  store.keys.set(key, job.id);
  store.drafts = store.drafts.filter((draft) => !(draft.userId === userId && draft.templateId === template.id)); // B8: the form is used up
  return job;
}

/**
 * The sample video of a template: a job of the admin that costs no credits and writes no ledger entry.
 * `confirmed` is the paid requests the admin saw: when the ones of now differ, nothing starts.
 */
export function startSample(templateId: Id, adminId: Id, confirmed: Paid, products: ProductInput[]): JobRecord {
  if (findUser(adminId)?.role !== 'admin') throw new Error('forbidden');
  const template = engine().template(templateId);
  if (!template || template.swap) throw new NotFoundError('template');   // a person-swap video has no sample made with products
  if (template.preparation === 'preparing' || template.preparation === 'failed') throw new Error('template-not-ready');
  const running = runningSampleOf(templateId);
  if (running) throw new SampleRunningError(running.id); // first: a second paid sample is never started (S11 review I1)
  const paid = engine().paid(templateId, 1);
  if (PAID_KEYS.some((key) => paid[key] !== confirmed[key])) throw new PaidChangedError(paid);
  // A sample needs the products a customer gives (the template's shots name them): the admin's own photographs, one variant.
  if (products.length < Math.max(1, template.products) || products.length > 5 || products.some((product) => product.name.trim() === '' || product.images.length === 0)) throw new Error('sample-products');
  const job = newJob(adminId, template, { templateId, products, quality: 'fast', variants: 1, language: 'en' }, 0, true);
  job.approved = paid;
  engine().start(job, paid, true);
  getStore().jobs.push(job);
  return afterStart(job);
}

/** The sample job of a template that is running now, brought up to the current time; undefined when there is none. */
export function runningSampleOf(templateId: Id): JobRecord | undefined {
  return getStore().jobs.filter((job) => job.sample && job.templateId === templateId).map(refresh).find((job) => job.status === 'running');
}

/** A stopped variant of a delivered job, and what generating it again costs: the share of the job it returned. */
function stoppedVariant(job: JobRecord, variantId: Id): { cost: number } {
  const variant = job.variants.find((item) => item.id === variantId);
  if (!variant) throw new NotFoundError('variant');
  if (job.status !== 'done' || variant.status !== 'stopped') throw new Error('not-stopped');
  // B12: it would stop again; the customer contacts support. Any other reason, an unknown request too, is no bar: generating again is a new run with its own requests
  if (variant.reason === 'content-rule') throw new Error('not-resumable');
  const imagesExpireAt = toJob(job).imagesExpireAt;
  if (past(imagesExpireAt)) throw new Error('images-expired');
  return { cost: jobCost(templateFormat(job), job.input.quality, 1) };
}

export const jobs: JobRunner = {
  async estimate(userId, input) {
    return estimateFor(userId, input).estimate;
  },

  async freeVideoOpen(templateId) {
    return freeVideoOpen(engine().paid(templateId, 1));
  },

  async start(userId, input, idempotencyKey, confirmed) {
    return toJob(afterStart(startJob(userId, input, idempotencyKey, confirmed)));
  },

  async findByKey(userId, idempotencyKey) {
    const store = getStore();
    const id = store.keys.get(keyOf('job', userId, idempotencyKey));
    const job = store.jobs.find((item) => item.id === id && item.userId === userId);
    return job ? toJob(refresh(job)) : null;
  },

  /** Only the owner. The admin reads jobs through `admin.jobs()`. A deleted job is gone. */
  async get(id, viewerId) {
    const job = getStore().jobs.find((item) => item.id === id && item.userId === viewerId && !item.deletedAt);
    if (!job) return null;
    refreshUser(viewerId);
    return toJob(job);
  },

  /** Newest first, without deleted jobs. */
  async listFor(userId) {
    const own = refreshUser(userId).filter((job) => !job.deletedAt);
    return newestFirst(own, (job) => job.startedAt).map(toJob);
  },

  /** Only the owner can resume. A job that is not stopped is returned as it is, so a double click charges once. */
  async resume(id, viewerId, confirmedCost) {
    return toJob(restart(ownJob(id, viewerId), true, confirmedCost));
  },

  /** What `resume` would charge now. Only the owner can ask. */
  async resumeCost(id, viewerId) {
    const job = ownJob(id, viewerId);
    return quoteFor(job, findUser(job.userId)).cost;
  },

  async resumeQuote(id, viewerId) {
    const job = ownJob(id, viewerId);
    return quoteFor(job, findUser(job.userId));
  },

  async close(id, viewerId) {
    const job = ownJob(id, viewerId);
    if (job.status === 'closed') return toJob(job);
    if (job.status === 'queued' && awaitsReview(job)) {                    // the owner gives up the wait for the admin's look: nothing ran, everything comes back
      refuseSwap(job, 'customer');
      return toJob(job);
    }
    if (job.status !== 'stopped') throw new Error('not-stopped');
    closeJob(job, 'customer');
    return toJob(job);
  },

  async variantCost(id, viewerId, variantId) {
    return stoppedVariant(ownJob(id, viewerId), variantId).cost;
  },

  /** The variant runs again in the engine; the job stays `done`. Charged once: a variant that is not stopped any more is not charged again. */
  async regenerateVariant(id, viewerId, variantId, confirmedCost) {
    const job = ownJob(id, viewerId);
    const variant = job.variants.find((item) => item.id === variantId);
    if (variant?.status === 'generating' || variant?.status === 'done') return toJob(job);
    const { cost } = stoppedVariant(job, variantId);
    if (swapClosed(job)) throw new Error('swap-closed');
    if (cost !== confirmedCost) throw new PriceChangedError(cost);
    if (limits().generationPaused) throw new GenerationPausedError();
    const balance = balanceOf(job.userId);
    if (cost > balance) throw new InsufficientCreditsError(cost, balance);
    // The charge first: when it cannot be written nothing is held (a held run that a release starts is a free run). When the engine
    // refuses, the charge is taken out again: nothing else has seen it, the call is one synchronous step.
    const ledger = getStore().ledger;
    const charge = writeRecord(job.userId, 'generation', -cost, job.templateTitle, { jobId: job.id });
    try {
      const runId = engine().regenerateVariant(job, variantId, engine().paid(job.templateId, 1));
      job.regenerationCharges = { ...job.regenerationCharges, [runId]: {
        variantId, chargeEntryId: charge.id, lots: structuredClone(charge.lots), credits: cost, refundEntryId: null,
      } };
    } catch (error) {
      ledger.splice(ledger.lastIndexOf(charge), 1);
      throw error;
    }
    job.chargeEntryId = charge.id;
    job.variantCharges = { ...job.variantCharges, [variantId]: cost };
    job.returnedCredits = Math.max(0, job.returnedCredits - cost);
    job.refundEntryId = null;
    return toJob(job);
  },

  async deleteVideo(id, viewerId) {
    const job = ownJob(id, viewerId);
    if (job.status !== 'done' || regenerating(job)) throw new Error('not-deletable');
    engine().deleteMedia(job);
    job.deletedAt = now().toISOString();
    dropSwapPhotos(job);
  },
};
