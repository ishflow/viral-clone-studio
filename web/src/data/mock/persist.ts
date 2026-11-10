import { assertSiteOwner } from '../real/site-lock';
import type * as Fs from 'node:fs';
import type * as Path from 'node:path';
import { allocateLots } from './lots';
import { launchLimits, newLists } from './store';
import type { Invoice, JobVariant, SiteLimits, Template, User } from '../ports';
import type { CheckoutRecord, JobRecord, LedgerRecord, PurchaseRecord, Store } from './store';

// Next to the real production system (`VC_ENGINE=sqlite`) the site's own records must outlive the process: the store is one JSON file.
// In fake mode nothing here runs: no file is read and none is written.

// The Node modules are looked up when they are needed, not imported. Two client components of the checkout pull `@/data` into
// the browser bundle (through features/checkout/draft.ts), and a bundle for the browser cannot hold `node:fs`. In a browser nothing here runs.
const fs = (): typeof Fs => process.getBuiltinModule('node:fs');
const path = (): typeof Path => process.getBuiltinModule('node:path');

/** Is the store kept on disk? The env is read on every call. */
export function persistent(): boolean {
  return process.env.VC_ENGINE === 'sqlite';
}

/** The data directory: `VC_DATA_DIR`. Next to the real engine it must be set: the site does not guess where its records are. */
export function dataDir(): string {
  const dir = process.env.VC_DATA_DIR;
  if (!dir) throw new Error('data-dir-required: set VC_DATA_DIR (with VC_ENGINE=sqlite the site keeps its store there)');
  return path().resolve(dir);
}

export function siteFile(): string {
  return path().join(dataDir(), 'site.json');
}

const LISTS = ['users', 'templates', 'jobs', 'ledger', 'purchases', 'invoices', 'checkouts', 'outbox', 'scans', 'candidates', 'keys'] as const;

/** The text of the store as it is on disk; null when there is no file. */
let onDisk: string | null = null;

/** `keys` is a Map: it is written as its entries. */
function serialize(store: Store): string {
  return JSON.stringify({ ...store, keys: [...store.keys] }, null, 2);
}

function parse(text: string): Store {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null) throw new Error('not a store');
  const fields = raw as Record<string, unknown>;
  const missing = LISTS.find((key) => !Array.isArray(fields[key]));
  if (missing) throw new Error(`"${missing}" is not a list`);
  if (typeof fields.settings !== 'object' || fields.settings === null) throw new Error('"settings" is missing');
  return upgrade({ ...(fields as unknown as Store), keys: new Map(fields.keys as [string, string][]) });
}

/**
 * A store written before the flow contract fields (task D0) gets them with the values that keep its meaning: no new list is lost,
 * a job keeps its charge, an entry gets its lots by replaying the ledger. A field that is there is kept.
 */
function upgrade(store: Store): Store {
  // What is read may lack any field added since: the defaults go first, what the file holds wins.
  // The order of the keys stays the one of the file, so a store read and written again is the same text.
  const filled = <T extends object>(defaults: Partial<T>, value: T): T =>
    ({ ...value, ...Object.fromEntries(Object.entries(defaults).filter(([key]) => !(key in value))) }) as T;
  const jobs = store.jobs.map((job) => filled<JobRecord>({
    clockFrom: null, variantRuns: {}, approved: null, chargeEntryId: null, sample: false, freeVideo: false, returnedCredits: 0,
    stoppedAt: null, closedAt: null, closedReason: null, deletedAt: null,
  }, { ...job, variants: job.variants.map((variant) => filled<JobVariant>({ status: 'done', reason: null }, variant)) }));
  const ledger = allocateLots(store.ledger.map((entry) => filled<LedgerRecord>({ by: { kind: 'customer' }, reason: null, relatedJobId: null, relatedPurchaseId: null }, entry)));
  const lists = filled<Store>({ ...newLists(), limits: launchLimits() }, store);
  return {
    ...lists,
    limits: filled<SiteLimits>(launchLimits(), lists.limits),
    users: store.users.map((user) => filled<User>({ authProvider: 'password', pendingEmail: null, block: null }, user)),
    jobs, ledger,
    purchases: store.purchases.map((purchase) => filled<PurchaseRecord>({ amountCents: null, refund: null }, purchase)),
    invoices: store.invoices.map((invoice) => filled<Invoice>({ amount: null }, invoice)),
    checkouts: store.checkouts.map((checkout) => filled<CheckoutRecord>({
      state: null, startedAt: new Date(0).toISOString(), pendingSince: null, reference: `PAY-${checkout.id.slice(0, 8).toUpperCase()}`,
    }, checkout)),
    templates: store.templates.map((template) => filled<Template>({ sample: template.video ? 'current' : 'none' }, template)),
  };
}

/**
 * The store of `site.json`, or null when there is no such file yet.
 * A file that cannot be read as a store throws an error that names it: the site never starts over silently.
 */
export function loadStore(): Store | null {
  assertSiteOwner(dataDir());
  const file = siteFile();
  let text: string;
  try {
    text = fs().readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    onDisk = null;
    return null;
  }
  try {
    const store = parse(text);
    onDisk = text;
    return store;
  } catch (error) {
    throw new Error(`site-store-unreadable: ${file} (${error instanceof Error ? error.message : String(error)})`, { cause: error });
  }
}

/** Writes the store when it differs from what is on disk: a temp file first, then a rename, so a reader never sees half a file. */
export function saveStore(store: Store): void {
  assertSiteOwner(dataDir());
  const text = serialize(store);
  if (text === onDisk) return;
  const file = siteFile();
  fs().mkdirSync(path().dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs().openSync(temp, 'w', 0o600);                  // the file holds the password hashes: the owner only
  try {
    fs().writeSync(fd, text);
    fs().fsyncSync(fd);                                        // on disk before it replaces the old file: a power loss leaves one or the other
  } finally {
    fs().closeSync(fd);
  }
  fs().renameSync(temp, file);
  onDisk = text;
}
