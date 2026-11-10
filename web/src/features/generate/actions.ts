'use server';

import { redirect } from 'next/navigation';
import { requireUser } from '@/core/session/guards';
import { refreshShell } from '@/core/session/refresh';
import { data } from '@/data';
import { EstimateChangedError, GenerationPausedError, InsufficientCreditsError, UploadRejectedError, type Estimate, type GenerateInput, type User } from '@/data/ports';
import { parseForm, type FieldProblem } from './schema';

export type GenerateOutcome =
  | { status: 'invalid'; problems: FieldProblem[] }
  | { status: 'ready'; estimate: Estimate; title: string; input: GenerateInput }
  // The charge would not be the one the dialog showed: nothing was spent, `estimate` is the estimate of now.
  | { status: 'changed'; estimate: Estimate; title: string; input: GenerateInput }
  // `paused`: the admin paused generation; nothing was charged. `free-video-cap`: the site's free videos of the day are used up.
  | { status: 'error'; code: 'not-ready' | 'paused' | 'provider-cap' | 'free-video-cap' | 'generic' };

const GENERIC = { status: 'error', code: 'generic' } as const;

async function check(raw: unknown): Promise<{ user: User; input: GenerateInput; title: string } | GenerateOutcome> {
  const user = await requireUser();
  const templateId = (raw as { templateId?: unknown } | null)?.templateId;
  const template = typeof templateId === 'string' ? await data.catalog.get(templateId, user.id) : null;
  if (!template) return GENERIC;
  const parsed = parseForm(raw, template.products);
  if (!parsed.ok) return 'problems' in parsed ? { status: 'invalid', problems: parsed.problems } : GENERIC;
  return { user, input: parsed.input, title: template.title };
}

async function estimate(user: User, input: GenerateInput, title: string): Promise<GenerateOutcome> {
  try {
    return { status: 'ready', estimate: await data.jobs.estimate(user.id, input), title, input };
  } catch (error) {
    if (error instanceof Error && error.message === 'provider-cap') return { status: 'error', code: 'provider-cap' };
    if (error instanceof GenerationPausedError) return { status: 'error', code: 'paused' };
    return error instanceof Error && error.message === 'template-not-ready' ? { status: 'error', code: 'not-ready' } : GENERIC;
  }
}

/** "Generate": validates, then returns the estimate. Nothing is spent. */
export async function estimateGeneration(raw: unknown): Promise<GenerateOutcome> {
  const checked = await check(raw);
  if ('status' in checked) return checked;
  return estimate(checked.user, checked.input, checked.title);
}

/** The largest product photo (spec §7.1): a larger one is refused before it is read. */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export type UploadOutcome = { status: 'saved'; path: string } | { status: 'refused'; code: 'type' | 'size' | 'quota' | 'unreadable' };

/**
 * One product photo of the form, sent as `file`. What comes back is what the form sends in `images`: the stored path.
 * A photo that is not a JPEG, PNG or WebP by its bytes, is larger than 10 MB, or is over the user's daily number, is refused with a
 * field error; nothing is kept.
 */
export async function uploadProductImage(form: FormData): Promise<UploadOutcome> {
  const user = await requireUser();
  const file = form.get('file');
  if (!(file instanceof File)) return { status: 'refused', code: 'unreadable' };
  if (file.size > MAX_PHOTO_BYTES) return { status: 'refused', code: 'size' };
  try {
    return { status: 'saved', path: await data.uploads.save(user.id, file) };
  } catch (error) {
    // The demo engine refuses with a typed error, the real one with a message.
    if (error instanceof UploadRejectedError && (error.reason === 'type' || error.reason === 'size' || error.reason === 'unreadable')) return { status: 'refused', code: error.reason };
    const message = error instanceof Error ? error.message : '';
    const codes = { 'upload-type': 'type', 'upload-size': 'size', 'upload-quota': 'quota' } as const;
    return { status: 'refused', code: codes[message as keyof typeof codes] ?? 'unreadable' };
  }
}

/** What the confirmation showed, as the job runner wants it; null when the client did not send it properly. */
function confirmedOf(shown: unknown): Pick<Estimate, 'credits' | 'coveredByFreeVideo'> | null {
  const { credits, free } = (shown ?? {}) as { credits?: unknown; free?: unknown };
  if (typeof credits !== 'number' || !Number.isInteger(credits) || credits < 0 || typeof free !== 'boolean') return null;
  return { credits, coveredByFreeVideo: free };
}

/**
 * "Confirm and generate": one job per idempotency key, then the job page.
 * `shown` is the amount the dialog showed (`credits`, and whether the free video covered it). The job runner charges only while the
 * estimate is still that one; otherwise nothing is spent and the answer is `changed`, with the estimate of now.
 */
export async function confirmGeneration(raw: unknown, key: unknown, shown: unknown): Promise<GenerateOutcome> {
  const checked = await check(raw);
  if ('status' in checked) return checked;
  const confirmed = confirmedOf(shown);
  if (typeof key !== 'string' || key.trim() === '' || !confirmed) return GENERIC;
  const { user, input, title } = checked;
  let jobId: string;
  try {
    jobId = (await data.jobs.start(user.id, input, key, confirmed)).id;
  } catch (error) {
    if (error instanceof EstimateChangedError) return { status: 'changed', estimate: error.estimate, title, input };
    if (error instanceof Error && error.message === 'provider-cap') return { status: 'error', code: 'provider-cap' };
    if (error instanceof Error && error.message === 'free-video-cap') return { status: 'error', code: 'free-video-cap' };
    if (error instanceof GenerationPausedError) return { status: 'error', code: 'paused' };
    if (error instanceof InsufficientCreditsError) return estimate(user, input, title);
    if (error instanceof Error && error.message === 'template-not-ready') return { status: 'error', code: 'not-ready' };
    return GENERIC;
  }
  refreshShell();
  redirect(`/jobs/${jobId}`);
}

/**
 * "We could not confirm that your job started" (R6): did a start with this key make a job? The id when it did, else null. Only the
 * user's own jobs can answer.
 */
export async function findStartedJob(key: unknown): Promise<string | null> {
  const user = await requireUser();
  if (typeof key !== 'string' || key.trim() === '') return null;
  try {
    return (await data.jobs.findByKey(user.id, key))?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * "Buy credits" keeps the form (contract section 5, B8): the entries, with the stored photos, for `RULES.draftHours`. Only a form that is
 * complete is kept; it comes back on the generate page and is dropped when a job starts from the template.
 */
export async function saveFormDraft(raw: unknown): Promise<boolean> {
  const checked = await check(raw);
  if ('status' in checked) return false;
  try {
    await data.drafts.save(checked.user.id, checked.input);
    return true;
  } catch {
    return false;
  }
}
