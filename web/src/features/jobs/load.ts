import { notFound } from 'next/navigation';
import { requireUser } from '@/core/session/guards';
import { data } from '@/data';
import type { Job, Template, User } from '@/data/ports';

/** The signed-in owner's job and its template. Someone else's job, or an unknown id, is a 404. */
export async function loadJob(id: string, path = `/jobs/${id}`): Promise<{ user: User; job: Job; template: Template | null }> {
  const user = await requireUser(path);
  const job = await data.jobs.get(id, user.id);
  if (!job) notFound();
  return { user, job, template: await data.catalog.get(job.templateId, user.id) };
}
