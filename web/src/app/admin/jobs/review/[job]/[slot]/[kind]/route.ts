import { swapPhotoResponse } from '@/features/admin-jobs';

export const dynamic = 'force-dynamic';

/** A photograph of a person-swap job that waits for the look: an admin's alone, until the answer, never cached (see `swapPhotoResponse`). */
export async function GET(_request: Request, { params }: { params: Promise<{ job: string; slot: string; kind: string }> }) {
  const { job, slot, kind } = await params;
  return swapPhotoResponse(job, slot, kind);
}
