import { getSessionState } from '@/core/session/session';
import { MAX_VIDEO_BODY_BYTES } from '@/core/upload-limits';
import { data } from '@/data';
import { claimVideoSlot, countVideoAttempt, videoQuotaFull } from '@/data/real/uploads';

export const runtime = 'nodejs';

const REFUSALS: Record<string, { status: number; code: string }> = {
  'upload-type': { status: 415, code: 'type' },
  'upload-size': { status: 413, code: 'size' },
  'upload-quota': { status: 429, code: 'quota' },
  'upload-length': { status: 422, code: 'length' },
  'upload-ratio': { status: 422, code: 'ratio' },
};

const reply = (status: number, body: Record<string, unknown>): Response => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * The whole body has this long to arrive. An upload holds one of a few places while it is read, so a request that sends nothing (or a
 * byte now and then) must not hold one for as long as it likes. Five minutes: the largest file (100 MB) needs about 2.7 Mbit/s of upload
 * speed, a 30 MB one under 1 Mbit/s, and it is the time Node's own server gives a whole request by default, so no upload that worked is lost.
 */
const BODY_READ_MS = 5 * 60_000;

/** The `file` field of the form, read within `BODY_READ_MS`. `late`: the time was up, and the read is cancelled (nothing more is taken from the connection). */
async function fileOf(request: Request): Promise<FormDataEntryValue | null | 'late'> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), BODY_READ_MS);
  try {
    const body = request.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), { signal: stop.signal });
    return (await new Response(body, { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData()).get('file');
  } catch {
    return stop.signal.aborted ? 'late' : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * "Add your own video", step one: the browser sends the file here (a server action would need the 12 MB body limit lifted for the whole
 * site). The session decides who the file belongs to; the store checks the real container, length and shape with ffprobe, so what the browser
 * says about the file is only echoed back. A server action then takes the opaque `uploadId` through the free check and the charge.
 * The length is required and capped before a byte is read.
 */
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin !== null && new URL(origin).host !== request.headers.get('host')) return reply(403, { error: 'forbidden' });

  const state = await getSessionState();
  if (state.kind === 'blocked') return reply(403, { error: 'forbidden' });
  if (state.kind !== 'active') return reply(401, { error: 'signed-out' });
  if (!state.user.emailVerified) return reply(403, { error: 'forbidden' });

  const declared = request.headers.get('content-length');
  if (declared === null || !/^\d+$/.test(declared)) return reply(411, { error: 'length-required' });
  if (Number(declared) > MAX_VIDEO_BODY_BYTES) return reply(413, { error: 'size' });

  // The body is buffered whole, so what can be refused is refused first: a used-up quota, a second upload of the same user, a full site.
  if (videoQuotaFull(state.user.id)) return reply(429, { error: 'quota' });
  const release = claimVideoSlot(state.user.id);
  if (!release) return reply(429, { error: 'busy' });
  try {
    const file = await fileOf(request);
    if (!(file instanceof File)) {
      // A try that brought no file still uses one of the day: the place it held and the bytes it sent are not free.
      countVideoAttempt(state.user.id);
      return file === 'late' ? reply(408, { error: 'timeout' }) : reply(400, { error: 'failed' });
    }
    try {
      const uploadId = await data.uploads.saveVideo!(state.user.id, file);
      return reply(200, { uploadId, name: file.name, type: file.type, bytes: file.size });
    } catch (error) {
      const refusal = REFUSALS[error instanceof Error ? error.message : ''];
      return refusal ? reply(refusal.status, { error: refusal.code }) : reply(500, { error: 'failed' });
    }
  } finally {
    release();
  }
}
