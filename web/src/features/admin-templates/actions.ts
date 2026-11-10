'use server';

import { z } from 'zod';
import { requireAdmin } from '@/core/session/guards';
import { refreshShell } from '@/core/session/refresh';
import { data } from '@/data';
import { NotFoundError, PaidChangedError, RULES, type LinkRow, type Paid, type TemplateStatus } from '@/data/ports';
import { parseVideoLink } from '@/shared/lib/video-link';
import { runningSample } from './sample';
import { parseEditForm, type EditErrors } from './schema';

export type ActionState = { providerCap?: boolean; status: 'idle' | 'done' | 'error'; error?: 'transition' };
export type LinkState = { providerCap?: boolean; status: 'idle' | 'done' | 'error'; error?: 'linkInvalid' | 'linkFailed' };
export type LinkListState = { status: 'idle' | 'done' | 'error'; rows: LinkRow[]; error?: 'empty' | 'tooMany' | 'failed' };
export type SaveState = { status: 'idle' | 'saved' | 'hidden' | 'error'; errors: EditErrors };

const idSchema = z.string().trim().min(1).max(100);
const idOf = (form: FormData) => idSchema.safeParse(form.get('id'));

/** One guarded write on a candidate; the form carries only its `id`. */
async function run(form: FormData, write: (id: string) => Promise<unknown>): Promise<ActionState> {
  await requireAdmin();
  const id = idOf(form);
  if (!id.success) return { status: 'error' };
  try {
    await write(id.data);
  } catch (error) {
    if (error instanceof Error && error.message === 'provider-cap') return { status: 'error', providerCap: true };
    return { status: 'error' };
  }
  refreshShell();
  return { status: 'done' };
}
/** A gallery card needs a category (it is the filter and the card's line), a sample image and a finished preparation. */
const publishable = (template: { image: string; category: string; preparation: string | null }) =>
  template.category.trim() !== '' && template.image !== '' && template.preparation !== 'preparing' && template.preparation !== 'failed';

/**
 * A status change the UI offers, checked here again: the template is loaded first and must be in one of `from`
 * (never `private`); publishing also needs a sample image. A forged form changes nothing.
 */
async function changeStatus(form: FormData, from: TemplateStatus[], to: TemplateStatus): Promise<ActionState> {
  await requireAdmin();
  const id = idOf(form);
  if (!id.success) return { status: 'error' };
  try {
    const template = await data.admin.template(id.data);
    if (!template) return { status: 'error' };
    if ((to === 'published' && template.status === 'hidden' && template.sample !== 'current') || !from.includes(template.status) || (to === 'published' && (!publishable(template) || template.sample === 'outdated'))) return { status: 'error', error: 'transition' };
    await data.admin.updateTemplate(template.id, { status: to });
  } catch (error) {
    if (error instanceof Error && error.message === 'provider-cap') return { status: 'error', providerCap: true };
    return { status: 'error' };
  }
  refreshShell();
  return { status: 'done' };
}

/** Waiting → published; a hidden template may be republished only with a current sample. */
export async function publishTemplate(_previous: ActionState, form: FormData): Promise<ActionState> {
  return changeStatus(form, ['waiting', 'hidden'], 'published');
}
/** Waiting → hidden (a rejected template stays in the list, not in the gallery). */
export async function rejectTemplate(_previous: ActionState, form: FormData): Promise<ActionState> {
  return changeStatus(form, ['waiting'], 'hidden');
}
export async function addCandidateToGallery(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(form, (id) => data.admin.prepareCandidate(id));
}
export async function rejectCandidateAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(form, (id) => data.admin.rejectCandidate(id));
}

/** Starts a scan (one at a time; while one runs, that one is returned). */
export async function runScanNow(): Promise<ActionState> {
  await requireAdmin();
  try {
    await data.admin.runScan();
  } catch (error) {
    if (error instanceof Error && error.message === 'provider-cap') return { status: 'error', providerCap: true };
    return { status: 'error' };
  }
  refreshShell();
  return { status: 'done' };
}

