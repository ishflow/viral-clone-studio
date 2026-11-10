import type { Locale } from '@/core/i18n/types';
import type { Period } from '@/core/period';

export type { Locale, Period };
export type Id = string;
export type Role = 'customer' | 'admin';
export type Format = 'no-talking' | 'talking';
export type Quality = 'fast' | 'best';
/**
 * `queued`: confirmed and charged, waiting for a slot (`SiteLimits.jobsAtOnce` per user, B3). `closed`: a stopped job the customer
 * closed, or that closed itself `RULES.stoppedKeptDays` after it stopped (B17).
 */
export type JobStatus = 'queued' | 'running' | 'done' | 'stopped' | 'closed';
export type StepKey = 'adaptation' | 'images' | 'clips' | 'music' | 'edit' | 'render';
export type StepStatus = 'waiting' | 'running' | 'done' | 'stopped';
/** State of one variant of a job (B2). */
export type VariantStatus = 'waiting' | 'generating' | 'done' | 'stopped';
/** `returned`: credits back to the balance, automatically (a stopped job, a template that could not be prepared, a refund that failed). `refund`: money back. */
export type LedgerType = 'purchase' | 'generation' | 'free-video' | 'admin' | 'refund' | 'returned';
/** The refund lifecycle (B5, B16): `refund-requested` → `refund-sent` → `refunded` | `refund-failed`. */
export type PurchaseStatus = 'paid' | 'not-completed' | 'refund-requested' | 'refund-sent' | 'refunded' | 'refund-failed';
/** B4. `pending`: the customer is back but the provider has not confirmed yet. `paid` and `declined` write a purchase; the others do not. */
export type CheckoutStatus = 'open' | 'pending' | 'paid' | 'declined' | 'cancelled' | 'expired';
export type TemplateStatus = 'published' | 'waiting' | 'hidden' | 'private';
/** B11. `outdated`: the shots changed after the sample was made; the template cannot be published until a new sample is ready. */
export type SampleState = 'current' | 'outdated' | 'none';
export type ScanSource = 'topads' | 'shorts';
/** `refused`: a person swap was not approved (an admin said no, or nobody answered within `RULES.swapReviewHours`): credits back, photographs deleted. */
export type EmailKind = 'verify' | 'reset' | 'ready' | 'stopped' | 'payment' | 'refused';
// Reasons are machine codes, never prose: the UI translates them, and shows its generic message for a code it does not know.
// The codes are the ones of the production system (`engine/src/contracts.ts`), plus `content-rule` (B12: such a job cannot be continued).
export type StopReason =                                 // why a job stopped
  | 'adaptation-failed' | 'images-failed' | 'clips-failed' | 'audio-failed' | 'render-failed'
  | 'submission-unknown' | 'estimate-exceeded' | 'llm-invalid' | 'template-missing' | 'engine-error' | 'content-rule';
// why a scan stopped: the source could not be read, or the scan itself failed (a crash on our side: look at the worker log)
/** Why a stopped job stopped, one level below the reason (the engine's `runs.detail`): only the codes the screens explain; any other code is `null`. */
export type StopDetail = 'provider-credits' | 'provider-cap' | 'provider-refused' | 'provider-setup' | 'upload-failed' | 'no-products' | 'fill-invalid'
  | 'photo-refused' | 'person-missing';                    // person swap: the provider refused the photograph · the person of the video was not found
export type ScanStopReason = 'source-unavailable' | 'scan-failed' | 'no-matching-industry';
export type PreparationNote =                            // why a video did not become a template, or an edit was not taken over
  | 'below-threshold' | 'unsupported' | 'split-screen' | 'too-long' | 'bad-range' | 'check-failed' | 'source-unavailable' | 'llm-invalid' | 'daily-cap';
/** Why a file or link of "Add your own video" was refused before anything was charged (contract §7.2). */
export type SourceRejection =
  | 'type' | 'size' | 'length' | 'range' | 'ratio' | 'unreadable' | 'link-not-found' | 'private' | 'removed' | 'unsupported-site';
/** Why a product photo was refused (contract §7.1). `too-many` is the form's count rule (1–8 per product). */
export type UploadRejection = 'type' | 'size' | 'unreadable' | 'too-many';
/** Why a job was closed: by the customer ("Stop the job here"), or by itself 30 days after it stopped. */
export type ClosedReason = 'customer' | 'expired';
/** Why a paid pack cannot be refunded (contract §8.1). */
export type RefundRefusal = 'used' | 'too-old';
export type SupportTopic = 'video' | 'refund' | 'payment' | 'account' | 'other';
/** `not-me`: on the video of a person swap, "the person in it is not me / I gave no permission". */
export type ProblemKind = 'looks-different' | 'text-wrong' | 'does-not-play' | 'other' | 'not-me';
/** Paid requests of a job. `clipSeconds` is what the provider bills (a clip shorter than 4 s bills 4 s). */
export interface Paid { images: number; clips: number; clipSeconds: number; music: number; voice: number }

/**
 * The product rules of the flow contract (`docs/specs/2026-10-04-flow-contract.md` §1.4, §1.5). One place: the fakes and the
 * real adapters read them, and the UI writes its numbers from them instead of typing them into a message.
 */
export const RULES = {
  /** The most links one list of "prepare from links" may hold. */
  linkBatchMax: 50,
  passwordMinLength: 8,
  verifyLinkHours: 24,
  resetLinkHours: 1,
  resendSeconds: 60,
  loginAttempts: 5,
  /** The failures of all callers together that lock an email for everybody: far above the caller's own five. */
  loginEmailAttempts: 20,
  loginLockMinutes: 15,
  sessionDays: 30,
  draftHours: 24,
  supportReplyDays: 2,
  checkoutWaitSeconds: 60,
  refundDays: 14,
  reportDays: 7,
  imagesKeptDays: 30,
  stoppedKeptDays: 30,
  videosKeptMonths: 12,
  ownTemplateCredits: 1,
  /** A video of up to `sourceSecondsMax` is taken when the customer picks a part of `rangeSecondsMin`..`rangeSecondsMax`; one of up to `ownVideoSecondsMax` needs no pick. */
  ownVideoSecondsMax: 60, rangeSecondsMin: 3, rangeSecondsMax: 60, sourceSecondsMax: 300,
  /** A running job is "taking longer than usual" past this many times its estimated minutes. */
  delayedFactor: 2,
  /** Person swap: a video of `swapSecondsMin`..`swapSecondsMax`, charged for every started `swapBlockSeconds` of it (`swapCredits`). */
  swapSecondsMin: 3, swapSecondsMax: 30, swapBlockSeconds: 5,
  /** A person's photograph: its short side has at least this many pixels (and the one of the whole body stands upright). */
  swapPhotoShortSideMin: 340,
  /**
   * A person's photographs are deleted `swapPhotosKeptHours` after the job is done; those of a stopped job when it is closed, at the
   * latest `swapStoppedPhotosKeptDays` after it stopped; at once when the admin refuses them or the account is deleted.
   */
  swapPhotosKeptHours: 24, swapStoppedPhotosKeptDays: 7,
  /**
   * A person swap waits at most this long for the admin's look. Then it is refused by itself: closed (`expired`), everything it was
   * charged comes back and its photographs are deleted. Its owner can give the wait up before (`JobRunner.close`), with the same end.
   */
  swapReviewHours: 48,
  /** The finished video of a person swap is kept this long (not `videosKeptMonths`). */
  swapVideosKeptDays: 30,
  /** The version of the text of the three consents a person swap starts with: a start names the one the customer was shown. */
  swapConsentVersion: 'v1',
  /** The people one person-swap video may have replaced, and the longest words (`SwapSlot.hint`) an admin may describe one of them with. */
  swapPeopleMax: 2, swapHintMax: 200,
} as const;

