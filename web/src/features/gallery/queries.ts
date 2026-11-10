import { data } from '@/data';
import type { Id, Template, User } from '@/data/ports';
import { freeApplies } from './free';
import { parseGalleryQuery, sortTemplates, type GalleryQuery, type RawParams } from './query';

export type GalleryData = { query: GalleryQuery; categories: string[]; templates: Template[]; others: Template[]; free: boolean; freeNotNow: Id[]; showTalking: boolean; own: number; visitor: boolean };

/**
 * Published templates for the search; `others` (all published) only when nothing matches. `own`: how many ready private templates the viewer has (0 for a visitor).
 * `offer`: may the page promise the free video (`freeOffer()` in core; the page decides).
 */
export async function loadGallery(params: RawParams, viewer: Partial<Pick<User, 'id'>> | null, offer: boolean): Promise<GalleryData> {
  const categories = await data.catalog.categories();
  const query = parseGalleryQuery(params, categories);
  const found = await data.catalog.list({ search: query.q, category: query.category || undefined, format: query.format || undefined });
  const templates = sortTemplates(found, query.sort);
  const others = templates.length === 0 ? sortTemplates(await data.catalog.list({}), query.sort) : [];
  // Talking templates are in the list only while the admin lets them; the format choice follows it. `free`: see `freeApplies`.
  const { showTalkingTemplates } = await data.admin.limits();
  const free = freeApplies({ format: 'no-talking' }, offer);
  // B1: a card says Free only while a free video on its template would start now, as the estimate does. A template that cannot be
  // asked about keeps the label.
  const cards = free ? [...templates, ...others].filter((template) => template.format === 'no-talking') : [];
  const open = await Promise.all(cards.map((template) => data.jobs.freeVideoOpen(template.id).catch(() => true)));
  const freeNotNow = cards.filter((_, index) => !open[index]).map((template) => template.id);
  const own = viewer?.id ? (await loadYourTemplates(viewer.id)).filter((template) => template.preparation === 'ready').length : 0;
  return { query, categories, templates, others, free, freeNotNow, showTalking: showTalkingTemplates, own, visitor: !viewer };
}

/** A catalog template, or the viewer's own private one. Anyone else's private template is null (the page answers 404). */
export function loadTemplate(id: Id, viewerId?: Id): Promise<Template | null> {
  return data.catalog.get(id, viewerId);
}

/** The viewer's private templates, newest first, in every state. */
export async function loadYourTemplates(viewerId: Id): Promise<Template[]> {
  const all = await data.catalog.list({ viewerId });
  return all.filter((t) => t.status === 'private' && t.ownerId === viewerId).toSorted((a, b) => b.editedAt.localeCompare(a.editedAt));
}
