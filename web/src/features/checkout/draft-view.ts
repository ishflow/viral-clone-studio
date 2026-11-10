// The part of the draft that client components may import: no data layer in here, so it stays out of the browser bundle.

export interface Draft { title: string; image: string; products: number }

/** What the result pages get as `returnTo` when the buyer came from nowhere in particular (`safeNext` of nothing). */
export const DEFAULT_RETURN = '/gallery';

const GENERATE_FORM = /^\/templates\/([^/?#]+)\/generate(?:[?#].*)?$/;

/** The template id when `path` is a generate form (the page a buyer was sent away from), else null. */
export function isGenerateForm(path: string): string | null {
  return GENERATE_FORM.exec(path)?.[1] ?? null;
}
