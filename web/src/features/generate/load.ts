import { notFound } from 'next/navigation';
import { requireUser } from '@/core/session/guards';
import { data } from '@/data';
import type { GenerateInput, Quality } from '@/data/ports';
import type { GenerateTemplate } from './GenerateForm';

export type GenerateLoad =
  // `rates`: credits per variant of this template's format, for the price line of the form. `free`: the user still has the free video, and one would start on this template now.
  // `freeHeld`: the user has the free video, but today's share on this template is used up, so this one is made with credits and the form says why.
  // `paused`: the admin paused generation, so the form says so and its Generate is off (the server still refuses a start, as before).
  // `draft`: the form of the last visit, kept for 24 hours (B8); with no draft, the entries of the job named by `from`, and then `fromJob`.
  // `draftKey`: where this tab keeps the form while the customer is away from the page; it carries the user, so another account in the same tab never sees it.
  | { ready: true; template: GenerateTemplate; rates: Record<Quality, number>; free: boolean; freeHeld: boolean; paused: boolean; draft: GenerateInput | null; fromJob: boolean; draftKey: string }
  // `failed`: the template did not fit and never will be ready; false: it is still being prepared.
  | { ready: false; failed: boolean; template: Pick<GenerateTemplate, 'id' | 'title'> };

/** The entries of one of the user's finished jobs on this template, as a form to start from. Its photos come along only while the job still keeps them. */
async function entriesOfJob(userId: string, templateId: string, jobId: string): Promise<GenerateInput | null> {
  const job = await data.jobs.get(jobId, userId);
  if (!job || job.status !== 'done' || job.templateId !== templateId) return null;
  return { ...job.input, products: job.input.products.map((p) => (job.imagesStored ? p : { ...p, images: [] })) };
}

/**
 * What `/templates/[id]/generate` shows. Signed out → login and back; an unknown template or someone else's own template → 404.
 * An own template that is still being prepared, or did not fit, has no form yet: `ready: false`.
 */
export async function loadGenerate(id: string, from?: string): Promise<GenerateLoad> {
  const user = await requireUser(`/templates/${id}/generate`);
  const template = await data.catalog.get(id, user.id);
  if (!template) notFound();
  if (template.preparation === 'preparing' || template.preparation === 'failed') return { ready: false, failed: template.preparation === 'failed', template: { id, title: template.title } };
  // The price line reads the rate card (the table the estimator uses); nothing is asked of the job runner here, so a pause does not hide the form.
  const [rates, draft, limits] = await Promise.all([data.payments.rates(), data.drafts.get(user.id, id), data.admin.limits()]);
  const saved = draft?.input ?? null;
  const fromInput = saved === null && from ? await entriesOfJob(user.id, id, from) : null;
  const freeOpen = user.freeVideoAvailable && await data.jobs.freeVideoOpen(id).catch(() => true);
  return {
    ready: true,
    template: { id, title: template.title, image: template.image, products: template.products, shots: template.shots.length, seconds: template.seconds, format: template.format },
    rates: rates.perVideo[template.format],
    // B1: only while a free video on this template would start now, as the estimate says (a question that only reads and that a
    // pause does not refuse). A template that cannot be asked about keeps the line.
    free: freeOpen,
    freeHeld: user.freeVideoAvailable && !freeOpen && template.format === 'no-talking',
    paused: limits.generationPaused,
    draft: saved ?? fromInput,
    fromJob: fromInput !== null,
    draftKey: `vc:draft:generate:${user.id}:${id}`,
  };
}
