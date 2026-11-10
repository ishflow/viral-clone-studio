import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { requireAdmin } from '@/core/session/guards';
import { data } from '@/data';
import { NotFoundError } from '@/data/ports';
import { refuseForbidden } from '../admin-common/forbidden';

// A customer's photograph is never kept by a browser, a proxy or the framework: every answer of this route says so.
const NEVER_CACHED = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const words = (text: string, status: number) => new Response(text, { status, headers: { ...NEVER_CACHED, 'content-type': 'text/plain; charset=utf-8' } });

/**
 * One photograph of a person-swap job, for the admin's look: the bytes `data.admin.swapPhoto` hands over, and nothing it does not.
 * The session must be an admin's (anyone else gets the 403 page before the data layer is asked), and the data layer checks the admin
 * again and decides whether there is anything to show: a job that has its answer gives no byte (410 `decided` / `deleted`). A slot,
 * a kind or a job that is not there, and a photograph with no file (fake mode keeps none), is a 404.
 */
export async function swapPhotoResponse(jobId: string, slot: string, kind: string): Promise<Response> {
  const admin = await requireAdmin();
  if (!/^\d{1,3}$/.test(slot) || (kind !== 'body' && kind !== 'face' && kind !== 'side')) return words('Not found', 404);
  let photo;
  try {
    photo = await data.admin.swapPhoto(admin.id, jobId, Number(slot), kind);
  } catch (error) {
    refuseForbidden(error);
    if (error instanceof NotFoundError) return words('Not found', 404);
    throw error;
  }
  if (photo.state !== 'shown') return words(photo.state, 410);
  if (!photo.file) return words('Not found', 404);
  return new Response(Readable.toWeb(createReadStream(photo.file.path)) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: { ...NEVER_CACHED, 'content-type': photo.file.type, 'content-length': String(photo.file.size) },
  });
}