/** Who wrote a ledger entry or did an admin action (B19). The admin's name is the one of the moment of the action. */
export type Actor = { kind: 'system' } | { kind: 'customer' } | { kind: 'admin'; id: Id; name: string };

export interface User { id: Id; email: string; name: string; role: Role; emailVerified: boolean; blocked: boolean;
  /** A password reset, a log-out and a confirmed email change increment this counter; absent on old records means zero. */
  sessionVersion?: number;
  freeVideoAvailable: boolean; locale: Locale; joinedAt: string; lastActiveAt: string;
  authProvider: 'password' | 'google';                   // a Google account has no password to change
  pendingEmail: string | null;                            // a new address waiting for its link; the old one is used until then
  block: { at: string; reason: string; by: Actor } | null }   // set while `blocked`
/** `image`: a frame of the reference video in the middle of the shot, when the engine took one. */
export interface Shot { n: number; from: number; to: number; action: string; text: string; product: number | null; image?: string | null }
/**
 * One person of a person-swap video. `slot`: the number on the person's box, from 1. `box`: where the person stands on the template's
 * image, in percent of it (right and bottom are edges). `hint`: the English words the model finds the person by; the admin's, never shown to a customer.
 */
export interface SwapSlot { slot: number; box: { left: number; top: number; right: number; bottom: number }; hint: string }
/** One part of a person-swap video, generated with one paid request: seconds of the video, `n` from 1. A customer never sees the parts. */
export interface SwapPart { n: number; from: number; to: number }
/** What makes a template a person-swap video (the engine's `card.swap`). `sound`: the video has sound, which the finished video keeps. */
export interface TemplateSwap { people: 1 | 2; persons: SwapSlot[]; parts: SwapPart[]; sound: boolean }
export interface Template {
  referenceImage?: string | null; referenceVideo?: string | null;
  referenceMetric?: { count: number; kind: 'likes' | 'views' };
  id: Id; title: string; category: string; format: Format; seconds: number; referenceViews: string;
  /** Displayed like rate (e.g. '10.1%'); null/absent means unavailable, never zero inferred from missing data. */
  referenceLikes?: string | null;
  image: string; video: string | null; products: number; shots: Shot[]; status: TemplateStatus; ownerId: Id | null;
  timesGenerated: number; editedAt: string; source: ScanSource | 'link';
  description: string;                                    // two or three plain sentences about the structure; '' when there is none
  tags: string[];                                         // short labels shown as chips; may be empty
  preparation: 'preparing' | 'ready' | 'failed' | null;   // a user's own template, or a catalog template that is being prepared; else null
  preparationNote: PreparationNote | null;
  sample: SampleState;
  /** A person-swap video: only the person-swap pages list it, never the gallery of product templates. Absent or null on every other template. */
  swap?: TemplateSwap | null;
  /**
   * A person-swap video, for the admin: its people are not what `template.swap.persons` should stay. `unset`: the preparation suggested none
   * (`template.swap.persons` is one person in a box of the whole picture) and no admin has set them. `pending`: an admin set them and the
   * worker has not written them yet (`template.swap.persons` still shows the ones before). With either, it cannot be published
   * (`AdminQueries.updateTemplate`). Absent: they are set, by the preparation's suggestion or by an admin. A customer's copy has none.
   */
  swapPeople?: 'unset' | 'pending' }
export interface ProductInput { name: string; description: string; images: string[] }
export interface GenerateInput { templateId: Id; products: ProductInput[]; quality: Quality; variants: 1 | 2 | 3; language: string }
/**
 * The photographs of the person for one slot of a person-swap video: what `Uploads.save` returned. `face`: a close photograph of the face,
 * or null. `side`: one taken from the side, when one was given (left out or null: none, as in every job written before there was one).
 */
export interface SwapPhotos { slot: number; body: string; face: string | null; side?: string | null }
/** What the person wears in a person swap: `keep` the clothes of the video, or `photo` those of the photograph. */
export type Outfit = 'keep' | 'photo';
/** What the person-swap form sends: one entry of `people` per slot of the template. `outfit`: left out, the video's clothes stay (`keep`). */
export interface SwapInput { templateId: Id; quality: Quality; people: SwapPhotos[]; outfit?: Outfit }
/** The three boxes of the person-swap form as the customer left them, and the version of their text the form showed (`RULES.swapConsentVersion`). */
export interface SwapConsent {
  ownPerson: boolean;                                     // "the person in the photograph is me, or I have their written permission"
  adults: boolean;                                        // "everybody in the photograph is over 18"
  notCelebrity: boolean;                                  // "nobody famous, and nobody I do not know"
  version: string }
/** The admin's look at the photographs of a person-swap job before anything is generated (`SwapSwitches.swapReview`). */
export type SwapReview = 'waiting' | 'approved' | 'rejected';
export interface Estimate { images: number; clips: number; clipSeconds: number; musicTracks: number; minutes: number;
  credits: number; coveredByFreeVideo: boolean; balance: number; enough: boolean }
export interface JobStep { key: StepKey; status: StepStatus; done: number; total: number }
/** `video` and `image` are set when the variant is `done`. `reason` is set when it is `stopped`. */
export interface JobVariant { id: Id; image: string; video: string | null; status: VariantStatus; reason: StopReason | null }
/**
 * One shot of a job that runs, as far as the engine has made it: `n` (1-based) of variant `variant`. `image` is its first frame once
 * made (a `/media` path, which only the job's owner and the admins open); `clip` is whether its clip is made, `clipUrl` its file (the
 * same kind of path; null when it cannot be opened, or the engine has no file to show).
 */
