import { CreditsView } from './CreditsView';
import { loadCredits, loadRevenue } from './load';
import type { Params } from './query';
import { RevenueView } from './RevenueView';

export { purchasesCsv } from './csv';
export { loadRevenue } from './load';

export async function AdminRevenue({ searchParams }: { searchParams: Promise<Params> }) {
  return <RevenueView {...await loadRevenue(await searchParams)} />;
}

export async function AdminCredits({ searchParams }: { searchParams: Promise<Params> }) {
  return <CreditsView {...await loadCredits(await searchParams)} />;
}
