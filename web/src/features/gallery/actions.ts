'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/core/session/guards';
import { refreshShell } from '@/core/session/refresh';
import { data } from '@/data';
import { DailyLimitError, GenerationPausedError, InsufficientCreditsError, PriceChangedError, rangeProblem, RULES, type Format, type OwnSource, type SourceRange, type SourceRejection } from '@/data/ports';
import { parseVideoLink } from '@/shared/lib/video-link';
import { linkRefusal, rememberLink, serialPerUser, type LinkRefusal } from './link-limit';
import type { LinkErrorCode } from './schema';

/** What the upload route answered: the opaque id of the kept file and the browser's own (advisory) words about it. */
export type UploadedFile = { uploadId: string; name: string; type: string; bytes: number };
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The file fields of the form, or null when there are none or they are not well formed. */
function uploadedFile(form: FormData): UploadedFile | null {
  const uploadId = form.get('uploadId');
  if (uploadId === null) return null;
  const name = String(form.get('fileName') ?? ''), type = String(form.get('fileType') ?? ''), bytes = Number(form.get('fileBytes'));
  if (typeof uploadId !== 'string' || !UPLOAD_ID.test(uploadId) || name.length > 200 || type.length > 100 || !Number.isSafeInteger(bytes) || bytes < 0) return { uploadId: '', name: '', type: '', bytes: -1 };
  return { uploadId, name, type, bytes };
}

/** What the customer is asked to confirm before anything is charged (contract section 4): the price, the balance, what the check found. */
export type PrepareOffer = { link: string; file?: UploadedFile; range?: SourceRange; key: string; credits: number; balance: number; seconds: number | null; shots: number | null; format: Format | null };
/** `confirm`: the link passed the free check and waits for the customer's yes; `added`: the template is being prepared. */
export type AddVideoState = { providerCap?: boolean; status: 'idle' | 'added' | 'error' | 'confirm'; errors: { link?: LinkErrorCode }; offer?: PrepareOffer };

const REFUSAL_CODE: Record<LinkRefusal, LinkErrorCode> = { duplicate: 'duplicate', 'too-many-preparing': 'tooManyPreparing', limit: 'limit' };
const REJECTION_CODE: Record<SourceRejection, LinkErrorCode> = {
  type: 'type', size: 'size', length: 'length', range: 'range', ratio: 'ratio', unreadable: 'unreadable', 'link-not-found': 'linkNotFound',
  private: 'private', removed: 'removed', 'unsupported-site': 'unsupportedSite',
};
/** A box holds a plain number of seconds: digits, and digits after a point. No exponent, no hex, no sign, no spaces. */
const PLAIN_SECONDS = /^\d+(\.\d+)?$/;
/**
 * The part of the video the form picked (`rangeFrom` / `rangeTo`, seconds): none when both boxes are empty, `'bad'` when only one is
 * filled or a box is not a plain number (the limits themselves are `rangeProblem`'s).
 */
function pickedRange(form: FormData): SourceRange | 'bad' | null {
  const from = String(form.get('rangeFrom') ?? ''), to = String(form.get('rangeTo') ?? '');
  if (from.trim() === '' && to.trim() === '') return null;
  if (!PLAIN_SECONDS.test(from) || !PLAIN_SECONDS.test(to)) return 'bad';
  return { from: Number(from), to: Number(to) };
}
/** `linkRefusal` with the parts of the user's preparing templates the site no longer remembers adding (it restarted), as the engine keeps them. */
async function refusalOf(userId: string, link: string, range: SourceRange | undefined): Promise<LinkRefusal | null> {
  const list = await data.catalog.list({ viewerId: userId });
  const parts = await data.catalog.sourceParts(list.filter((template) => template.ownerId === userId && template.preparation === 'preparing').map((template) => template.id));
  return linkRefusal(userId, link, list, range, parts);
}
const error = (link: LinkErrorCode): AddVideoState => ({ status: 'error', errors: { link } });