export interface JobShot { variant: number; n: number; image: string | null; clip: boolean; clipUrl?: string | null }
/** A file made for a variant of a job (a `/media` path, which only the job's owner and the admins open). */
export interface MadeFile { variant: number; url: string }
/** What a job that runs has made besides the shots: the music of each variant, and the pictures every shot of a variant shares (a still, the person who speaks). */
export interface JobMade { music: MadeFile[]; shared: MadeFile[] }
/** The line of a video the engine has not begun: the videos in front of it (being made or waiting), and the minutes until it starts (0: at once). */
export interface EngineQueue { ahead: number; waitMinutes: number }
export interface Job { id: Id; userId: Id; templateId: Id; templateTitle: string; input: GenerateInput; credits: number;
  status: JobStatus; steps: JobStep[]; stoppedReason: StopReason | null; stoppedDetail?: StopDetail | null; startedAt: string; finishedAt: string | null; variants: JobVariant[];
  freeVideo: boolean;                                     // started on the free video (B15)
  creditsReturned: number;                                // credits given back and not charged again (B1): a stopped job, a stopped variant
  queuePosition: number | null;                           // 1 = next to start; set while `queued` (B3)
  delayed: boolean;                                       // running longer than `RULES.delayedFactor` × the estimate (B3)
  paused: boolean;                                        // generation is paused by the admin while this job waits or runs (B10)
  stoppedAt: string | null;
  continueUntil: string | null;                           // last moment a stopped job can be continued; then it closes itself (B17)
  closedAt: string | null; closedReason: ClosedReason | null;
  videoExpiresAt: string | null;                          // the finished videos are deleted then (B13); `videoStored` false after it
  imagesExpireAt: string | null;                          // the product images are deleted then: a missing variant cannot be generated again
  videoStored: boolean; imagesStored: boolean;
  deletedAt: string | null;                               // deleted by the customer (B18): gone from their lists, kept for the admin
  /** While the job runs but the engine has not begun it (its run waits behind others): how many videos are in front of it and about how many minutes until it starts. Null or absent: the engine works on it, or cannot tell. */
  engineQueue?: EngineQueue | null;
  /** The shots with something made, while the job runs; absent when the engine cannot tell which box of the page a shot is. Files may be gone (`imagesStored`). */
  shots?: JobShot[];
  /** The files made besides the shots, while the job runs; absent when the engine has none to show. */
  made?: JobMade;
  /**
   * A person-swap job (`SwapRunner.start`): `input.products` is empty and `input.variants` 1. `review`: null when no look was asked for;
   * `waiting` while the job is `queued` for the admin's look; `rejected`: the job never started, it is closed and its credits returned:
   * the admin refused the photographs (`closedReason` null), its owner gave the wait up (`customer`), or nobody looked within
   * `RULES.swapReviewHours` (`expired`).
   * Absent on every other job.
   */
  swap?: { people: SwapPhotos[]; review: SwapReview | null; outfit?: Outfit } }
export interface LedgerEntry { id: Id; userId: Id; at: string; type: LedgerType; change: number; note: string; balanceAfter: number;
  by: Actor; reason: string | null; relatedJobId: Id | null; relatedPurchaseId: Id | null }
/** `price` is shown as it is ('$19'); null → the UI shows [PRICE]. `priceCents` is the same amount in US cents. */
export interface CreditPack { id: Id; name: string; credits: number; price: string | null; priceCents: number | null }
/**
 * Credits per video (× the number of variants) and for preparing an own template (contract §1.2). `swap`: credits for every started
 * `RULES.swapBlockSeconds` seconds of a person swap (`swapCredits`); absent: the site sells none.
 */
export interface CreditRates { perVideo: Record<Format, Record<Quality, number>>; ownTemplate: number; swap?: Record<Quality, number> }
export interface Purchase { id: Id; userId: Id; packId: Id; packName: string; credits: number; amount: string | null;
  amountCents: number | null; at: string; status: PurchaseStatus; invoiceId: Id | null;
  /** What the payment provider itself reported it charged: the tax it added to the pack price, and the total with it. Absent where no provider reported them (the offline fake). */
  taxCents?: number; totalCents?: number;
  /** The provider's own invoice of the payment (it is the seller): its https address, taken from its verified answer only. Absent where it gave none. */
  invoiceUrl?: string;
  /** Can the customer ask for a refund now. Null when the purchase is not `paid`. */
  refundable: { ok: true; until: string } | { ok: false; reason: RefundRefusal } | null;
  /** Set once a refund was requested. `sentAt` when the admin sent it, `settledAt` when the provider confirmed or failed it. */
  refund: { requestedAt: string; sentAt: string | null; settledAt: string | null; by: Actor | null } | null }
export interface Invoice { id: Id; number: string; userId: Id; purchaseId: Id; date: string; packName: string; credits: number; amount: string | null;
  /** As on the purchase: the provider's tax and its total, where it reported them. */
  taxCents?: number; totalCents?: number }
export interface Checkout { id: Id; userId: Id; pack: CreditPack; returnTo: string; status: CheckoutStatus; purchaseId: Id | null;
  startedAt: string;
  reference: string | null;                               // the payment provider's reference
  delayed: boolean }                                      // `pending` for longer than `RULES.checkoutWaitSeconds`
export interface Scan { id: Id; startedAt: string; source: ScanSource; checked: number; aboveThreshold: number; prepared: number;
  /** How many candidates the scan sent on to scoring; absent in a record older than the count. */
  queued?: number;
  status: 'done' | 'running' | 'stopped'; reason: ScanStopReason | null }
export interface Candidate { referenceMetric?: { count: number; kind: 'likes' | 'views' };
  /** The notes the model wrote with the score, as plain text; absent when it wrote none. */
  scoreNotes?: string[];
  id: Id; title: string; source: ScanSource; views: string; seconds: number; score: number; image: string; foundAt: string }
export type LinkRowStatus = 'queued' | 'exists' | 'invalid' | 'limit' | 'failed';
export interface LinkRow { line: string; status: LinkRowStatus }
export interface SentEmail { id: Id; kind: EmailKind; to: string; at: string; data: Record<string, string> }

