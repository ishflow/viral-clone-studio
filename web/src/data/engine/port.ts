import type { JobRecord } from '../mock/store';
import type { AdminSettings, Candidate, Id, Paid, Scan, SourceCheck, SourceRange, SwapSlot, Template } from '../ports';

/**
 * The production system as the site sees it: templates, the work of a job, candidates, scans, settings.
 * The site keeps its own records (users, credits, purchases, invoices, emails, job records with their charge) and asks this for the rest.
 *
 * Synchronous on purpose: `node:sqlite` is, and a job start must stay one synchronous step.
 *
 * What is returned is a copy: change a template, a candidate or the settings only through the methods.
 * An unknown template or candidate id throws `NotFoundError` (`template(id)` returns null).
 *
 * A job record is the site's. Its fields `status`, `steps`, `stoppedReason`, `finishedAt` and `variants` are the engine's:
 * `start`, `resume` and `refresh` write them into the record they are given, and nothing else writes them.
 *
 * `start` and `resume` hand a run over in a HELD state: it is known to the engine, and no work is done for it.
 * Only `committed()` releases it. The site calls `committed()` when its own store, with the job record and the charge of that run,
 * is on disk: the worker may run only what the site has made durable. A run that is never released (the site died, or could not
 * write its store) stays held: no paid request is spent on a job the site does not know.
 *
 * `start` throws when the engine does not take the job; the site has charged nothing then.
 * `start` also counts the job on its template (`timesGenerated`), unless it is a sample.
 * `resume` throws when the engine does not take the job; when it returns, the record reads `status: 'running'`.
 * The site charges a resume once because of that: a job that is not stopped any more is not charged again.
 * When the engine cannot leave the job `running`, it must not hold a run for it: the site then fails the resume with `engine-error`
 * and charges nothing, and a run held all the same would be released by a later `committed()` without a charge.
 *
 * `committed()` may throw: the site logs it and keeps the result of its own call. The runs stay held until a later `committed()` works.
 */
export interface Engine {
  /** Free local metadata only; never fetches or charges. Private rows are scoped to ownerId. */
  sourceInfo?(ownerId: Id, url: string, range?: SourceRange): Extract<SourceCheck, { ok: true }> | null;
  /** The part of its video a template's preparation was given, or null when it was given none. Engines that keep no such thing do not have it. */
  sourcePart?(templateId: Id): SourceRange | null;
  templates(): Template[];
  template(id: Id): Template | null;
  // `swap`: the people an admin set for a person-swap video (`AdminQueries.setSwapPeople` has the rules and the errors). The site
  // writes nothing of them: the engine checks them and writes them into the template's own file and its card.
  updateTemplate(id: Id, patch: Partial<Pick<Template, 'title' | 'category' | 'products' | 'status' | 'shots' | 'description' | 'tags'>> & { swap?: { persons: SwapSlot[] } }): Template;
  removeTemplate(id: Id): void;
  // `mode: 'swap'` (here and in `addFromUpload`): the video of a person swap an admin gives. The template is the catalog's (no owner,
  // `waiting` while it is prepared); `ownerId` is then only who gave it: whose upload the file must be.
  addFromLink(ownerId: Id, url: string, range?: SourceRange, mode?: 'swap'): Template;   // private, preparing; a bad `range` → Error('source-rejected:range')
  paid(templateId: Id, variants: number): Paid;                    // what the estimate shows
  minutes(templateId: Id, variants: number): number;
  freeShareOpen?(approved: Paid): boolean;                          // B1: would a free job of these requests fit the free share of the provider's cap now? Reads only
  reserveQueued?(job: JobRecord, approved: Paid): void;             // optional paid-provider admission before queue charge
  start(job: JobRecord, approved: Paid, sample: boolean): void;    // held until `committed()`; counts the job on its template unless `sample`
  resume(job: JobRecord, approved: Paid): void;                    // held until `committed()`; leaves the record `running`
  /** R3: the admin says the request that stopped the job with `submission-unknown` never reached the provider (`by` is written into it): the job can be resumed. Throws `not-settleable`. Engines without paid requests do not have it. */
  settleUnknown?(job: JobRecord, by: string): void;
  committed(): void;                                               // the site store is on disk: every run handed over since the last call may start
  refresh(job: JobRecord): JobRecord;                              // status, steps, stoppedReason, finishedAt, variants as of now
  missing(job: JobRecord): Paid;                                   // what a resume has to pay for; all zero when the job is not stopped
  candidates(): Candidate[];
  /**
   * An admin's link becomes a manual candidate in the inbox (nothing is prepared, nothing is spent): `added` with its id, `exists` when the
   * same video is a catalog template or a candidate already, `limit` when the day's templates or candidates are used up. A link the catalog
   * does not take (`source-link.ts`) → Error('source-rejected:unsupported-site').
   */
  addLinkCandidate(url: string): { status: 'added'; id: Id } | { status: 'exists' | 'limit' };
  prepareCandidate(id: Id): Template;
  rejectCandidate(id: Id): void;
  scans(): Scan[];
  runScan(): Scan;
  settings(): AdminSettings;
  saveSettings(patch: Partial<AdminSettings>): AdminSettings;
  health(): { worker: 'running' | 'down'; lastSeen: string | null; provider: 'fake' | 'ready' | 'not-configured'; outOfCredits?: boolean; swap?: 'fake' | 'ready' | 'not-configured' };

  // Added for the launch-review flow contract (task D0). The SQLite adapter implements them too.
  // - `refresh` also writes `variants[].status` / `reason` (B2): while a job runs, `waiting` → `generating` → `done`; a job that delivers
  //   some variants ends `done` with the others `stopped`; a job that delivers none ends `stopped`. `stoppedReason` may be `content-rule` (B12).
  //   `refresh` is also called for a `done` job that has a `generating` variant (see `regenerateVariant`).
  //   When a job stops, `refresh` writes `stoppedAt` (when it stopped; the site counts the 30 days of B17 from it; when the engine
  //   leaves it null the site uses the moment it saw the stop).
  // - `start(job, approved, true)` (a sample) throws Error('sample-running') while another sample run of that template is unfinished
  //   (the site refuses first with SampleRunningError; this is the second guard, S11 review I1).
  // - `JobRecord` has new fields (task D0); the engine writes none of them except `stoppedAt`, and the fake-only `clockFrom` / `variantRuns`.
  // - `updateTemplate`: shots that change while `sample` is `current` make it `outdated`; `status: 'published'` with an `outdated`
  //   sample throws Error('sample-outdated') and changes nothing (B11). A sample job that ends `done` makes its template's sample `current`.
  /** B2: a `stopped` variant of a `done` job is generated again; held until `committed()`; leaves the variant `generating`. */
  regenerateVariant(job: JobRecord, variantId: Id, approved: Paid): Id;
  /** B17: a stopped job is closed (by the customer, or 30 days after it stopped): its saved parts can be deleted, it never runs again. */
  close(job: JobRecord): void;
  /** B18: the customer deleted a delivered job: its videos and images can be deleted. */
  deleteMedia(job: JobRecord): void;
  /** B6: like `addFromLink`, for a video file the upload route kept (`uploadId`). */
  addFromUpload(ownerId: Id, uploadId: string, range?: SourceRange, mode?: 'swap'): Template;
}
