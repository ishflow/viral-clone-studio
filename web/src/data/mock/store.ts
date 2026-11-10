import type {
  Actor, AdminSettings, Candidate, ClosedReason, Draft, Id, Invoice, Job, LedgerEntry, Paid, Purchase, Scan, SentEmail, SiteLimits,
  SupportMessage, SwapSwitches, Template, User,
} from '../ports';
import { swapTemplateFixture } from './demo-values';
import { historyFixtures } from './fixtures/history';
import { templateFixtures } from './fixtures/templates';
import { credentialFixtures, missingAdminCredentials, userFixtures } from './fixtures/users';
import { loadStore, persistent } from './persist';

/** Fields of the port's `Job` that `toJob` computes from the record, the clock and the rules: the store does not keep them. */
export type ComputedJobField = 'creditsReturned' | 'queuePosition' | 'delayed' | 'paused' | 'continueUntil' | 'videoExpiresAt' | 'imagesExpireAt'
  | 'videoStored' | 'imagesStored';
/** A job as the store keeps it: the port's `Job` plus what only the site and the fake engine need. */
export interface JobRecord extends Omit<Job, ComputedJobField> {
  /** Fake engine only. Set by resume and retry: the job goes on from the stopped step and does not stop again. */
  resumedAt: string | null;
  /** Fake engine, fixtures only: seconds of progress the job is frozen at, so a running job can always be shown. */
  pinnedElapsed: number | null;
  /** The ledger entry that gave the credits back, so a job is refunded once. */
  refundEntryId: Id | null;
  /** Fake engine only. When the engine began working on the job; null → `startedAt`. A queued job gets it when it leaves the queue. */
  clockFrom: string | null;
  /** Fake engine only. Variant id → when that stopped variant was started again. */
  variantRuns: Record<Id, string>;
  /** What the last regeneration of each variant was charged (credits): a stop returns that, not the price of today's template. Absent on older records. */
  variantCharges?: Record<Id, number>;
  /** Every regeneration keeps its charge and original lot shares; refunded once per run. */
  regenerationCharges?: Record<Id, { variantId: Id; chargeEntryId: Id; lots: LotShare[]; credits: number; refundEntryId: Id | null }>;
  /** The paid requests approved at the start: a queued job is handed to the engine with them. */
  approved: Paid | null;
  /** The ledger entry of the last charge: credits returned go back to the packs it drew from. */
  chargeEntryId: Id | null;
  /** A sample of the admin: no charge, no ledger entry. */
  sample: boolean;
  /** Fields of the port's `Job` the site keeps (the rest of the port's fields are computed by `toJob`). */
  freeVideo: boolean; returnedCredits: number; stoppedAt: string | null; closedAt: string | null; closedReason: ClosedReason | null;
  deletedAt: string | null;
  /** A person swap: the consent it started with (when, and which version of its text); whose it is, is the job's `userId`. No picture. */
  swapConsent?: { at: string; version: string };
  /** A person swap: when the files of its video were deleted (`RULES.swapVideosKeptDays` after it was done, or with its account). Its video is kept no longer. */
  swapVideoGoneAt?: string | null;
}
/** One pack's (or one other credit's) share of a ledger entry: which lot the credits came from or went back to. */
export interface LotShare { lot: Id; credits: number }
/** A ledger entry as the store keeps it: the port's entry plus the lots it drew from (a debit) or filled (a credit). */
export interface LedgerRecord extends LedgerEntry { lots: LotShare[] }
/** A password, as the store keeps it: a salted scrypt hash (password.ts). Not part of `User`, so no page, prop or export can carry it. */
export interface CredentialRecord { userId: Id; hash: string }
/** A link of an email: verification, email change, password reset. Used once. */
export interface TokenRecord { token: string; userId: Id; purpose: 'verify' | 'email-change' | 'reset'; email: string;
  createdAt: string; expiresAt: string; usedAt: string | null }
/** An own video the customer paid to prepare (B6): its charge, and the entry that gave the credit back when it could not be prepared. */
export interface OwnTemplateRecord { templateId: Id; userId: Id; at: string; chargeEntryId: Id; returnedEntryId: Id | null }
/** An admin action (B25): who, what, why, when. Kept, not shown on a page (K16). */
export interface AdminActionRecord { at: string; by: Actor; action: 'refund' | 'return-credits' | 'add-credits' | 'block' | 'unblock' | 'retry-job' | 'settle-unknown' | 'swap-approve' | 'swap-reject';
  target: Id; reason: string }