export class InsufficientCreditsError extends Error { constructor(public needed: number, public balance: number) { super('insufficient-credits'); } }
export class NotFoundError extends Error { constructor(what: string) { super(`not-found:${what}`); } }
/** The charge would not be the one the customer confirmed, so nothing was charged. `estimate` is the estimate of now. */
export class EstimateChangedError extends Error { constructor(public estimate: Estimate) { super('estimate-changed'); } }
/** A resume would not cost what the customer confirmed, so nothing was charged. `cost` is the cost of now. */
export class PriceChangedError extends Error { constructor(public cost: number) { super('price-changed'); } }
/** A sample would not need the paid requests the admin confirmed, so nothing was started. `paid` is what it needs now. */
export class PaidChangedError extends Error { constructor(public paid: Paid) { super('paid-changed'); } }
/** A sample of this template is already being generated (S11 review I1): nothing new started. `jobId` is the running sample. */
export class SampleRunningError extends Error { constructor(public jobId: Id) { super('sample-running'); } }
/** The admin paused generation (B10): nothing new starts and nothing was charged. */
export class GenerationPausedError extends Error { constructor() { super('generation-paused'); } }
/** The own-video limit of today is reached (B6): nothing was charged. */
export class DailyLimitError extends Error { constructor(public limit: number) { super('daily-limit'); } }
/** A product photo was refused (B7). */
export class UploadRejectedError extends Error { constructor(public reason: UploadRejection) { super(`upload-rejected:${reason}`); } }

export type LogInResult = { ok: true; user: User } | { ok: false; reason: 'invalid' | 'blocked' | 'too-many'; retryAfter: number | null };
/** A link from an email (B14): verification, email change, password reset. */
export type LinkResult<T> = { ok: true } & T | { ok: false; reason: 'expired' | 'used' | 'invalid' };
/** A resend. `retryAfter` is the seconds until the next one is possible (0 when it is now). */
export interface ResendResult { sent: boolean; retryAfter: number }

export interface AuthService {
  signUp(email: string, password: string): Promise<User>;              // creates an unverified user, sends 'verify' with a `token`
  // A wrong password and an unknown email give the same `invalid`; a wrong password counts as a failure too. `RULES.loginAttempts` failures in `RULES.loginLockMinutes` lock the email
  // for that long (`too-many`, also with the right password). A blocked account gives `blocked`.
  // `caller`: who asks, when callers can be told apart (a trusted proxy). The lock is then this caller's alone, and the email locks for everybody at `RULES.loginEmailAttempts`.
  logIn(email: string, password: string, caller?: string): Promise<LogInResult>;
  /** The Google callback: the profile Google gave, or the error it reported. A new email becomes a verified Google account. */
  signInWithGoogle(callback: { email: string; name: string } | { error: 'cancelled' | 'failed' }): Promise<LogInResult | { ok: false; reason: 'cancelled' | 'failed'; retryAfter: null }>;
  verifyEmail(userId: Id): Promise<User>;                              // the demo step: sets emailVerified (+ the free video, see SiteLimits)
  /** Sends a new verification link, at most once per `RULES.resendSeconds`. */
  resendVerification(userId: Id): Promise<ResendResult>;
  /** Opens a link of a 'verify' email: verifies the email, or takes over the pending new address. Single use, `RULES.verifyLinkHours`. */
  /**
   * `signedInAs`: the account whose session the browser that opened the link holds (null: none). The link of a sign-up is completed
   * only there: whoever opened the account chose its password, and the mailbox may be somebody else's. Anywhere else the answer is
   * `login-required`, nothing is verified and the link stays good, to be opened again after logging in.
   */
  confirmEmailLink(token: string, signedInAs: string | null): Promise<LinkResult<{ user: User; purpose: 'verify' | 'email-change' }> | { ok: false; reason: 'login-required' }>;
  // Sends 'reset' with a `token`; silent for an unknown email. At most once per `RULES.resendSeconds` per email (unknown ones too).
  requestPasswordReset(email: string): Promise<ResendResult>;
  /** Is a reset link still good (`RULES.resetLinkHours`, single use)? For the page before the form. */
  checkResetLink(token: string): Promise<LinkResult<{ email: string }>>;
  /** Sets the password through a reset link and uses the link up. */
  resetPasswordWithLink(token: string, password: string): Promise<LinkResult<{ email: string }>>;
  resetPassword(email: string, password: string): Promise<void>;       // without a link: changes nothing (an address proves nothing); use resetPasswordWithLink
  getUser(id: Id): Promise<User | null>;
  /** Log-out: every session of the user ends (`sessionVersion` moves on). Quiet for an unknown user. */
  endSessions(userId: Id): Promise<void>;
  /** Is this the password of the account? Never for an account without one. Asked before an email change. */
  checkPassword(userId: Id, password: string): Promise<boolean>;
  // A new email is not taken over: it becomes `pendingEmail` and a 'verify' email (data.purpose 'email-change') goes to it.
  updateProfile(id: Id, patch: Partial<Pick<User, 'name' | 'email' | 'locale'>>): Promise<User>;
  deleteAccount(id: Id): Promise<void>;                                // Error('job-running') while a job is queued or running (B23)
}
/** The part of a longer video the customer picked, in seconds from its start (the engine's `range`, B2). */
export interface SourceRange { from: number; to: number }
/** What "Add your own video" sends: a public link, or a video file already kept by the upload route. */
export type OwnSource = { kind: 'link'; url: string; range?: SourceRange } | { kind: 'file'; uploadId: string; name: string; type: string; bytes: number; seconds: number | null; width: number | null; height: number | null; range?: SourceRange };
/** `shots` is an analysed count, null/absent until known; the free check never guesses or pays for analysis. */
export type SourceCheck = { ok: true; seconds: number | null; format: Format | null; shots?: number | null; needsRange?: true } | { ok: false; reason: SourceRejection };
export interface TemplateCatalog {
  // Published + the viewer's private ones. A published talking template is listed only while `SiteLimits.showTalkingTemplates` is on; the viewer's own private ones always.
  list(query: { search?: string; category?: string; format?: Format; viewerId?: Id }): Promise<Template[]>;
  get(id: Id, viewerId?: Id): Promise<Template | null>;                // null for another user's private template
  categories(): Promise<string[]>;
  addFromLink(ownerId: Id, url: string): Promise<Template>;            // private, 'preparing'; free. The admin's path (the customer's: prepareOwn)
  // The owner of a private template, or an admin (any template); anyone else and an unknown id → NotFoundError.
  // A template with a running job → Error('template-in-use').
  remove(id: Id, viewerId: Id): Promise<void>;
  /** The free check before anything is charged (B6, contract §7.2). */
  checkSource(ownerId: Id, source: OwnSource): Promise<SourceCheck>;
  /** The part of its video each of these templates' preparation was given (null: none). A template whose part the engine does not keep is left out. */
  sourceParts(templateIds: Id[]): Promise<Map<Id, SourceRange | null>>;
  /** How many own videos the user may still prepare today (`SiteLimits.ownVideosPerDay`, UTC day). */
  ownVideoAllowance(ownerId: Id): Promise<{ used: number; limit: number; left: number }>;
  // Charges `RULES.ownTemplateCredits` and starts the preparation. Same key → the same template, charged once. `confirmedCredits` is what
  // the confirmation showed: a different price of now → PriceChangedError, nothing charged. A refused source → Error('source-rejected:<reason>');
  // the limit of today → DailyLimitError; too few credits → InsufficientCreditsError; paused → GenerationPausedError. When the template
  // cannot be prepared (`failed`), the credit is returned automatically ('returned', by system).
  prepareOwn(ownerId: Id, source: OwnSource, confirmedCredits: number, idempotencyKey: string): Promise<Template>;
}
export interface CreditLedger {
  balance(userId: Id): Promise<number>;                                // spendable: credits held for a refund request are not in it
  held(userId: Id): Promise<number>;                                   // credits held for open refund requests (B16)
  entries(userId: Id): Promise<LedgerEntry[]>;                         // newest first
}
/** What continuing a stopped job costs now (B1, B15, B17), for the stopped page and its confirmation. */
export interface ResumeQuote {
  resumable: boolean;               // false: not stopped, closed, stopped by the content rules (B12), or a person swap while person swap is switched off
  cost: number;                     // what `resume` charges now: the credits returned when it stopped, or 0 on the free video
  charged: number;                  // credits charged when the job was confirmed
  returned: number;                 // credits returned when it stopped (Job.creditsReturned)
  free: boolean;                    // the job started on the free video
  coveredByFreeVideo: boolean;      // continuing uses the free video again (it came back when the job stopped)
  freeUsedElsewhere: boolean;       // a free job whose free video was used on another job since: continuing costs `cost`
  balance: number; enough: boolean;
  missing: Paid;                    // what is generated again
  continueUntil: string | null;
}
export interface Draft { userId: Id; templateId: Id; input: GenerateInput; savedAt: string; expiresAt: string }
export interface JobRunner {
  estimate(userId: Id, input: GenerateInput): Promise<Estimate>;       // GenerationPausedError while generation is paused
  /** B1: would a job on the free video start on this template now? `estimate` covers a job with the free video only then. Reads only. */
  freeVideoOpen(templateId: Id): Promise<boolean>;
  // Throws InsufficientCreditsError; same key → same job. `confirmed` is what the confirmation showed: when the charge of now differs,
  // nothing is charged and EstimateChangedError carries the new estimate. The check and the charge are one step.
  // With `SiteLimits.jobsAtOnce` jobs of the user running, the job is charged and `queued`. Paused → GenerationPausedError.
  start(userId: Id, input: GenerateInput, idempotencyKey: string, confirmed: Pick<Estimate, 'credits' | 'coveredByFreeVideo'>): Promise<Job>;
  /** B20: the job a start with this key made, or null. For "We could not confirm that your job started". */
  findByKey(userId: Id, idempotencyKey: string): Promise<Job | null>;
  get(id: Id, viewerId: Id): Promise<Job | null>;                      // progress is computed from elapsed time on every call
  listFor(userId: Id): Promise<Job[]>;                                 // without deleted ones
  // Stopped → running. `confirmedCost` is what the confirmation showed (`ResumeQuote.cost`): when the cost of now differs,
  // nothing is charged and PriceChangedError carries the new cost. A job that is not stopped is returned as it is.
  // Not resumable (content rule) → Error('not-resumable'). A person swap while `SwapSwitches.personSwap` is off → Error('swap-closed'): nothing is charged.
  resume(id: Id, viewerId: Id, confirmedCost: number): Promise<Job>;
  resumeCost(id: Id, viewerId: Id): Promise<number>;                   // = resumeQuote().cost; owner only, else NotFoundError
  resumeQuote(id: Id, viewerId: Id): Promise<ResumeQuote>;
  /**
   * "Stop the job here": stopped → closed, the saved parts are deleted, nothing is charged. A person swap that waits for the admin's
   * look → closed, everything it was charged returned, its photographs deleted. Closed → as it is. Else Error('not-stopped').
   */
  close(id: Id, viewerId: Id): Promise<Job>;
  /** B2: what generating a stopped variant again costs now (the credits it returned). Error('images-expired') after `imagesExpireAt`. */
  variantCost(id: Id, viewerId: Id, variantId: Id): Promise<number>;
  /** B2: a stopped variant of a delivered job is generated again; the job stays `done`. PriceChangedError and Error('swap-closed') like `resume`. */
  regenerateVariant(id: Id, viewerId: Id, variantId: Id, confirmedCost: number): Promise<Job>;
  /** B18: a delivered job is deleted with its videos; the credits are not returned. Not done → Error('not-deletable'). */
  deleteVideo(id: Id, viewerId: Id): Promise<void>;
}
/**
 * Person swap: the people of a template's video are replaced by the people of the customer's photographs. The job it starts is a job
 * like any other: `JobRunner` reads, lists, continues, closes and deletes it. While `SwapSwitches.personSwap` is off, and for a template
 * that is not a published person-swap video, both calls throw NotFoundError.
 */
