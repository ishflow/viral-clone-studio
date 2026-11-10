import { loadJobs } from './load';
import { JobsView } from './JobsView';
import { countSwapQueue, loadSwapQueue } from './review-load';
import { SwapQueueView } from './SwapQueueView';

export { swapPhotoResponse } from './review-photo';

export async function AdminJobs({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [jobs, reviewWaiting] = await Promise.all([loadJobs(await searchParams), countSwapQueue()]);
  return <JobsView {...jobs} reviewWaiting={reviewWaiting} />;
}

/** `/admin/jobs/review`: the person-swap jobs that wait for an admin's look at their photographs. */
export async function AdminSwapQueue() {
  return <SwapQueueView {...await loadSwapQueue()} />;
}
