import { engine } from '../engine';
import { EstimateChangedError, GenerationPausedError, InsufficientCreditsError, NotFoundError, RULES, swapCredits } from '../ports';
import type { Estimate, Id, Paid, SwapConsent, SwapInput, SwapPhotos, SwapRunner, Template } from '../ports';
import { dropRefusedPhotos, markSwapPhotos, ownsSwapPhotos, unfitSwapPhotos } from '../real/swap-photos';
import { SWAP_COST, SWAP_STEP_KEYS } from './demo-values';
import { afterStart, newJob, refreshUser, toJob } from './jobs';
import { balanceOf, writeRecord } from './ledger';
import { findUser, getStore, keyOf, now } from './store';
import type { JobRecord } from './store';

// Person swap on the site's own records. A job it starts is a job like any other (jobs.ts reads, continues, closes and refunds it);
// here are only what is its own: the switch, the price by the length of the video, the consent and the photographs. The answer to the
// admin's look is the admin's alone, and is given in admin-operations.ts.

/** `SwapRunner`, and the person-swap videos as the person-swap pages list them (the gallery of product templates never does). */
export interface SwapPort extends SwapRunner {
  /** The published person-swap videos, in the order of the catalog; none while the switch is off. Without the admin's `hint`s. */
  templates(): Promise<Template[]>;
  /** One of them, or null. */
  template(id: Id): Promise<Template | null>;
  /** Is person swap open: its pages exist and a job can start (`SwapSwitches.personSwap`)? Open does not say that a video is published. */
  enabled(): Promise<boolean>;
  /** Does an admin look at the photographs before a job is generated (`SwapSwitches.swapReview`)? */
  reviewed(): Promise<boolean>;
  /**
   * How many person swaps of each video were done, for the cards of the list: the total of all customers, nothing of whose they were.
   * Only a video that was delivered counts (a swap that stopped, was refused or given up does not); a video its owner deleted since does.
   * A video nobody got is not in it. None while the switch is off.
   */
  uses(): Promise<Record<Id, number>>;
}

const switches = () => getStore().limits;
/** A store written before the feature has no switch: off. */
const swapOn = (): boolean => switches().personSwap === true;
/** An admin looks at the photographs first, unless that is switched off. */
const reviewOn = (): boolean => switches().swapReview !== false;

/** Can a person swap be started from this template: a published video with its people and parts, of a length the rules sell. */
const sold = (template: Template): boolean => !!template.swap && template.status === 'published' && template.swap.persons.length > 0
  && template.swap.parts.length > 0 && template.seconds >= RULES.swapSecondsMin && template.seconds <= RULES.swapSecondsMax;

/** The words the model finds a person by are the admin's, and so is where the admin's work on them stands: a customer's copy has neither. */
const forCustomer = ({ swapPeople: _adminOnly, ...template }: Template): Template =>
  ({ ...template, ...(template.swap && { swap: { ...template.swap, persons: template.swap.persons.map((person) => ({ ...person, hint: '' })) } }) });

function soldTemplate(id: Id): Template {
  const template = swapOn() ? engine().template(id) : null;
  if (!template || !sold(template)) throw new NotFoundError('template');
  return template;
}

function estimateFor(userId: Id, input: SwapInput): { estimate: Estimate; paid: Paid; template: Template } {
  if (!findUser(userId)) throw new NotFoundError('user');
  const template = soldTemplate(input.templateId);
  if (switches().generationPaused) throw new GenerationPausedError();
  const perBlock = SWAP_COST[input.quality];
  if (!(perBlock > 0)) throw new RangeError('invalid-quality');
  const paid = engine().paid(template.id, 1);
  const credits = swapCredits(template.seconds, perBlock);
  const balance = balanceOf(userId);
  return {
    estimate: {
      images: paid.images, clips: paid.clips, clipSeconds: paid.clipSeconds, musicTracks: paid.music, minutes: engine().minutes(template.id, 1),
      credits, coveredByFreeVideo: false, balance, enough: balance >= credits,
    },
    paid, template,
  };
}

const wholeConsent = (consent: SwapConsent): boolean =>
  consent.ownPerson === true && consent.adults === true && consent.notCelebrity === true && consent.version === RULES.swapConsentVersion;