export interface SwapRunner {
  // `credits` is `swapCredits(template.seconds, rates.swap[quality])`; the free video never covers a person swap. GenerationPausedError while paused.
  estimate(userId: Id, input: SwapInput): Promise<Estimate>;
  // Like `JobRunner.start`: same key → same job, charged once; InsufficientCreditsError, EstimateChangedError, GenerationPausedError.
  // Before anything is charged: a consent that is not whole (a box left open, or another version than `RULES.swapConsentVersion`) →
  // Error('consent-required'); people that are not one per slot of the template, each with a body photograph the user uploaded → Error('swap-people');
  // a stored photograph under `RULES.swapPhotoShortSideMin` on its short side, a body photograph that is not upright, or one that cannot be measured → Error('swap-photo'), and that photograph is deleted.
  // The consent is kept with the job (who, when, which version; no picture). With `SwapSwitches.swapReview` on, the job is charged and
  // `queued` with `job.swap.review: 'waiting'`, and nothing is generated until the admin approves it.
  start(userId: Id, input: SwapInput, idempotencyKey: string, confirmed: Pick<Estimate, 'credits' | 'coveredByFreeVideo'>, consent: SwapConsent): Promise<Job>;
}
/** B8: the generate form of a user for one template, kept `RULES.draftHours` or until a job starts from that template. */
export interface Drafts {
  save(userId: Id, input: GenerateInput): Promise<Draft>;
  get(userId: Id, templateId: Id): Promise<Draft | null>;
  discard(userId: Id, templateId: Id): Promise<void>;
}
export interface PaymentGateway {
  packs(): Promise<CreditPack[]>;
  rates(): Promise<CreditRates>;
  startCheckout(userId: Id, packId: Id, returnTo: string, idempotencyKey?: string): Promise<{ checkoutId: Id; url: string }>;
  getCheckout(checkoutId: Id, viewerId: Id): Promise<Checkout | null>;         // null for an unknown id or another user's checkout (also for an admin)
  complete(checkoutId: Id, outcome: 'paid' | 'declined'): Promise<Purchase>;   // idempotent per checkoutId; 'paid' adds credits + invoice + 'payment' email
  // B4 provider statuses. The demo accepts paid/declined here; the signed pipeline requires a verified, bound ProviderEvent for money.
  // Its webhook permits late paid after declined/cancelled/expired; paid remains terminal.

