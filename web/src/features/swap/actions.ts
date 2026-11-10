'use server';

import { redirect } from 'next/navigation';
import { requireUser } from '@/core/session/guards';
import { refreshShell } from '@/core/session/refresh';
import { data } from '@/data';
import { EstimateChangedError, GenerationPausedError, InsufficientCreditsError, NotFoundError, UploadRejectedError, type Estimate, type SwapInput, type User } from '@/data/ports';
import { parseSwapForm } from './schema';

export type SwapOutcome =
  | { status: 'ready'; estimate: Estimate }
  // The charge would not be the one the window showed: nothing was spent, `estimate` is the estimate of now.
  | { status: 'changed'; estimate: Estimate }
  // `people`: a photograph is missing or not the user's. `consent`: a box is open, or the text changed. `paused`: generation is paused.
  // `gone`: the video is not offered (any more), or person swap is switched off. `photo`: a stored photograph is too small, not upright or
  // cannot be measured; it was deleted. Nothing was charged in any of them.
  | { status: 'error'; code: 'people' | 'photo' | 'consent' | 'paused' | 'gone' | 'generic' };

const GENERIC = { status: 'error', code: 'generic' } as const;

/** What a refusal of the data layer is to the form; null for one the form has no words for. */
function refusalOf(error: unknown): SwapOutcome | null {
  if (error instanceof NotFoundError) return { status: 'error', code: 'gone' };
  if (error instanceof GenerationPausedError) return { status: 'error', code: 'paused' };
  if (error instanceof Error && error.message === 'consent-required') return { status: 'error', code: 'consent' };
  if (error instanceof Error && error.message === 'swap-people') return { status: 'error', code: 'people' };
  if (error instanceof Error && error.message === 'swap-photo') return { status: 'error', code: 'photo' };
  return null;
}

async function estimate(user: User, input: SwapInput): Promise<SwapOutcome> {
  try {
    return { status: 'ready', estimate: await data.swap.estimate(user.id, input) };
  } catch (error) {
    return refusalOf(error) ?? GENERIC;
  }
}

/** "Start": the estimate of the data layer for this video. Nothing is spent. */
export async function estimateSwap(raw: unknown): Promise<SwapOutcome> {
  const user = await requireUser();
  const parsed = parseSwapForm(raw);
  return parsed ? estimate(user, parsed.input) : GENERIC;
}

/**
 * "Confirm and start": one job per idempotency key, then the job page. `shown` is the amount the window showed; the data layer charges
 * only while the estimate is still that one, and only with the whole consent and the user's own photographs.
 */
export async function confirmSwap(raw: unknown, key: unknown, shown: unknown): Promise<SwapOutcome> {
  const user = await requireUser();
  const parsed = parseSwapForm(raw);
  const credits = (shown as { credits?: unknown } | null)?.credits;
  if (!parsed || typeof key !== 'string' || key.trim() === '' || typeof credits !== 'number' || !Number.isInteger(credits) || credits < 0) return GENERIC;
  let jobId: string;
  try {
    jobId = (await data.swap.start(user.id, parsed.input, key, { credits, coveredByFreeVideo: false }, parsed.consent)).id;
  } catch (error) {
    if (error instanceof EstimateChangedError) return { status: 'changed', estimate: error.estimate };
    if (error instanceof InsufficientCreditsError) return estimate(user, parsed.input);
    return refusalOf(error) ?? GENERIC;
  }
  refreshShell();
  redirect(`/jobs/${jobId}`);
}

/** No answer to a start came back: did a start with this key make a job? The id when it did, else null. Only the user's own jobs can answer. */
export async function findStartedSwap(key: unknown): Promise<string | null> {
  const user = await requireUser();
  if (typeof key !== 'string' || key.trim() === '') return null;
  try {
    return (await data.jobs.findByKey(user.id, key))?.id ?? null;
  } catch {
    return null;
  }
}

/** The largest photograph (the product photo rule): a larger one is refused before it is read. */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export type PhotoOutcome = { status: 'saved'; path: string } | { status: 'refused'; code: 'type' | 'size' | 'quota' | 'unreadable' };

/** One photograph of the person, sent as `file`. What comes back is the stored path the form sends. A refused photograph is not kept. */
export async function uploadPersonPhoto(form: FormData): Promise<PhotoOutcome> {
  const user = await requireUser();
  const file = form.get('file');
  if (!(file instanceof File)) return { status: 'refused', code: 'unreadable' };
  if (file.size > MAX_PHOTO_BYTES) return { status: 'refused', code: 'size' };
  try {
    return { status: 'saved', path: await data.uploads.save(user.id, file, 'person') };
  } catch (error) {
    // The demo engine refuses with a typed error, the real one with a message.
    if (error instanceof UploadRejectedError && (error.reason === 'type' || error.reason === 'size' || error.reason === 'unreadable')) return { status: 'refused', code: error.reason };
    const message = error instanceof Error ? error.message : '';
    const codes = { 'upload-type': 'type', 'upload-size': 'size', 'upload-quota': 'quota' } as const;
    return { status: 'refused', code: codes[message as keyof typeof codes] ?? 'unreadable' };
  }
}