/** A scan as the store keeps it: the port's `Scan` plus the clock of the fake. */
export interface ScanRecord extends Scan {
  /**
   * When the fake time of a running scan started; it is done `SCAN_SECONDS` later. `runScan` sets it.
   * The running scan of the fixtures has none: it is frozen, so a running scan can always be shown, until "Run a scan now" is pressed.
   */
  clockFrom?: string;
}
/** A checkout as the store keeps it. The port's `Checkout` is made from it on every read. */
export interface CheckoutRecord { id: Id; userId: Id; packId: Id; returnTo: string; purchaseId: Id | null;
  /** The provider's answer that wrote no purchase; null while open or when a purchase settled it. */
  state: 'pending' | 'cancelled' | 'expired' | null;
  startedAt: string; pendingSince: string | null; reference: string }
/** The site's own records of a purchase that the port's `Purchase` computes from: the refund request. */
export type PurchaseRecord = Omit<Purchase, 'refundable'>;

/**
 * The site's own records, and the data of the fake engine (`templates`, `scans`, `candidates`, `settings`):
 * only `engine/fake.ts` reads and writes those four, everything else asks `engine()`.
 */
export interface Store {
  /** Payment metadata is committed atomically with the site ledger and outbox. */
  paymentsState?: import("../real/payments-store").PaymentsState;
  users: User[];
  freeEntitlements: { digest: string; at: string }[];
  credentials: CredentialRecord[];
  templates: Template[];
  jobs: JobRecord[];
  /** Oldest first. Only `writeEntry` in ledger.ts adds to it. */
  ledger: LedgerRecord[];
  purchases: PurchaseRecord[];
  invoices: Invoice[];
  checkouts: CheckoutRecord[];
  outbox: SentEmail[];
  scans: ScanRecord[];
  /** `url`: only the candidates an admin made of a link have one. */
  candidates: (Candidate & { url?: string })[];
  /** The videos the fake took from an admin's links (their keys, with the day), so a template made of one is still known as there. */
  linkKeys?: { key: string; at: string }[];
  settings: AdminSettings;
  /** Idempotency key (see `keyOf`) → id of what the first call created. */
  keys: Map<string, Id>;
  tokens: TokenRecord[];
  /** Failed log-ins per normalized email (ISO times), for the attempts limit. */
  attempts: { email: string; at: string }[];
  /** When something with a resend limit was last sent: `verify:<userId>`, `reset:<email>`. */
  cooldowns: { key: string; at: string }[];
  drafts: Draft[];
  support: SupportMessage[];
  ownTemplates: OwnTemplateRecord[];
  adminActions: AdminActionRecord[];
  /** With the switches of person swap; a store written before them has none: the feature is off. */
  limits: SiteLimits & SwapSwitches;
}

/** K1: the free videos the whole site starts in a UTC day, when the limits name no other number. */
export const FREE_VIDEOS_PER_DAY = 10;

/** The limits of a fresh store: the launch defaults of the contract (§1.4, §12), talking templates hidden (K14). */
export function launchLimits(): SiteLimits {
  return {
    jobsAtOnce: 2, ownVideosPerDay: 3, freeFirstVideo: true, freeVideosPerDay: FREE_VIDEOS_PER_DAY, showTalkingTemplates: false,
    dailySpendingLimit: null, warnAtPercent: 80, onLimitReached: 'pause-new-jobs', generationPaused: false,
  };
}

/** The lists added after the first stores were written to disk: a store without them gets them empty. */
export function newLists(): Pick<Store, 'freeEntitlements' | 'credentials' | 'tokens' | 'attempts' | 'cooldowns' | 'drafts' | 'support' | 'ownTemplates' | 'adminActions'> {
  return { freeEntitlements: [], credentials: [], tokens: [], attempts: [], cooldowns: [], drafts: [], support: [], ownTemplates: [], adminActions: [] };
}

/** `ago(days, minutes)`: the ISO time that long before the store was created. */
export type Ago = (days: number, minutes?: number) => string;

const systemClock = (): Date => new Date();
let clock = systemClock;

/** The one clock of the fakes. It follows the system time, so `vi.setSystemTime()` moves it. */
export function now(): Date {
  return clock();
}
export function setClock(next: () => Date): void {
  clock = next;
}

