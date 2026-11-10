import { toCsv } from '@/shared/lib/csv';
import type { RevenuePurchase } from './RevenueView';

/** Purchases as a file. Machine headers; no money columns (money is undecided). */
export function purchasesCsv(purchases: RevenuePurchase[]): string {
  return toCsv([
    ['date', 'email', 'pack', 'credits', 'status', 'invoice'],
    ...purchases.map((p) => [p.at.slice(0, 10), p.email ?? '', p.packName, p.credits, p.status, p.invoiceNumber ?? '']),
  ]);
}
