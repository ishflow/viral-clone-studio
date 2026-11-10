import { loadOverview } from './load';
import { OverviewView } from './OverviewView';

export async function AdminOverview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <OverviewView {...await loadOverview((await searchParams).period)} />;
}
