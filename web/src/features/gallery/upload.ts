import type { UploadedFile } from './actions';
import type { LinkErrorCode } from './schema';

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export type UploadResult = { ok: true; file: UploadedFile } | { ok: false; code: LinkErrorCode; signedOut?: true };

const ROUTE_CODES: Record<string, LinkErrorCode> = { type: 'type', size: 'size', quota: 'uploadQuota', length: 'length', ratio: 'ratio', timeout: 'uploadTimeout' };

/**
 * The browser's own look at the file, before any byte is sent: mp4 or mov by name or type, at most 100 MB. Advisory only: the server
 * reads the real container, length and shape (the type of a file renamed to .mp4 is refused there).
 */
export function videoRefusal(file: File): LinkErrorCode | null {
  const named = /\.(mp4|mov)$/i.test(file.name) || file.type === 'video/mp4' || file.type === 'video/quicktime';
  if (!named) return 'type';
  return file.size > MAX_VIDEO_BYTES ? 'size' : null;
}

/** Step one of "Add your own video": sends the file to the upload route (XMLHttpRequest: only it reports upload progress). */
export function uploadVideo(file: File, onProgress: (percent: number) => void): Promise<UploadResult> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/uploads/video');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.floor((event.loaded / event.total) * 100)));
    };
    request.onerror = () => resolve({ ok: false, code: 'uploadFailed' });
    request.onload = () => {
      if (request.status === 401) return resolve({ ok: false, code: 'uploadFailed', signedOut: true });
      const unknown = request.status >= 500 ? 'uploadServer' : 'uploadFailed';
      let body: Record<string, unknown>;
      try { body = JSON.parse(request.responseText) as Record<string, unknown>; } catch { return resolve({ ok: false, code: unknown }); }
      if (request.status === 200 && typeof body.uploadId === 'string') {
        return resolve({ ok: true, file: { uploadId: body.uploadId, name: String(body.name ?? file.name), type: String(body.type ?? file.type), bytes: Number(body.bytes ?? file.size) } });
      }
      resolve({ ok: false, code: ROUTE_CODES[String(body.error)] ?? unknown });
    };
    const form = new FormData();
    form.set('file', file);
    request.send(form);
  });
}