/** How much faster than real time the fake work runs: the `VC_FAKE_SPEED` env value, 1 when it is not set. */
export function fakeSpeed(): number {
  const speed = Number(process.env.VC_FAKE_SPEED);
  return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

/**
 * Fake mode only: with `VC_FAKE_SWAP=1` the fixtures hold a person-swap video and person swap is switched on, without the admin's
 * look, so that its flow runs to a video. Without it the fixtures are what they were, and the feature is off as in a real store.
 */
const fakeSwap = (): boolean => process.env.VC_FAKE_SWAP === '1';

export function fixtureStore(): Store {
  const created = now().getTime();
  const ago: Ago = (days, minutes = 0) => new Date(created - (days * 1440 + minutes) * 60_000).toISOString();
  const users = userFixtures(ago);
  const templates = [...templateFixtures(ago), ...(fakeSwap() ? [swapTemplateFixture(ago(3))] : [])];
  const history = historyFixtures(ago, templates);
  for (const template of templates) {
    template.timesGenerated = history.jobs.filter((job) => job.templateId === template.id).length;
  }
  // The fixtures show the canvas, and the canvas shows the product with talking templates switched on (contract §1.3).
  return {
    users, templates, ...history, checkouts: [], outbox: [], keys: new Map(), ...newLists(), credentials: credentialFixtures(users),
    limits: { ...launchLimits(), showTalkingTemplates: true, ...(fakeSwap() ? { personSwap: true, swapReview: false } : {}) },
  };
}

/** One opening entry per user for the balance the fixtures give them (none for a balance of 0). */
export function openingEntries(users: User[], ledger: LedgerRecord[], at: string): LedgerRecord[] {
  return users.flatMap((user): LedgerRecord[] => {
    const balance = ledger.reduce((sum, entry) => (entry.userId === user.id ? sum + entry.change : sum), 0);
    const id = `led-opening-${user.id}`;
    return balance > 0 ? [{
      id, userId: user.id, at, type: 'admin', change: balance, note: 'Opening balance', balanceAfter: balance,
      by: { kind: 'system' }, reason: null, relatedJobId: null, relatedPurchaseId: null, lots: [{ lot: id, credits: balance }],
    }] : [];
  });
}

/**
 * The first store next to the real engine: the administrator only (the demo customers are fixtures of the fake mode: here they would be
 * accounts nobody owns in the admin list and the CSV), with the balance of the fixtures as one opening entry.
 * No fixture job, purchase or invoice, and nothing the engine owns.
 */
function openingStore(): Store {
  const fixtures = fixtureStore();
  const users = fixtures.users.filter((user) => user.role === 'admin');
  const { ledger, settings } = fixtures;
  const credentials = fixtures.credentials.filter((credential) => users.some((user) => user.id === credential.userId));
  const at = now().toISOString();
  const opening = openingEntries(users, ledger, at);
  return {
    users, ledger: opening, settings, templates: [], jobs: [], purchases: [], invoices: [], checkouts: [], outbox: [], scans: [], candidates: [],
    keys: new Map(), ...newLists(), credentials, limits: launchLimits(),
  };
}

/** Fake mode: the fixtures. Next to the real engine (`VC_ENGINE=sqlite`): what `site.json` holds, or the opening store when there is no file yet. */
function createStore(): Store {
  if (!persistent()) return fixtureStore();
  const store = loadStore();
  if (!store) return openingStore();
  store.credentials.push(...missingAdminCredentials(store.users, store.credentials));
  return store;
}

// Kept on globalThis: a Next dev hot reload loads this module again, and the data must stay.
const holder = globalThis as typeof globalThis & { __vcFakeStore?: Store };

export function getStore(): Store {
  holder.__vcFakeStore ??= createStore();
  return holder.__vcFakeStore;
}

/** For tests: the next `getStore()` starts again (in fake mode from the fixtures, so the fake engine starts again too), with the system clock. */
export function resetStore(): void {
  holder.__vcFakeStore = undefined;
  clock = systemClock;
}

export function findUser(id: Id): User | undefined {
  return getStore().users.find((user) => user.id === id);
}

/** The stored form of an idempotency key: per kind of action and per user. A blank key is refused. */
export function keyOf(kind: 'job' | 'admin-credits' | 'own-template' | 'admin-refund' | 'admin-return' | 'support', userId: Id, key: string): string {
  if (!key.trim()) throw new Error('idempotency-key-required');
  return `${kind}:${userId}:${key}`;
}

/** Forgets every idempotency key of a user (when the account is deleted). */
export function forgetKeysOf(userId: Id): void {
  const { keys } = getStore();
  for (const key of [...keys.keys()]) {
    if (key.split(':')[1] === userId) keys.delete(key);
  }
}

/** Newest first by an ISO time. Of two records with the same time, the one added later comes first. */
export function newestFirst<T>(items: T[], time: (item: T) => string): T[] {
  return [...items].reverse().sort((a, b) => Date.parse(time(b)) - Date.parse(time(a)));
}
