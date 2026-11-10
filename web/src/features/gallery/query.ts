import type { Format, Template } from '@/data/ports';
import { first } from '@/shared/lib/query';

export type GallerySort = 'newest' | 'used';
export type GalleryQuery = { q: string; category: string; format: Format | ''; sort: GallerySort };
export type RawParams = Record<string, string | string[] | undefined>;

export function parseGalleryQuery(params: RawParams, categories: string[]): GalleryQuery {
  const category = first(params.category);
  const format = first(params.format);
  return {
    q: first(params.q).trim().slice(0, 80),
    category: categories.includes(category) ? category : '',
    format: format === 'talking' || format === 'no-talking' ? format : '',
    sort: first(params.sort) === 'used' ? 'used' : 'newest',
  };
}

/** The gallery URL for `query` with `patch` applied; defaults are left out. */
export function galleryHref(query: GalleryQuery, patch: Partial<GalleryQuery>): string {
  const next = { ...query, ...patch };
  const search = new URLSearchParams();
  if (next.q) search.set('q', next.q);
  if (next.category) search.set('category', next.category);
  if (next.format) search.set('format', next.format);
  if (next.sort !== 'newest') search.set('sort', next.sort);
  const text = search.toString();
  return text ? `/gallery?${text}` : '/gallery';
}

export function sortTemplates(templates: Template[], sort: GallerySort): Template[] {
  return templates.toSorted((a, b) =>
    sort === 'used' ? b.timesGenerated - a.timesGenerated || b.editedAt.localeCompare(a.editedAt) : b.editedAt.localeCompare(a.editedAt),
  );
}
