import { personSwapOpen } from '@/core/person-swap';
import { data } from '@/data';
import type { Id } from '@/data/ports';
import { toRow, type VideoRow } from './rows';

/** All jobs of the user, newest first. */
export async function loadVideoRows(userId: Id): Promise<VideoRow[]> {
  const jobs = (await data.jobs.listFor(userId)).toSorted((a, b) => b.startedAt.localeCompare(a.startedAt));
  const ids = [...new Set(jobs.map((job) => job.templateId))];
  const found = await Promise.all(ids.map((id) => data.catalog.get(id, userId)));
  const templates = new Map(ids.map((id, i) => [id, found[i] ?? null]));
  const swapOpen = await personSwapOpen();
  return jobs.map((job) => toRow(job, templates.get(job.templateId) ?? null, swapOpen));
}