  notify(checkoutId: Id, event: 'pending' | 'paid' | 'declined' | 'cancelled' | 'expired'): Promise<Checkout>;
  purchasesFor(userId: Id): Promise<Purchase[]>;
  /** B5/B16: an eligible paid pack → `refund-requested`, its credits held. Already requested → as it is. Not eligible → Error('not-refundable'). */
  requestRefund(userId: Id, purchaseId: Id): Promise<Purchase>;
  /** The customer takes the request back: → `paid`, the credits are free again. Not requested → as it is. */
  cancelRefund(userId: Id, purchaseId: Id): Promise<Purchase>;
  /** The provider's answer to a refund that was sent: `refunded`, or `failed` (the credits come back to the balance). */
  refundSettled(purchaseId: Id, outcome: 'refunded' | 'failed'): Promise<Purchase>;
}
export interface InvoiceStore { listFor(userId: Id): Promise<Invoice[]>; get(id: Id, viewerId: Id): Promise<Invoice | null> }
export interface Mailer { send(kind: EmailKind, to: string, data: Record<string, string>): Promise<void>; outbox(): Promise<SentEmail[]> }
/**
 * Keeps a product photo of the generate form and returns what goes into `ProductInput.images`. Refuses with UploadRejectedError.
 * `kind: 'person'`: the photograph of a person for a person swap; a store that reads the bytes keeps none whose size they do not say.
 */
export interface Uploads { save(userId: Id, file: File, kind?: 'person'): Promise<string>;
  /** Admitted local video custody handle: opaque UUID, never a filesystem path. */
  saveVideo?(userId: Id, file: File): Promise<string>;
}
export interface SupportMessage { reference: string; at: string; topic: SupportTopic; email: string; message: string;
  userId: Id | null; jobId: Id | null; problem: ProblemKind | null }
/** B22: messages to support (contact form, "Report a problem"). Nothing is sent to anyone in the fake. */
export interface SupportDesk {
  // The same `key` (one per form instance) → the same reference and `duplicate: true`.
  send(input: { topic: SupportTopic; email: string; message: string; userId?: Id | null; jobId?: Id | null; key: string }): Promise<{ reference: string; duplicate: boolean }>;
  // "Report a problem" on a delivered job of the user, within `RULES.reportDays` of `finishedAt`; else Error('report-closed').
  // `not-me` on a job that is no person swap → Error('invalid-problem').
  report(userId: Id, jobId: Id, problem: ProblemKind, note: string, key: string): Promise<{ reference: string; duplicate: boolean }>;
  messages(): Promise<SupportMessage[]>;                               // newest first; for the admin and the tests
}

export interface OverviewNumbers { users: number; newSignUps: number; verified: number; payingUsers: number; revenue: string | null;
  creditsSold: number; creditsSpent: number; freeVideosUsed: number; generationCost: string | null; margin: string | null;
  stoppedJobs: number; paymentsNotCompleted: number; templatesWaiting: number;
  refundRequests: number }                                // purchases waiting in `refund-requested`, whatever their date
export interface AdminUserRow { user: User; balance: number; paidTotal: string | null; creditsSpent: number; videos: number }
export interface AdminUserDetail extends AdminUserRow { creditsBought: number; purchases: Purchase[]; jobs: Job[]; ledger: LedgerEntry[] }
export interface SpendingRow { label: string; jobs: number; credits: number; cost: string | null }
/** One day of the admin chart (B24). Amounts in US cents; null when there is nothing to count it from (the cost is not measured). */
export interface DayValue { date: string; revenueCents: number | null; generationCostCents: number | null }
/** B21: the paid requests of a job, for the cost measurement. No price: `costCents` stays null until the cost is measured. */
export interface UsageRow { jobId: Id; at: string; templateId: Id; paid: Paid; costCents: number | null }
/** The answer of an admin action (B25): `already-done` when it had been done before (at `at`), and nothing changed now. */
export interface AdminResult<T> { outcome: 'done' | 'already-done'; at: string; value: T }
export interface AdminSettings { scanTimes: string[]; threshold: number; dailyCandidates: number; dailyTemplates: number; providerAccount: string;
  // Scan sources and limits. Required (task D0): the fake starts from the defaults of `viraleditor/src/contracts.ts`.
  sources: { topads: boolean; shorts: boolean };          // which sources a scan reads
  searches: string[];                                     // the Shorts search list
  secondsMin: number; secondsMax: number;                 // the length a candidate may have
  shortsMinViews: number;
  topAdsIndustry?: string;                               // default beauty-personal-care; optional for old installations
  topAdsCountry?: string;                                // default US
  topAdsPeriod?: 7 | 30 | 180;                            // default 7 days
  topAdsCards: number;
  perScan: number }
/**
 * The site's limits and safety switches (B10, contract §12 "Limits and safety"). The site keeps them, not the engine:
 * the job runner, the catalog and the account read them.
 */
export interface SiteLimits extends SwapSwitches {
  jobsAtOnce: number;                                     // jobs per user at the same time; more are queued
  ownVideosPerDay: number;                                // own videos a user may prepare per day
  freeFirstVideo: boolean;                                // a newly verified account gets the free video
  freeVideosPerDay?: number;                              // K1: free videos the whole site starts in a UTC day; absent = 10
  showTalkingTemplates: boolean;                          // talking templates are listed in the gallery
  dailySpendingLimit: number | null;                      // provider credits per day; null = not set. Not enforced by the fake (no cost known)
  warnAtPercent: number;                                  // 1–100
  onLimitReached: 'pause-new-jobs';
  generationPaused: boolean;                              // no new job, resume or preparation starts; waiting jobs wait
}
/**
 * The switches of person swap, fields of `SiteLimits`. A store written before them has neither: `AdminQueries.limits` then reads
 * person swap off and the look on.
 */
export interface SwapSwitches {
  personSwap?: boolean;                                   // the person-swap pages exist and a person-swap job can start; absent = off
  swapReview?: boolean;                                   // an admin looks at the photographs of every person-swap job before it is generated; absent = on
}
/** The video an admin gives for a person swap: a link, or a file the upload route kept for that admin. `range`: the part of it to use. */
export type SwapSource = { kind: 'link'; url: string; range?: SourceRange } | { kind: 'upload'; uploadId: string; range?: SourceRange };
/** A person-swap job that waits for the admin's look. `email`: its owner's. `template`: the admin's copy of its video (with each `hint`). `decideBy`: when it is refused by itself. */
export interface SwapReviewRow { job: Job; email: string; template: Template | null; decideBy: string }
/**
 * A photograph of a person-swap job, as the admin's look gets it. `shown`: the job waits for the look; `file` is where the photograph
 * is on the disk (null in fake mode, which keeps no file: only its `name`). `decided`: the job has its yes, its photographs are kept
 * for the work and shown to no admin any more. `deleted`: the job has no photograph any more (refused, closed, or past its time).
 */
