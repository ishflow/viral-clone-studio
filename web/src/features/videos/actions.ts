'use server';

import { notFound } from 'next/navigation';
import { requireUser } from '@/core/session/guards';
import { refreshShell } from '@/core/session/refresh';
import { data } from '@/data';
import { NotFoundError } from '@/data/ports';

export type DeleteOutcome = { status: 'ok' } | { status: 'error' };

/**
 * "Delete video" (`A-Video-Sil-Onay`, contract §10.1). Only the owner's finished job: someone else's job or an unknown id is a 404; a job
 * that is running or stopped is refused by the runner (`not-deletable`) and comes back as an error. Credits are not returned.
 */
export async function deleteVideo(id: string): Promise<DeleteOutcome> {
  const user = await requireUser();
  if (typeof id !== 'string') return { status: 'error' };
  try {
    await data.jobs.deleteVideo(id, user.id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    return { status: 'error' };
  }
  refreshShell();
  return { status: 'ok' };
}
