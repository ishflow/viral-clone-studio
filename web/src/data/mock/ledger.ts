import { InsufficientCreditsError } from '../ports';
import type { Actor, CreditLedger, Id, LedgerEntry, LedgerType } from '../ports';
import { drawFrom, refill, remainingLots } from './lots';
import { getStore, newestFirst, now } from './store';
import type { LedgerRecord, LotShare } from './store';

const entriesOf = (userId: Id): LedgerRecord[] => getStore().ledger.filter((entry) => entry.userId === userId);

/** The packs of a user whose credits are held: a refund was requested and is not answered yet (B16). */
export function heldLotsOf(userId: Id): Set<Id> {
  return new Set(getStore().purchases.filter((purchase) => purchase.userId === userId && purchase.status === 'refund-requested').map((purchase) => purchase.id));
}

/** What is left in each lot of the user (a pack's lot is its purchase id). */
export function lotsOf(userId: Id): Map<Id, number> {
  return remainingLots(entriesOf(userId));
}

/** Credits held for open refund requests. */
export function heldOf(userId: Id): number {
  const lots = lotsOf(userId);
  return [...heldLotsOf(userId)].reduce((sum, lot) => sum + Math.max(0, lots.get(lot) ?? 0), 0);
}

/** The spendable balance: every credit of the user, without the ones held for a refund request. */
export function balanceOf(userId: Id): number {
  const total = getStore().ledger.reduce((sum, entry) => (entry.userId === userId ? sum + entry.change : sum), 0);
  return total - heldOf(userId);
}

/** The port's entry, without the lots only the store needs. */
export function toEntry(record: LedgerRecord): LedgerEntry {
  const entry: Partial<LedgerRecord> = { ...record };
  delete entry.lots;
  return structuredClone(entry) as LedgerEntry;
}

export interface EntryMeta {
  by?: Actor; reason?: string | null; jobId?: Id | null; purchaseId?: Id | null;
  /** A credit: the lots of the charge it gives back (see `refill`). */
  backTo?: LotShare[];
  /** A debit: the one lot it must come from (a pack whose refund is sent). */
  from?: Id;
}

function defaultActor(type: LedgerType): Actor {
  return type === 'purchase' || type === 'generation' || type === 'free-video' ? { kind: 'customer' } : { kind: 'system' };
}

/**
 * The only writer of the ledger. Credits are whole numbers and a balance never goes below zero:
 * a change that breaks either rule throws and writes nothing. A debit takes spendable credits only (held ones stay held), oldest lot first.
 */
export function writeEntry(userId: Id, type: LedgerType, change: number, note: string, meta: EntryMeta = {}): LedgerEntry {
  return toEntry(writeRecord(userId, type, change, note, meta));
}

/** `writeEntry`, returning the stored record (with its lots). */
export function writeRecord(userId: Id, type: LedgerType, change: number, note: string, meta: EntryMeta = {}): LedgerRecord {
  if (!Number.isInteger(change)) throw new RangeError('credits-must-be-whole');
  const balance = balanceOf(userId);
  const id = crypto.randomUUID();
  let lots: LotShare[] = [];
  if (change < 0) {
    const remaining = lotsOf(userId);
    const drawn = meta.from !== undefined
      ? ((remaining.get(meta.from) ?? 0) >= -change ? [{ lot: meta.from, credits: -change }] : null)
      : drawFrom(remaining, -change, heldLotsOf(userId));
    if (!drawn) throw new InsufficientCreditsError(-change, balance);
    lots = drawn;
  } else if (change > 0) {
    const ownLot = type === 'purchase' && meta.purchaseId ? meta.purchaseId : id;
    lots = refill(change, meta.backTo ?? [], ownLot);
  }
  const heldNow = (lot: Id): boolean => heldLotsOf(userId).has(lot);
  // A credit into a held pack (a charge on it that comes back) stays held: it is not spendable.
  const spendableChange = change < 0 ? (meta.from !== undefined && heldNow(meta.from) ? 0 : change)
    : lots.reduce((sum, share) => sum + (heldNow(share.lot) ? 0 : share.credits), 0);
  const record: LedgerRecord = {
    id, userId, at: now().toISOString(), type, change, note, balanceAfter: balance + spendableChange,
    by: meta.by ?? defaultActor(type), reason: meta.reason ?? null, relatedJobId: meta.jobId ?? null, relatedPurchaseId: meta.purchaseId ?? null, lots,
  };
  getStore().ledger.push(record);
  // A refunded pack is closed, its money is back with the buyer: credits of a charge on it that come back afterwards leave it again at once.
  for (const share of change > 0 ? lots : []) {
    const pack = getStore().purchases.find((purchase) => purchase.id === share.lot && purchase.userId === userId && purchase.status === 'refunded');
    if (pack) writeRecord(userId, 'refund', -share.credits, pack.packName, { by: { kind: 'system' }, purchaseId: pack.id, from: pack.id });
  }
  return record;
}

export const ledger: CreditLedger = {
  async balance(userId) {
    return balanceOf(userId);
  },
  async held(userId) {
    return heldOf(userId);
  },
  /** Newest first. */
  async entries(userId) {
    return newestFirst(entriesOf(userId), (entry) => entry.at).map(toEntry);
  },
};