export type SwapPhoto =
  | { state: 'shown'; name: string; file: { path: string; type: string; size: number } | null }
  | { state: 'decided' }
  | { state: 'deleted' };
/**
 * Is the production system alive: the worker, when it was last seen (ISO time), and whether paid requests can be made.
 * `outOfCredits` is there, and true, only while the worker holds the provider for its credits (the key is set, the account is empty).
 * `provider` is the provider of the product videos; `swap` is the one of person swap, apart from it: `fake` (the pretend one, nothing is paid),
 * `ready`, or `not-configured` (this worker has none it can ask: a person swap would stop). Absent while the worker says nothing of it (no worker yet, or an older one).
 */
export interface EngineHealth { worker: 'running' | 'down'; lastSeen: string | null; provider: 'fake' | 'ready' | 'not-configured'; outOfCredits?: boolean; swap?: SwapProviderState }
export type SwapProviderState = 'fake' | 'ready' | 'not-configured';
export interface AdminQueries {
  overview(period: Period): Promise<OverviewNumbers>;
  users(query: { search?: string; filter?: 'all' | 'paying' | 'free-only' | 'not-verified' | 'blocked' }): Promise<AdminUserRow[]>;
  user(id: Id): Promise<AdminUserDetail | null>;
  addCredits(adminId: Id, userId: Id, credits: number, reason: string, idempotencyKey: string): Promise<LedgerEntry>;
  /** @deprecated use `setAccess` (B25: admin and reason). Kept until the admin pages switch. */
  setBlocked(userId: Id, blocked: boolean): Promise<User>;
  /** Block or unblock with a required reason. The same state again → `already-done`. Error('reason-required'), Error('self'). */
  setAccess(adminId: Id, userId: Id, blocked: boolean, reason: string): Promise<AdminResult<User>>;
  purchases(period: Period): Promise<Purchase[]>;
  packSales(period: Period): Promise<{ pack: CreditPack; sold: number; revenue: string | null }[]>;
  /** @deprecated today's direct refund of a paid purchase; use `refundPurchase` (contract §8.1, §12). Kept until the admin pages switch. */
  refund(purchaseId: Id): Promise<Purchase>;
  // B16: sends the refund of a `refund-requested` purchase (or again after `refund-failed`): → `refund-sent`, the pack's credits are removed.
  // Sent or refunded already → `already-done`. Other states → Error('not-requested'); credits of a failed refund spent since → Error('credits-used').
  refundPurchase(adminId: Id, purchaseId: Id, reason: string, idempotencyKey: string): Promise<AdminResult<Purchase>>;
  ledger(query: { type?: LedgerType; period: Period }): Promise<LedgerEntry[]>;
  spending(period: Period): Promise<{ byQuality: SpendingRow[]; byFormat: SpendingRow[] }>;
  dailySeries(period: Period): Promise<DayValue[]>;                    // B24, oldest day first, one row per UTC day up to today
  usage(period: Period): Promise<UsageRow[]>;                          // B21
  jobs(query: { status?: JobStatus; search?: string }): Promise<Job[]>;
  /** @deprecated use `retryStoppedJob` (B25). */
  retryJob(id: Id): Promise<Job>;
  /** A stopped job runs again from the stopped step; the customer is not charged. Not stopped → `already-done`. */
  retryStoppedJob(adminId: Id, id: Id, reason: string): Promise<AdminResult<Job>>;
  /**
   * Optional (R3). The admin has looked at the provider's task list and found no task for the request that stopped the job with
   * `submission-unknown`: it never reached the provider, so the job can be retried (`retryStoppedJob`). Not stopped for that reason
   * any more → `already-done`; a job stopped for another reason → Error('not-settleable'). Reason required. Engines without paid requests lack it.
   */
  settleUnknownRequest?(adminId: Id, id: Id, reason: string): Promise<AdminResult<Job>>;
  /** @deprecated use `returnJobCredits` (B25). Writes a `returned` entry now. */
  refundJob(id: Id): Promise<LedgerEntry>;
  /** "Return credits": the credits a job was charged and not returned go back to the balance ('returned', by the admin). Once → `already-done`. */
  returnJobCredits(adminId: Id, id: Id, reason: string, idempotencyKey: string): Promise<AdminResult<LedgerEntry>>;
  sampleCost(templateId: Id): Promise<Paid>;                           // the paid requests one sample needs; unknown id → NotFoundError
  // The sample video of a template: a job of the admin with 0 credits and no ledger entry. `confirmed` is what `sampleCost` showed:
  // when the paid requests of now differ, nothing starts and PaidChangedError carries them. When it is done, the template's sample is `current`.
  // While a sample of the template is running, nothing starts: SampleRunningError carries the running job.
  // `products`: the admin's own photographs, at least `template.products` of them (a sample needs the same products a customer gives); fewer → Error('sample-products').
  generateSample(templateId: Id, adminId: Id, confirmed: Paid, products: ProductInput[]): Promise<Job>;
  /** Template id → id of its sample job that is running now (one per template). For "A sample is being generated" + a link to it. */
  runningSamples(): Promise<Record<Id, Id>>;
  templates(query: { status?: TemplateStatus; search?: string }): Promise<Template[]>;
  template(id: Id): Promise<Template | null>;
  // Changing the shots of a template whose sample is `current` makes it `outdated`; publishing with an `outdated` sample → Error('sample-outdated').
  // Publishing a person-swap video whose people are not set (`Template.swapPeople`) → Error('swap-people-unset'); nothing changes.
  updateTemplate(id: Id, patch: Partial<Pick<Template, 'title' | 'category' | 'products' | 'status' | 'shots' | 'description' | 'tags'>>): Promise<Template>;
  candidates(): Promise<Candidate[]>;
  /**
   * The links of an admin's list, each prepared for the catalog by the way of "Add to gallery": a manual candidate is made of the link
   * and `prepareCandidate` is asked for it, once. One row per link, in the order given: `queued` (waits to be prepared), `exists` (the video is
   * a template or a candidate already, or came earlier in the list), `invalid` (not a link the catalog takes: `source-link.ts`),
   * `limit` (the day's templates or candidates are used up: nothing is queued past it), `failed` (the preparation was not taken).
   * Nothing is spent at the provider: a preparation is free, and no sample starts. Not an admin → Error('forbidden'); more than
   * `RULES.linkBatchMax` lines → RangeError('too-many-links'), nothing queued.
   */
  prepareLinks(adminId: Id, lines: string[]): Promise<LinkRow[]>;
  prepareCandidate(id: Id): Promise<Template>;                         // candidate → template with status 'waiting'; the candidate leaves candidates()
  rejectCandidate(id: Id): Promise<void>;                              // candidate removed; unknown id → NotFoundError
  scans(): Promise<Scan[]>;
  runScan(): Promise<Scan>;                                            // adds a running 'topads' scan; while one runs, returns that one
  settings(): Promise<AdminSettings>;
  saveSettings(patch: Partial<AdminSettings>): Promise<AdminSettings>;
  // Person swap: its videos, and the admin's look (`SwapSwitches.swapReview`). Each of them is an admin's alone: anyone else → Error('forbidden'),
  // checked here, in the data layer, whoever the caller is.
  /**
   * A person-swap video is added to the catalog: `waiting` and `preparing` until the engine has cut it into its parts and named its
   * people; then the admin sets each person's box and words and publishes it. Allowed while person swap is switched off (nothing of it
   * is shown to a customer before the switch is on and it is published). The engine's errors of `addFromLink` / `addFromUpload`.
   */
  addSwapTemplate(adminId: Id, source: SwapSource): Promise<Template>;
  /**
   * The people of a person-swap video as the admin sets them: the box of each on the video's image and the words the model finds each
   * by (`swapPeopleProblem` says what they must be; anything else → Error('swap-people-invalid'), nothing changes). The engine checks
   * them again and writes them: the site writes none of it, so the template that comes back may still show the people before, with
   * `swapPeople: 'pending'`. An edit the engine did not take leaves them as they were (`preparationNote: 'check-failed'`).
   * A template that is no person-swap video → NotFoundError; one that is still being prepared → Error('template-not-ready').
   */
  setSwapPeople(adminId: Id, templateId: Id, persons: SwapSlot[]): Promise<Template>;
  /**
   * A person-swap video is published (it is on the person-swap pages while person swap is switched on) or withdrawn (`hidden`: it leaves
   * them, the videos made from it stay). One whose people are not set (or not written yet) is not published → Error('swap-people-unset').
   * A template that is no person-swap video → NotFoundError; another status → RangeError('invalid-status').
   */
  setSwapStatus(adminId: Id, templateId: Id, status: 'published' | 'hidden'): Promise<Template>;
  /** The jobs that wait for the look, the one that waits longest first. One whose `RULES.swapReviewHours` are over is refused, not listed. */
  swapQueue(adminId: Id): Promise<SwapReviewRow[]>;
  /**
   * The answer to the photographs of a job that waits. `approved`: the job takes its place in its owner's line and starts once.
   * `rejected`: it is closed, everything it was charged comes back once, its photographs are deleted at once, and its owner gets one mail.
   * A job that waits no longer (answered, given up, or past its time) → `already-done`, and nothing changes. Unknown job, or one that is
   * no person swap → NotFoundError; another verdict → RangeError('invalid-verdict').
   */
  reviewSwap(adminId: Id, jobId: Id, verdict: 'approved' | 'rejected'): Promise<AdminResult<Job>>;
  /** One photograph of a job, for the look. A slot, or a face or a side photograph, the job never had → NotFoundError. */
  swapPhoto(adminId: Id, jobId: Id, slot: number, kind: 'body' | 'face' | 'side'): Promise<SwapPhoto>;
  limits(): Promise<SiteLimits>;
  saveLimits(adminId: Id, patch: Partial<SiteLimits>): Promise<SiteLimits>;   // RangeError('invalid-limit') for a value out of range
  health(): Promise<EngineHealth>;
}

