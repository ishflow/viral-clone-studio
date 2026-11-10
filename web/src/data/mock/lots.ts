import type { Id, LedgerEntry } from '../ports';
import type { LedgerRecord, LotShare } from './store';

// Credits are tracked per lot (B16): a paid pack is one lot (its id is the purchase id), every other credit (admin, opening balance) is
// a lot of its own (the id of its entry). A charge draws from the oldest lots first, skipping held ones; credits returned go back to the
// lots their charge drew from, so a pack whose credits came back from a stopped job is whole again (K23).

/** What is left in each lot of the given entries, in the order the lots were first filled (oldest first). */
export function remainingLots(entries: LedgerRecord[]): Map<Id, number> {
  const lots = new Map<Id, number>();
  for (const entry of entries) {
    const sign = entry.change < 0 ? -1 : 1;
    for (const share of entry.lots) lots.set(share.lot, (lots.get(share.lot) ?? 0) + sign * share.credits);
  }
  return lots;
}

/** Draws `credits` from the lots, oldest first, skipping `held`. Null when they do not hold enough. */
export function drawFrom(lots: Map<Id, number>, credits: number, held: ReadonlySet<Id>): LotShare[] | null {
  const shares: LotShare[] = [];
  let left = credits;
  for (const [lot, remaining] of lots) {
    if (left === 0) break;
    if (held.has(lot) || remaining <= 0) continue;
    const take = Math.min(remaining, left);
    shares.push({ lot, credits: take });
    left -= take;
  }
  return left === 0 ? shares : null;
}

/** Credits coming back: they refill the lots a charge drew from, the last one first, at most what each gave. The rest is a new lot. */
export function refill(credits: number, drawn: LotShare[], newLot: Id): LotShare[] {
  const shares: LotShare[] = [];
  let left = credits;
  for (const share of [...drawn].reverse()) {
    if (left === 0) break;
    const back = Math.min(share.credits, left);
    shares.push({ lot: share.lot, credits: back });
    left -= back;
  }
  if (left > 0) shares.push({ lot: newLot, credits: left });
  return shares;
}

/**
 * Gives entries written without lots (the fixtures, a store from before lots) their lots, replaying them in time order per user:
 * a purchase fills its pack, a refund of a pack draws from that pack, any other credit is its own lot, a charge draws oldest first.
 * An entry that already has lots keeps them.
 */
export function allocateLots(entries: (LedgerEntry & { lots?: LotShare[] })[]): LedgerRecord[] {
  const byUser = new Map<Id, LedgerRecord[]>();
  return entries.map((entry) => {
    const own = byUser.get(entry.userId) ?? [];
    byUser.set(entry.userId, own);
    let lots = entry.lots;
    if (!lots) {
      if (entry.change > 0) lots = [{ lot: entry.type === 'purchase' && entry.relatedPurchaseId ? entry.relatedPurchaseId : entry.id, credits: entry.change }];
      else if (entry.change < 0 && entry.type === 'refund' && entry.relatedPurchaseId) lots = [{ lot: entry.relatedPurchaseId, credits: -entry.change }];
      else if (entry.change < 0) lots = drawFrom(remainingLots(own), -entry.change, new Set()) ?? [];
      else lots = [];
    }
    const record: LedgerRecord = { ...entry, lots };
    own.push(record);
    return record;
  });
}
