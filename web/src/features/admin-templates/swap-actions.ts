'use server';

import { z } from 'zod';
import { requireAdmin } from '@/core/session/guards';
import { refreshShell } from '@/core/session/refresh';
import { data } from '@/data';
import { NotFoundError, swapPeopleProblem, type SwapSource, type Template } from '@/data/ports';
import { parseVideoLink } from '@/shared/lib/video-link';
import { refuseForbidden } from '../admin-common/forbidden';

/** Why a person-swap video was not added: `linkInvalid` is the site's own check of the link, the rest are the engine's words for a video it cannot use. */
export type AddSwapError = 'linkInvalid' | 'link' | 'type' | 'size' | 'length' | 'ratio' | 'range' | 'unreadable' | 'uploadFailed' | 'failed';
export type AddSwapState = { status: 'idle' | 'done' | 'error'; id?: string; error?: AddSwapError; providerCap?: boolean };

const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The engine's `source-rejected:<reason>` and what the screen says of it; every reason of a link that cannot be read is one line. */
const REJECTED: Record<string, AddSwapError> = {
  type: 'type', size: 'size', length: 'length', ratio: 'ratio', range: 'range', unreadable: 'unreadable',
  'link-not-found': 'link', private: 'link', removed: 'link', 'unsupported-site': 'link',
};

function sourceOf(form: FormData): SwapSource | AddSwapError {
  if (form.get('kind') === 'link') {
    const parsed = parseVideoLink(String(form.get('url') ?? ''));
    return parsed.ok ? { kind: 'link', url: parsed.url } : 'linkInvalid';
  }
  if (form.get('kind') === 'upload') {
    const uploadId = String(form.get('uploadId') ?? '');
    return UPLOAD_ID.test(uploadId) ? { kind: 'upload', uploadId } : 'uploadFailed';
  }
  return 'failed';
}

/** "Add a person-swap video": a link or the file the upload route kept for this admin. The data layer decides who may; its no is the 403 page. */
export async function addSwapVideo(_previous: AddSwapState, form: FormData): Promise<AddSwapState> {
  const admin = await requireAdmin();
  const source = sourceOf(form);
  if (typeof source === 'string') return { status: 'error', error: source };
  let id: string;
  try {
    id = (await data.admin.addSwapTemplate(admin.id, source)).id;
  } catch (error) {
    refuseForbidden(error);
    const message = error instanceof Error ? error.message : '';
    if (message === 'provider-cap') return { status: 'error', providerCap: true };
    if (message === 'upload-not-found') return { status: 'error', error: 'uploadFailed' };
    return { status: 'error', error: REJECTED[/^source-rejected:(.+)$/.exec(message)?.[1] ?? ''] ?? 'failed' };
  }
  refreshShell();
  return { status: 'done', id };
}

/** What the people form came back with: `pending`: the data layer took them and the worker has not written them into the video yet. */
export type SwapPeopleError = NonNullable<ReturnType<typeof swapPeopleProblem>> | 'notReady' | 'gone' | 'failed';
export type SwapPeopleState = { status: 'idle' | 'saved' | 'error'; error?: SwapPeopleError; pending?: boolean };

const idSchema = z.string().trim().min(1).max(100);
/** The words of a person are what the person typed, without the spaces around them; what they may be is the data layer's rule alone. */
const trimmed = (persons: unknown): unknown =>
  Array.isArray(persons) ? persons.map((person: unknown) => (typeof person === 'object' && person !== null && typeof (person as { hint?: unknown }).hint === 'string'
    ? { ...person, hint: (person as { hint: string }).hint.trim() } : person)) : persons;

/** "Save people": the box and the words of each person of a person-swap video, as the form sent them (`id`, `persons` as JSON). */
export async function saveSwapPeople(_previous: SwapPeopleState, form: FormData): Promise<SwapPeopleState> {
  const admin = await requireAdmin();
  const id = idSchema.safeParse(form.get('id'));
  if (!id.success) return { status: 'error', error: 'gone' };
  let persons: unknown;
  try {
    persons = trimmed(JSON.parse(String(form.get('persons') ?? '')));
  } catch {
    persons = null;
  }
  const problem = swapPeopleProblem(persons);
  if (problem) return { status: 'error', error: problem };
  let pending: boolean;
  try {
    pending = (await data.admin.setSwapPeople(admin.id, id.data, persons as Parameters<typeof data.admin.setSwapPeople>[2])).swapPeople === 'pending';
  } catch (error) {
    refuseForbidden(error);
    if (error instanceof NotFoundError) return { status: 'error', error: 'gone' };
    const message = error instanceof Error ? error.message : '';
    if (message === 'template-not-ready') return { status: 'error', error: 'notReady' };
    return { status: 'error', error: message === 'swap-people-invalid' ? 'people' : 'failed' };
  }
  refreshShell();
  return { status: 'saved', pending };
}

/** What the publish / withdraw buttons came back with: the data layer's `swap-people-unset` is its own reason, not a failed save. */
export type SwapStatusError = 'peopleUnset' | 'transition' | 'notReady' | 'gone' | 'failed';
export type SwapStatusState = { status: 'idle' | 'done' | 'error'; error?: SwapStatusError };

/**
 * One status change of a person-swap video that the page offers, checked here again: the template is loaded first, must be a person-swap
 * video (this is no way to publish or hide a product template) and in one of `from`. Whether its people are set is the data layer's to say.
 */
async function changeSwapStatus(form: FormData, from: Template['status'][], to: 'published' | 'hidden'): Promise<SwapStatusState> {
  const admin = await requireAdmin();
  const id = idSchema.safeParse(form.get('id'));
  if (!id.success) return { status: 'error', error: 'gone' };
  try {
    const template = await data.admin.template(id.data);
    if (!template?.swap) return { status: 'error', error: 'gone' };
    if (!from.includes(template.status)) return { status: 'error', error: 'transition' };
    if (template.preparation === 'preparing' || template.preparation === 'failed') return { status: 'error', error: 'notReady' };
    await data.admin.setSwapStatus(admin.id, template.id, to);
  } catch (error) {
    refuseForbidden(error);
    return { status: 'error', error: error instanceof Error && error.message === 'swap-people-unset' ? 'peopleUnset' : 'failed' };
  }
  refreshShell();
  return { status: 'done' };
}

/** "Publish": waiting or hidden → published. A video whose people are not set (or not written yet) is refused by the data layer. */
export async function publishSwapVideo(_previous: SwapStatusState, form: FormData): Promise<SwapStatusState> {
  return changeSwapStatus(form, ['waiting', 'hidden'], 'published');
}
/** "Withdraw": published → hidden. It leaves the person-swap page; videos already made stay. */
export async function withdrawSwapVideo(_previous: SwapStatusState, form: FormData): Promise<SwapStatusState> {
  return changeSwapStatus(form, ['published'], 'hidden');
}