/** The credits of a person swap: `perBlock` (`CreditRates.swap[quality]`) for every started `RULES.swapBlockSeconds` seconds of the video. */
export function swapCredits(seconds: number, perBlock: number): number {
  return Math.ceil(seconds / RULES.swapBlockSeconds) * perBlock;
}

/** No control character and no mark that reorders what a reader sees: the words of a person become part of a paid request. */
const UNREADABLE = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;
const percent = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 100;
const sameKeys = (value: object, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every((key) => key in value);

/**
 * Why these are not the people of a person-swap video (null: fine): `people`: not one to `swapPeopleMax` persons, each with its slot,
 * box and words and nothing else · `slot`: not numbered from 1 in order · `box`: not four percentages of the picture with left < right
 * and top < bottom · `hint`: not one line of 1 to `swapHintMax` characters. The engine checks the same before it writes them.
 */
export function swapPeopleProblem(persons: unknown): 'people' | 'slot' | 'box' | 'hint' | null {
  if (!Array.isArray(persons) || persons.length < 1 || persons.length > RULES.swapPeopleMax) return 'people';
  for (const [index, person] of persons.entries()) {
    if (typeof person !== 'object' || person === null) return 'people';
    const { slot, box, hint } = person as Partial<SwapSlot>;
    if (slot !== index + 1) return 'slot';
    if (typeof box !== 'object' || box === null || !sameKeys(box, ['left', 'top', 'right', 'bottom'])) return 'box';
    if (![box.left, box.top, box.right, box.bottom].every(percent) || box.left >= box.right || box.top >= box.bottom) return 'box';
    if (typeof hint !== 'string' || hint.trim() === '' || hint.length > RULES.swapHintMax || UNREADABLE.test(hint)) return 'hint';
    if (!sameKeys(person, ['slot', 'box', 'hint'])) return 'people';
  }
  return null;
}

/** Why a picked part cannot be used (null: fine): two numbers, forward, from 0, `rangeSecondsMin`..`rangeSecondsMax` long. The engine checks the same. */
export function rangeProblem(range: SourceRange): 'range' | null {
  const { from, to } = range;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) return 'range';
  return to - from < RULES.rangeSecondsMin || to - from > RULES.rangeSecondsMax ? 'range' : null;
}

/** The free length check of an own video file: `length` when it is over 5 minutes, or over a minute with no part picked; `range` when the part does not fit it (after it is cut at the end, it is still `rangeSecondsMin` long). */
export function fileLengthProblem(seconds: number, range: SourceRange | undefined): 'length' | 'range' | null {
  if (seconds > RULES.sourceSecondsMax) return 'length';
  if (!range) return seconds > RULES.ownVideoSecondsMax ? 'length' : null;
  if (range.from >= seconds || range.to > seconds + 0.5) return 'range';
  return Math.min(range.to, seconds) - range.from < RULES.rangeSecondsMin ? 'range' : null;   // the engine cuts a part that runs past the end at the end
}