/**
 * "Add your own video" with a link, in two steps (contract section 4): without `confirmed` the link is checked for free and the answer is
 * the offer (`confirm`) or the reason it cannot be used; with `confirmed` (the credits the offer showed) and the offer's `key` the
 * template is prepared and the credit is charged once. Per user the limits (security review I1) and the step are one: two parallel calls
 * cannot both pass. Nothing is charged before the second step.
 */
export async function addVideo(_previous: AddVideoState, form: FormData): Promise<AddVideoState> {
  const user = await requireUser();
  const file = uploadedFile(form);
  if (file && file.bytes < 0) return error('failed');
  const parsed = file ? null : parseVideoLink(String(form.get('link') ?? ''));
  if (parsed && !parsed.ok) return error('linkInvalid');
  const link = parsed?.ok ? parsed.url : '';
  const picked = pickedRange(form);
  if (picked === 'bad' || (picked && rangeProblem(picked))) return error('range');
  const range = picked ?? undefined;
  // A file's facts (length, size, shape) come from the store's own probe; the browser's words only travel along.
  const source: OwnSource = file ? { kind: 'file', ...file, seconds: null, width: null, height: null, ...(range ? { range } : {}) } : { kind: 'link', url: link, ...(range ? { range } : {}) };
  const confirmed = form.get('confirmed');
  const key = String(form.get('key') ?? '');
  return serialPerUser(user.id, async (): Promise<AddVideoState> => {
    try {
      const refusal = file ? null : await refusalOf(user.id, link, range);
      if (refusal) return error(REFUSAL_CODE[refusal]);
      const balance = await data.ledger.balance(user.id);
      if (confirmed === null) {
        if ((await data.catalog.ownVideoAllowance(user.id)).left <= 0) return error('dailyLimit');
        const check = await data.catalog.checkSource(user.id, source);
        if (!check.ok) return error(REJECTION_CODE[check.reason]);
        return { status: 'confirm', errors: {}, offer: { link, ...(file ? { file } : {}), ...(range ? { range } : {}), key: crypto.randomUUID(), credits: RULES.ownTemplateCredits, balance, seconds: check.seconds, shots: check.shots ?? null, format: check.format } };
      }
      if (key === '' || confirmed !== String(RULES.ownTemplateCredits)) return error('failed');
      const template = await data.catalog.prepareOwn(user.id, source, RULES.ownTemplateCredits, key);
      if (!file) rememberLink(user.id, template.id, link, range);
      refreshShell();
      revalidatePath('/templates/new');
      return { status: 'added', errors: {} };
    } catch (caught) {
      if (caught instanceof Error && caught.message === 'provider-cap') return { status: 'error', errors: {}, providerCap: true };
      if (caught instanceof InsufficientCreditsError) {
        return { status: 'confirm', errors: {}, offer: { link, ...(file ? { file } : {}), ...(range ? { range } : {}), key, credits: caught.needed, balance: caught.balance, seconds: null, shots: null, format: null } };
      }
      if (caught instanceof PriceChangedError) return error('priceChanged');
      if (caught instanceof DailyLimitError) return error('dailyLimit');
      if (caught instanceof GenerationPausedError) return error('paused');
      const rejected = caught instanceof Error ? /^source-rejected:(.+)$/.exec(caught.message)?.[1] : undefined;
      if (rejected && rejected in REJECTION_CODE) return error(REJECTION_CODE[rejected as SourceRejection]);
      return error('failed');
    }
  });
}

export type RemoveTemplateOutcome = { status: 'error'; code: 'in-use' | 'failed' };

/**
 * "Delete this template": the owner removes their private template, then lands on their templates. An answer means nothing was
 * deleted: a video is being made from it (`in-use`), or it is not theirs / not there any more (`failed`).
 */
export async function removeTemplate(templateId: unknown): Promise<RemoveTemplateOutcome> {
  const user = await requireUser();
  if (typeof templateId !== 'string' || templateId === '') return { status: 'error', code: 'failed' };
  try {
    await data.catalog.remove(templateId, user.id);
  } catch (error) {
    return { status: 'error', code: error instanceof Error && error.message === 'template-in-use' ? 'in-use' : 'failed' };
  }
  revalidatePath('/templates/new');
  redirect('/templates/new');
}
