/**
 * Why a template and a fill cannot become an edit document. `code` is stable and meant for programs:
 * `unfilled:<placeholder>` · `copy-is-source` · `mark-unbalanced` · `mark-empty` · `mark-duplicate` · `mark-unknown` · `mark-lost` ·
 * `word-too-long` · `segment-empty` · `fill-missing` · `fill-unknown` · `product-count` · `window-overlap` · `media-missing` ·
 * `segment-short` · `template-invalid` · `media-unknown-file`. The message says what to change.
 */
export class ResolveError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ResolveError';
    this.code = code;
  }
}

/** The value of a key the record itself holds. Ids come from a template or a fill: `constructor` must not find Object's own. */
export function own<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}