/** "Add candidate": there is no admin port for a pasted link, so this is the customer catalog call with the admin as owner. */
export async function addLink(_previous: LinkState, form: FormData): Promise<LinkState> {
  const admin = await requireAdmin();
  const parsed = parseVideoLink(String(form.get('url') ?? ''));
  if (!parsed.ok) return { status: 'error', error: 'linkInvalid' };
  try {
    await data.catalog.addFromLink(admin.id, parsed.url);
  } catch (error) {
    if (error instanceof Error && error.message === 'provider-cap') return { status: 'error', providerCap: true };
    return { status: 'error', error: 'linkFailed' };
  }
  refreshShell();
  return { status: 'done' };
}

/** What the box of links may hold at most (the 50 lines, each as long as a link may be, and their line ends): more is not read at all. */
const LIST_CHARS = RULES.linkBatchMax * 2100;

/**
 * "Prepare from links": one link per line. Only the shape of the list is checked here (blank lines dropped, at most `RULES.linkBatchMax`
 * lines); each line is judged, queued by the way of "Add to gallery" and answered by the data layer, which checks the admin again.
 */
export async function prepareLinkList(_previous: LinkListState, form: FormData): Promise<LinkListState> {
  const admin = await requireAdmin();
  const raw = form.get('links');
  const text = typeof raw === 'string' ? raw : '';
  if (text.length > LIST_CHARS) return { status: 'error', error: 'tooMany', rows: [] };
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  if (lines.length === 0) return { status: 'error', error: 'empty', rows: [] };
  if (lines.length > RULES.linkBatchMax) return { status: 'error', error: 'tooMany', rows: [] };
  let rows: LinkRow[];
  try {
    rows = await data.admin.prepareLinks(admin.id, lines);
  } catch {
    return { status: 'error', error: 'failed', rows: [] };
  }
  refreshShell();
  return { status: 'done', rows };
}

export type SampleCostOutcome = { status: 'ok'; paid: Paid } | { status: 'running'; jobId: string | null } | { status: 'error' };
/**
 * `refused`: the data layer said why and nothing started, so nothing was spent. `unknown`: it failed without saying, so whether a
 * paid sample started is not known: the UI must not offer the same start again.
 */
export type SampleOutcome =
  | { status: 'ok'; jobId: string } | { status: 'changed'; paid: Paid } | { status: 'running'; jobId: string | null }
  | { status: 'refused'; providerCap?: boolean } | { status: 'unknown' };

const amount = z.number().int().min(0).max(1_000_000);
const paidSchema = z.object({ images: amount, clips: amount, clipSeconds: amount, music: amount, voice: amount });
/** The admin's product photographs of a sample: a name and the stored paths the upload returned (the same rules as a customer's product). */
const sampleProductsSchema = z.array(z.object({ name: z.string().trim().min(1).max(120), images: z.array(z.string().min(1).max(260)).min(1).max(8) })).min(1).max(5);
export type SampleProduct = z.infer<typeof sampleProductsSchema>[number];
// The codes with which the data layer refuses a sample before anything starts. `sample-running` is to come from D0.
const NOT_STARTED = ['forbidden', 'template-not-ready', 'sample-running', 'sample-products', 'upload-not-found'];

/** What one sample of the template would request; read only, nothing starts. Opens the sample confirmation, unless one is running. */
export async function sampleCostFor(templateId: string): Promise<SampleCostOutcome> {
  await requireAdmin();
  const id = idSchema.safeParse(templateId);
  if (!id.success) return { status: 'error' };
  try {
    const template = await data.admin.template(id.data);
    if (!template) return { status: 'error' };
    const running = runningSample(template);
    if (running) return { status: 'running', jobId: running.jobId };
    return { status: 'ok', paid: await data.admin.sampleCost(id.data) };
  } catch (error) {
    return { status: 'error' };
  }
}

export type SamplePhotoOutcome = { status: 'saved'; path: string } | { status: 'refused' };

