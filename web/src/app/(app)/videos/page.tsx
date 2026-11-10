import { requireUser } from '@/core/session/guards';
import { AutoRefresh } from '@/features/jobs';
import { VideosView, filterRows, hasLiveRow, loadVideoRows, parseFilter } from '@/features/videos';
import { VideosBalance } from './VideosBalance';
import { pageTitle } from '@/core/i18n/page-title';

/** A waiting or running video changes its row slowly; the list asks less often than a job page does. */
const LIST_REFRESH_MS = 5000;

export const generateMetadata = () => pageTitle('videos');

export default async function VideosPage({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const user = await requireUser('/videos');
  const { status } = await searchParams;
  const filter = parseFilter(Array.isArray(status) ? status[0] : status);
  const rows = await loadVideoRows(user.id);
  return (
    <>
      {hasLiveRow(rows) && <AutoRefresh everyMs={LIST_REFRESH_MS} />}
      <VideosView rows={filterRows(rows, filter)} filter={filter} total={rows.length} freeAvailable={user.freeVideoAvailable} />
      <VideosBalance user={user} />
    </>
  );
}
