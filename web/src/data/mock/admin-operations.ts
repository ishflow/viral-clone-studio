import { engine } from '../engine';
import { NotFoundError, RULES, swapPeopleProblem } from '../ports';
import type { Actor, AdminQueries, AdminResult, Id, LedgerEntry, LinkRow, SiteLimits } from '../ports';
import type { Engine } from '../engine/port';
import { sourceLink } from '../source-link';
import { mediaFile } from '../real/media';
import { liveJobs, refreshUser, refuseSwap, restart, runningSampleOf, startSample, toJob } from './jobs';
import { toEntry, writeEntry } from './ledger';
import { persistent } from './persist';
import { findUser, getStore, keyOf, newestFirst, now } from './store';
import type { AdminActionRecord, JobRecord } from './store';

type Operations = Pick<AdminQueries,
  | 'jobs' | 'retryJob' | 'retryStoppedJob' | 'settleUnknownRequest' | 'refundJob' | 'returnJobCredits' | 'sampleCost' | 'generateSample' | 'runningSamples' | 'templates' | 'template'
  | 'updateTemplate' | 'candidates' | 'prepareLinks' | 'prepareCandidate' | 'rejectCandidate' | 'scans' | 'runScan' | 'settings' | 'saveSettings'
  | 'limits' | 'saveLimits' | 'health' | 'addSwapTemplate' | 'setSwapPeople' | 'setSwapStatus' | 'swapQueue' | 'reviewSwap' | 'swapPhoto'>;

/** The admin as the ledger and the action records name them; Error('forbidden') for anyone else. */
export function adminActor(adminId: Id): Actor & { kind: 'admin' } {
  const admin = findUser(adminId);
  if (admin?.role !== 'admin') throw new Error('forbidden');
  return { kind: 'admin', id: admin.id, name: admin.name || admin.email };
}

/** A reason is required for every admin action (contract §12). */
export function requiredReason(reason: string): string {
  const text = reason.trim();
  if (!text) throw new Error('reason-required');
  return text;
}

/** Keeps who did what and why (B25). There is no page for it (K16). */
export function record(by: Actor, action: AdminActionRecord['action'], target: Id, reason: string): void {
  getStore().adminActions.push({ at: now().toISOString(), by, action, target, reason });
}