/** The photographs as the job keeps them: one entry for each slot of the video, each with a photograph of the body its user uploaded. */
function peopleFor(template: Template, userId: Id, sent: readonly SwapPhotos[]): SwapPhotos[] {
  const slots = template.swap!.persons.map((person) => person.slot);
  const people = Array.isArray(sent) ? sent.map(({ slot, body, face, side }) => ({ slot, body, face: face ?? null, ...(side == null ? {} : { side }) })) : [];
  const onePerSlot = people.length === slots.length && slots.every((slot) => people.filter((person) => person.slot === slot).length === 1);
  if (!onePerSlot || !ownsSwapPhotos(userId, people)) throw new Error('swap-people');
  // What the form checks in the browser, on the stored files: a photograph that fails is not kept, and nothing starts
  const unfit = unfitSwapPhotos(people);
  if (unfit.length > 0) {
    dropRefusedPhotos(unfit);
    throw new Error('swap-photo');
  }
  return people.sort((a, b) => a.slot - b.slot);
}

/** One synchronous step, like the start of any job: between the key check, the checks and the writes nothing else can run. */
function startSwap(userId: Id, input: SwapInput, idempotencyKey: string, confirmed: Pick<Estimate, 'credits' | 'coveredByFreeVideo'>, consent: SwapConsent): JobRecord {
  const store = getStore();
  const key = keyOf('job', userId, idempotencyKey);
  const existing = store.jobs.find((job) => job.id === store.keys.get(key));
  if (existing) return existing;

  try {
    refreshUser(userId);                                                   // a job that ended frees its place before this one is counted
  } catch {
    // counted as last seen
  }
  const { estimate, paid, template } = estimateFor(userId, input);
  // Before anything is charged or handed over: the consent, then the photographs.
  if (!wholeConsent(consent)) throw new Error('consent-required');
  const people = peopleFor(template, userId, input.people);
  if (estimate.credits !== confirmed.credits || confirmed.coveredByFreeVideo !== false) throw new EstimateChangedError(estimate);
  if (!estimate.enough) throw new InsufficientCreditsError(estimate.credits, estimate.balance);

  const job = newJob(userId, template, { templateId: template.id, products: [], quality: input.quality, variants: 1, language: 'en' }, estimate.credits);
  job.approved = paid;
  job.swap = { people, review: reviewOn() ? 'waiting' : null, outfit: input.outfit ?? 'keep' };
  job.swapConsent = { at: now().toISOString(), version: consent.version };
  const waiting = () => {
    job.status = 'queued';
    job.steps = SWAP_STEP_KEYS.map((step) => ({ key: step, status: 'waiting', done: 0, total: step === 'clips' ? paid.clips : 1 }));
  };
  const running = store.jobs.filter((item) => item.userId === userId && item.status === 'running').length;
  // The admin's look: charged now, and no place of the provider is asked for before the admin has said yes (a refusal would hold it for nothing).
  if (job.swap.review === 'waiting') waiting();
  else if (running >= switches().jobsAtOnce) {
    engine().reserveQueued?.(job, paid);
    waiting();
  }
  else engine().start(job, paid, false);                                   // first: when the engine refuses, nothing was charged

  job.chargeEntryId = writeRecord(userId, 'generation', 0 - estimate.credits, template.title, { jobId: job.id }).id;
  store.jobs.push(job);
  store.keys.set(key, job.id);
  try {
    markSwapPhotos(people);
  } catch {
    console.error(`swap-photos-not-marked: job ${job.id}`);                 // the job keeps and deletes them by its record all the same
  }
  return job;
}

export const swap: SwapPort = {
  async estimate(userId, input) {
    return estimateFor(userId, input).estimate;
  },

  async start(userId, input, idempotencyKey, confirmed, consent) {
    return toJob(afterStart(startSwap(userId, input, idempotencyKey, confirmed, consent)));
  },

  async templates() {
    return swapOn() ? engine().templates().filter(sold).map(forCustomer) : [];
  },

  async template(id) {
    const template = swapOn() ? engine().template(id) : null;
    return template && sold(template) ? forCustomer(template) : null;
  },

  async enabled() {
    return swapOn();
  },

  async reviewed() {
    return reviewOn();
  },

  async uses() {
    const counts: Record<Id, number> = {};
    if (!swapOn()) return counts;
    for (const job of getStore().jobs) if (job.swap && job.status === 'done') counts[job.templateId] = (counts[job.templateId] ?? 0) + 1;
    return counts;
  },
};
