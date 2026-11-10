/** Why a link of "Add your own video" was not taken: the form's own checks, the limits, the nine reasons of contract 7.2, and the charge. */
export type LinkErrorCode =
  | 'linkInvalid' | 'failed' | 'duplicate' | 'tooManyPreparing' | 'limit' | 'dailyLimit' | 'paused' | 'priceChanged' | 'uploadQuota' | 'uploadFailed' | 'uploadServer' | 'uploadTimeout'
  | 'type' | 'size' | 'length' | 'sourceLong' | 'range' | 'ratio' | 'unreadable' | 'linkNotFound' | 'private' | 'removed' | 'unsupportedSite';

/** The reasons that end with `Nothing was charged.` (contract 7.2): a source the check refused. */
export const SOURCE_CODES: readonly LinkErrorCode[] = ['type', 'size', 'length', 'sourceLong', 'range', 'ratio', 'unreadable', 'linkNotFound', 'private', 'removed', 'unsupportedSite', 'uploadQuota'];
