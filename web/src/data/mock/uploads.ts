import { UploadRejectedError } from '../ports';
import type { Uploads } from '../ports';

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * The fake keeps no file: a product photo is known by its name, as the form sent it before there were uploads.
 * It checks what it can see (B7, contract §7.1): JPG, PNG or WebP by type or name, at most 10 MB, not empty. The real one reads the bytes.
 */
export const uploads: Uploads = {
  async save(_userId, file) {
    const name = file.name.toLowerCase();
    if (!TYPES.includes(file.type) && !EXTENSIONS.some((extension) => name.endsWith(extension))) throw new UploadRejectedError('type');
    if (file.size > MAX_BYTES) throw new UploadRejectedError('size');
    if (file.size === 0) throw new UploadRejectedError('unreadable');
    return file.name;
  },
};