/** One product photograph of the sample dialog, sent as `file`: stored as the admin's own upload (what a job start checks), or refused. */
export async function uploadSamplePhoto(form: FormData): Promise<SamplePhotoOutcome> {
  const admin = await requireAdmin();
  const file = form.get('file');
  if (!(file instanceof File) || file.size > 10 * 1024 * 1024) return { status: 'refused' };
  try {
    return { status: 'saved', path: await data.uploads.save(admin.id, file) };
  } catch {
    return { status: 'refused' };
  }
}

/**
 * "Generate sample" in the confirmation: starts the sample with the paid requests the confirmation showed.
 * When they are not the ones of now, nothing starts and the new ones come back to be confirmed again.
 */
export async function startSample(templateId: string, confirmed: Paid, products: SampleProduct[]): Promise<SampleOutcome> {
  const admin = await requireAdmin();
  const id = idSchema.safeParse(templateId);
  const paid = paidSchema.safeParse(confirmed);
  const given = sampleProductsSchema.safeParse(products);
  if (!id.success || !paid.success || !given.success) return { status: 'refused' };
  let jobId: string;
  try {
    jobId = (await data.admin.generateSample(id.data, admin.id, paid.data, given.data.map(({ name, images }) => ({ name, description: '', images })))).id;
  } catch (error) {
    if (error instanceof Error && error.message === 'provider-cap') return { status: 'refused', providerCap: true };
    if (error instanceof PaidChangedError) return { status: 'changed', paid: error.paid };
    if (error instanceof Error && error.message === 'sample-running') {
      const job: unknown = (error as Error & { jobId?: unknown }).jobId;
      return { status: 'running', jobId: typeof job === 'string' ? job : null };
    }
    if (error instanceof NotFoundError || (error instanceof Error && NOT_STARTED.includes(error.message))) return { status: 'refused' };
    return { status: 'unknown' };
  }
  // The sample has started: a failing refresh must not read as "did not start" (a retry would be a second paid sample).
  try {
    refreshShell();
  } catch {
    /* the page is refreshed by the next navigation */
  }
  return { status: 'ok', jobId };
}

/** "Save changes": validated here; the shot times come from the form but are checked against the template length. */
export async function saveTemplate(_previous: SaveState, form: FormData): Promise<SaveState> {
  await requireAdmin();
  const id = idOf(form);
  const template = id.success ? await data.admin.template(id.data) : null;
  if (!template) return { status: 'error', errors: { form: 'failed' } };
  const parsed = parseEditForm(form, template.seconds);
  if (!parsed.ok) return { status: 'error', errors: parsed.errors };
  const { title, category, products, visibility, shots } = parsed.value;
  const changes = visibility !== '' && visibility !== template.status;
  if (changes && (template.status === 'private' || (visibility === 'published' && (!publishable({ ...template, category }) || template.sample === 'outdated')))) return { status: 'error', errors: { form: 'transition' } };
  try {
    const categories = await data.catalog.categories();
    if (category !== template.category && !categories.includes(category)) return { status: 'error', errors: { category: 'invalid' } };
    await data.admin.updateTemplate(template.id, { title, category, products, shots, ...(changes ? { status: visibility } : {}) });
  } catch {
    return { status: 'error', errors: { form: 'failed' } };
  }
  refreshShell();
  return { status: 'saved', errors: {} };
}

/** "Hide template". */
export async function hideTemplate(_previous: SaveState, form: FormData): Promise<SaveState> {
  await requireAdmin();
  const id = idOf(form);
  if (!id.success) return { status: 'error', errors: { form: 'failed' } };
  try {
    const template = await data.admin.template(id.data);
    if (!template) return { status: 'error', errors: { form: 'failed' } };
    if (template.status !== 'published' && template.status !== 'waiting') return { status: 'error', errors: { form: 'transition' } };
    await data.admin.updateTemplate(template.id, { status: 'hidden' });
  } catch {
    return { status: 'error', errors: { form: 'failed' } };
  }
  refreshShell();
  return { status: 'hidden', errors: {} };
}
