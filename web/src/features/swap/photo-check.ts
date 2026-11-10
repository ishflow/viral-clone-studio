import { RULES } from '@/data/ports';

/** The photographs of one person, in the order the form shows them. Only the full-body one is required. */
export const PHOTO_KINDS = ['body', 'face', 'side'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];
/** The types a picked file may have; anything else is refused in the form, before it is sent. */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** What the file itself says: not a picture type the site takes, or too large. */
export function fileProblem(file: { type: string; size: number }): 'type' | 'size' | null {
  if (!PHOTO_TYPES.includes(file.type)) return 'type';
  return file.size > MAX_PHOTO_BYTES ? 'size' : null;
}

/** What the picture says once the browser has read it: too small for the model, or a full-body photograph that is not upright. */
export function pictureProblem(kind: PhotoKind, { width, height }: { width: number; height: number }): 'small' | 'landscape' | null {
  if (Math.min(width, height) < RULES.swapPhotoShortSideMin) return 'small';
  return kind === 'body' && height <= width ? 'landscape' : null;
}