const LIMIT_RULES: { [K in keyof SiteLimits]-?: (value: SiteLimits[K]) => boolean } = {
  jobsAtOnce: (value) => Number.isInteger(value) && value >= 1,
  ownVideosPerDay: (value) => Number.isInteger(value) && value >= 0,
  freeFirstVideo: (value) => typeof value === 'boolean',
  freeVideosPerDay: (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0,
  showTalkingTemplates: (value) => typeof value === 'boolean',
  dailySpendingLimit: (value) => value === null || (Number.isInteger(value) && value > 0),
  warnAtPercent: (value) => Number.isInteger(value) && value >= 1 && value <= 100,
  onLimitReached: (value) => value === 'pause-new-jobs',
  generationPaused: (value) => typeof value === 'boolean',
  personSwap: (value) => typeof value === 'boolean',
  swapReview: (value) => typeof value === 'boolean',
};

/** The limits as the admin reads them: a store written before person swap names its two switches as they act (off, and the look on). */
const shownLimits = (): SiteLimits => ({ ...getStore().limits, personSwap: getStore().limits.personSwap === true, swapReview: getStore().limits.swapReview !== false });

const has = (text: string, search?: string): boolean => !search?.trim() || text.toLowerCase().includes(search.trim().toLowerCase());

function mustFindJob(id: Id): JobRecord {
  const job = liveJobs().find((item) => item.id === id);
  if (!job) throw new NotFoundError('job');
  return job;
}

/** A person-swap job, brought up to the current time: one whose wait for the look is over is refused by now. NotFoundError for any other job. */
function mustFindSwap(id: Id): JobRecord {
  const job = liveJobs().find((item) => item.id === id && item.swap);
  if (!job) throw new NotFoundError('job');
  return job;
}

const awaitsLook = (job: JobRecord): boolean => job.status === 'queued' && job.swap?.review === 'waiting';

/** The credits a job was charged and not given back return to its user, into the packs they came from. Error('nothing-to-refund'). */
function giveBackByAdmin(job: JobRecord, by: Actor, reason: string | null): LedgerEntry {
  const credits = job.credits - job.returnedCredits;
  if (credits <= 0) throw new Error('nothing-to-refund');
  const charge = getStore().ledger.find((entry) => entry.id === job.chargeEntryId);
  const entry = writeEntry(job.userId, 'returned', credits, job.templateTitle, { by, reason, jobId: job.id, backTo: charge?.lots ?? [] });
  job.returnedCredits += credits;
  job.refundEntryId = entry.id;
  return entry;
}

/** The admin queries for jobs, and the ones the engine answers: templates, candidates, scans and settings. */
export const operations: Operations = {
  /** Everyone's jobs, newest first. The search looks at the template title and the user's email. */
  async jobs({ status, search }) {
    return newestFirst(liveJobs(), (job) => job.startedAt)
      .filter((job) => !status || job.status === status)
      .filter((job) => has(job.templateTitle, search) || has(findUser(job.userId)?.email ?? '', search))
      .map(toJob);
  },

  /** Restarts a stopped job from the stopped step. The customer is not charged. */
  async retryJob(id) {
    return toJob(restart(mustFindJob(id), false));
  },

  async retryStoppedJob(adminId, id, reason) {
    const by = adminActor(adminId);
    const why = requiredReason(reason);
    const job = mustFindJob(id);
    if (job.status !== 'stopped') return { outcome: 'already-done', at: job.startedAt, value: toJob(job) };
    restart(job, false);
    record(by, 'retry-job', id, why);
    return { outcome: 'done', at: now().toISOString(), value: toJob(job) };
  },

  /** The admin found no task for the request that stopped the job at the provider: the engine settles it, the job can be retried. Who and why are kept. */
  async settleUnknownRequest(adminId, id, reason) {
    const by = adminActor(adminId);
    const why = requiredReason(reason);
    const job = mustFindJob(id);
    if (job.status !== 'stopped') return { outcome: 'already-done', at: job.startedAt, value: toJob(job) };
    if (job.stoppedReason !== 'submission-unknown') {
      // settled before (the record already reads as an ordinary stop) or never stuck on an unknown request
      if (job.stoppedReason === 'engine-error' && getStore().adminActions.some((action) => action.action === 'settle-unknown' && action.target === id)) return { outcome: 'already-done', at: now().toISOString(), value: toJob(job) };
      throw new Error('not-settleable');
    }
    const settleOnEngine = engine().settleUnknown;
    if (!settleOnEngine) throw new Error('not-supported');
    settleOnEngine.call(engine(), job, by.name);
    record(by, 'settle-unknown', id, why);
    return { outcome: 'done', at: now().toISOString(), value: toJob(job) };
  },

  /** Gives the credits a job was charged and not given back to its user, once per payment (`returned`, contract §2). */
  async refundJob(id) {
    const job = mustFindJob(id);
    const existing = getStore().ledger.find((entry) => entry.id === job.refundEntryId);
    if (existing) return toEntry(existing);
    return giveBackByAdmin(job, { kind: 'system' }, null);
  },

  async returnJobCredits(adminId, id, reason, idempotencyKey): Promise<AdminResult<LedgerEntry>> {
    const by = adminActor(adminId);
    const why = requiredReason(reason);
    const job = mustFindJob(id);
    const store = getStore();
    const key = keyOf('admin-return', job.userId, idempotencyKey);
    const known = store.ledger.find((entry) => entry.id === (store.keys.get(key) ?? job.refundEntryId));
    if (known) return { outcome: 'already-done', at: known.at, value: toEntry(known) };
    const entry = giveBackByAdmin(job, by, why);
    store.keys.set(key, entry.id);
    record(by, 'return-credits', id, why);
    return { outcome: 'done', at: entry.at, value: entry };
  },

  /** The paid requests one sample (one variant) of the template needs. */
  async sampleCost(templateId) {
    if (!engine().template(templateId)) throw new NotFoundError('template');
    return engine().paid(templateId, 1);
  },

  async generateSample(templateId, adminId, confirmed, products) {
    return toJob(startSample(templateId, adminId, confirmed, products));
  },

  async runningSamples() {
    const templates = new Set(getStore().jobs.filter((job) => job.sample).map((job) => job.templateId));
    const running = [...templates].map((id) => [id, runningSampleOf(id)?.id] as const).filter((pair): pair is readonly [string, string] => pair[1] !== undefined);
    return Object.fromEntries(running);
  },

  /** Every template, whatever its status. */
  async templates({ status, search }) {
    return engine().templates()
      .filter((template) => !status || template.status === status)
      .filter((template) => has(template.title, search) || has(template.category, search));
  },

  async template(id) {
    return engine().template(id);
  },

  async updateTemplate(id, patch) {
    return engine().updateTemplate(id, patch);
  },

  async candidates() {
    return engine().candidates();
  },

  async prepareCandidate(id) {
    return engine().prepareCandidate(id);
  },

  /** Each link of the list: checked, made a manual candidate and sent the way "Add to gallery" goes. A row says what became of its link. */
  async prepareLinks(adminId, lines) {
    adminActor(adminId);
    if (!Array.isArray(lines) || lines.length > RULES.linkBatchMax) throw new RangeError('too-many-links');
    const rows: LinkRow[] = [];
    for (const line of lines) {
      const link = typeof line === 'string' ? sourceLink(line) : null;
      if (link === null) {
        rows.push({ line, status: 'invalid' });
        continue;
      }
      let added: ReturnType<Engine['addLinkCandidate']>;
      try {
        added = engine().addLinkCandidate(link.url);
      } catch {
        rows.push({ line, status: 'failed' });
        continue;
      }
      if (added.status !== 'added') {
        rows.push({ line, status: added.status });
        continue;
      }
      try {
        engine().prepareCandidate(added.id);
        rows.push({ line, status: 'queued' });
      } catch {
        rows.push({ line, status: 'failed' });
      }
    }
    return rows;
  },

  async rejectCandidate(id) {
    engine().rejectCandidate(id);
  },

  async scans() {
    return engine().scans();
  },

  async runScan() {
    return engine().runScan();
  },

  async settings() {
    return engine().settings();
  },

  async saveSettings(patch) {
    return engine().saveSettings(patch);
  },

  async limits() {
    return shownLimits();
  },

  /** Only the fields of the limits; each must be in its range, else nothing is saved. They apply at once. */
  async saveLimits(adminId, patch) {
    adminActor(adminId);
    const keys = (Object.keys(LIMIT_RULES) as (keyof SiteLimits)[]).filter((key) => patch[key] !== undefined);
    const valid = (key: keyof SiteLimits): boolean => (LIMIT_RULES[key] as (value: unknown) => boolean)(patch[key]);
    if (!keys.every(valid)) throw new RangeError('invalid-limit');
    Object.assign(getStore().limits, Object.fromEntries(keys.map((key) => [key, patch[key]])));
    return shownLimits();
  },

  async health() {
    return engine().health();
  },

  async addSwapTemplate(adminId, source) {
    const by = adminActor(adminId);
    return source.kind === 'link' ? engine().addFromLink(by.id, source.url, source.range, 'swap') : engine().addFromUpload(by.id, source.uploadId, source.range, 'swap');
  },

  /** The site checks the people before it hands them on, so a mistake is said at once; the engine is the one that writes them. */
  async setSwapPeople(adminId, templateId, persons) {
    adminActor(adminId);
    if (swapPeopleProblem(persons)) throw new Error('swap-people-invalid');
    return engine().updateTemplate(templateId, { swap: { persons } });
  },

  /** Publish or withdraw a person-swap video. Whether its people are set is the engine's to say (`swap-people-unset`). */
  async setSwapStatus(adminId, templateId, status) {
    adminActor(adminId);
    if (status !== 'published' && status !== 'hidden') throw new RangeError('invalid-status');
    if (!engine().template(templateId)?.swap) throw new NotFoundError('template');
    return engine().updateTemplate(templateId, { status });
  },

  async swapQueue(adminId) {
    adminActor(adminId);
    return liveJobs().filter(awaitsLook).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((job) => ({
      job: toJob(job), email: findUser(job.userId)?.email ?? '', template: engine().template(job.templateId),
      decideBy: new Date(Date.parse(job.startedAt) + RULES.swapReviewHours * 3_600_000).toISOString(),
    }));
  },

  /**
   * The only way an answer to the look is given. `approved`: the job takes its place in its user's line and starts when a place is
   * free. `rejected`: it is closed, everything it was charged comes back and its photographs are deleted at once. The job is read
   * first, so one whose `RULES.swapReviewHours` are over is refused by its time there and waits no longer: a late answer changes nothing.
   */
  async reviewSwap(adminId, jobId, verdict) {
    const by = adminActor(adminId);
    if (verdict !== 'approved' && verdict !== 'rejected') throw new RangeError('invalid-verdict');
    const job = mustFindSwap(jobId);
    if (!awaitsLook(job)) return { outcome: 'already-done', at: job.closedAt ?? job.startedAt, value: toJob(job) };
    if (verdict === 'rejected') refuseSwap(job);
    else {
      job.swap!.review = 'approved';
      refreshUser(job.userId);
    }
    record(by, verdict === 'approved' ? 'swap-approve' : 'swap-reject', jobId, '');
    return { outcome: 'done', at: now().toISOString(), value: toJob(job) };
  },

  async swapPhoto(adminId, jobId, slot, kind) {
    const admin = findUser(adminActor(adminId).id)!;
    const job = mustFindSwap(jobId);
    if (job.swap!.people.length === 0) return { state: 'deleted' };
    if (!awaitsLook(job)) return { state: 'decided' };
    const stored = job.swap!.people.find((person) => person.slot === slot)?.[kind];
    if (!stored) throw new NotFoundError('photo');
    if (!persistent()) return { state: 'shown', name: stored, file: null };          // the fake keeps no file: a photograph is its name
    const found = mediaFile(stored.split('/'), admin);
    return found ? { state: 'shown', name: stored.split('/').pop()!, file: { path: found.file, type: found.type, size: found.size } } : { state: 'deleted' };
  },
};
