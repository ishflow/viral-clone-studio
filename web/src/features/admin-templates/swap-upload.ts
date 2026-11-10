/** What the upload route can say of a file, and what this screen says when the browser or the route will not take it. */
export type SwapUploadCode = 'type' | 'size' | 'length' | 'ratio' | 'uploadQuota' | 'uploadTimeout' | 'uploadFailed';
export type SwapUploadResult = { ok: true; uploadId: string } | { ok: false; code: SwapUploadCode };

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const ROUTE_CODES: Record<string, SwapUploadCode> = { type: 'type', size: 'size', quota: 'uploadQuota', length: 'length', ratio: 'ratio', timeout: 'uploadTimeout' };

/** The browser's own look at the file, before any byte is sent: mp4 or mov, at most 100 MB. The route reads the real container and shape. */
export function swapVideoRefusal(file: File): 'type' | 'size' | null {
  const named = /\.(mp4|mov)$/i.test(file.name) || file.type === 'video/mp4' || file.type === 'video/quicktime';
  if (!named) return 'type';
  return file.size > MAX_VIDEO_BYTES ? 'size' : null;
}

/** Sends the file to the upload route (XMLHttpRequest: only it reports upload progress); the route keeps it for the signed-in admin and answers with its id. */
export function uploadSwapVideo(file: File, onProgress: (percent: number) => void): Promise<SwapUploadResult> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/uploads/video');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.floor((event.loaded / event.total) * 100)));
    };
    request.onerror = () => resolve({ ok: false, code: 'uploadFailed' });
    request.onload = () => {
      let body: Record<string, unknown>;
      try { body = JSON.parse(request.responseText) as Record<string, unknown>; } catch { return resolve({ ok: false, code: 'uploadFailed' }); }
      if (request.status === 200 && typeof body.uploadId === 'string') return resolve({ ok: true, uploadId: body.uploadId });
      resolve({ ok: false, code: ROUTE_CODES[String(body.error)] ?? 'uploadFailed' });
    };
    const form = new FormData();
    form.set('file', file);
    request.send(form);
  });
}
