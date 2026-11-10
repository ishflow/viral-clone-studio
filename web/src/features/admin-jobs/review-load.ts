import { requireAdmin } from '@/core/session/guards';
import { data } from '@/data';
import type { SwapReviewRow } from '@/data/ports';
import { refuseForbidden } from '../admin-common/forbidden';

export type PhotoKind = 'body' | 'face' | 'side';
/**
 * A photograph as the line shows it. `src`: the admin route that hands its bytes over, or null when there is no file to hand over
 * (fake mode keeps none: the name alone is shown). Where the file is on the disk never leaves the server.
 */
export type SwapPhotoView = { slot: number; kind: PhotoKind; state: 'shown' | 'decided' | 'deleted'; name: string | null; src: string | null };
export type SwapQueueRow = {
  id: string; userId: string; email: string; templateTitle: string; since: string; decideBy: string; minutesLeft: number; credits: number;
  /** The frame of the video the person is put into, and the words that name each person in it. */
  frame: string | null; hints: string[]; photos: SwapPhotoView[];
};
export type SwapQueueData = { rows: SwapQueueRow[]; lookOn: boolean };

/** The address of one photograph of a job that waits: `app/admin/jobs/review/[job]/[slot]/[kind]`, an admin's alone and never cached. */
export const photoHref = (jobId: string, slot: number, kind: PhotoKind) => `/admin/jobs/review/${encodeURIComponent(jobId)}/${slot}/${kind}`;

/** The data layer says who is an admin; its no is the 403 page. */
async function asAdmin<T>(read: (adminId: string) => Promise<T>): Promise<T> {
  const admin = await requireAdmin();
  try {
    return await read(admin.id);
  } catch (error) {
    refuseForbidden(error);
    throw error;
  }
}

async function photosOf(adminId: string, { job }: SwapReviewRow): Promise<SwapPhotoView[]> {
  const asked = (job.swap?.people ?? []).flatMap((person) => [
    { slot: person.slot, kind: 'body' as const },
    ...(person.face ? [{ slot: person.slot, kind: 'face' as const }] : []),
    ...(person.side ? [{ slot: person.slot, kind: 'side' as const }] : []),
  ]);
  return Promise.all(asked.map(async ({ slot, kind }) => {
    const photo = await data.admin.swapPhoto(adminId, job.id, slot, kind);
    if (photo.state !== 'shown') return { slot, kind, state: photo.state, name: null, src: null };
    return { slot, kind, state: photo.state, name: photo.name, src: photo.file ? photoHref(job.id, slot, kind) : null };
  }));
}

/** `/admin/jobs/review`: the person-swap jobs that wait for the look, as `data.admin.swapQueue` orders them (the longest wait first). */
export async function loadSwapQueue(now = new Date()): Promise<SwapQueueData> {
  return asAdmin(async (adminId) => {
    const [line, limits] = await Promise.all([data.admin.swapQueue(adminId), data.admin.limits()]);
    const rows = await Promise.all(line.map(async (row): Promise<SwapQueueRow> => ({
      id: row.job.id, userId: row.job.userId, email: row.email, templateTitle: row.job.templateTitle, since: row.job.startedAt, decideBy: row.decideBy,
      minutesLeft: Math.max(0, Math.floor((Date.parse(row.decideBy) - now.getTime()) / 60_000)), credits: row.job.credits,
      frame: row.template?.image || null, hints: (row.template?.swap?.persons ?? []).map((person) => person.hint).filter(Boolean),
      photos: await photosOf(adminId, row),
    })));
    return { rows, lookOn: limits.swapReview !== false };
  });
}

/** How many jobs wait for the look: the number on the link of `/admin/jobs`. */
export async function countSwapQueue(): Promise<number> {
  return asAdmin(async (adminId) => (await data.admin.swapQueue(adminId)).length);
}
