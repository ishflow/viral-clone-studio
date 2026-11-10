import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { getSessionUser } from '@/core/session/session';
import { mediaFile } from '@/data/real/media';

const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });

/**
 * One range, `bytes=a-b`, `bytes=a-` or `bytes=-n` → its first and last byte, or `unsatisfiable` (416). A header this cannot read
 * (several ranges, another unit, words) is `ignored`: RFC 9110 lets a server send the whole file then.
 */
function rangeOf(header: string, size: number): { start: number; end: number } | 'unsatisfiable' | 'ignored' {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return 'ignored';
  const [start, end] = match[1] === ''
    ? [Math.max(0, size - Number(match[2])), size - 1]
    : [Number(match[1]), match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)];
  return start <= end && start < size ? { start, end } : 'unsatisfiable';
}

/**
 * A file of the data directory: product photos, template posters and samples, finished videos, reference videos. `mediaFile`
 * decides who may see it; everything else, and everything in fake mode, is a 404. Video players ask for ranges.
 */
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const found = mediaFile((await params).path, await getSessionUser());
  if (!found) return notFound();
  const headers = new Headers({ 'content-type': found.type, 'accept-ranges': 'bytes', 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff' });
  const range = rangeOf(request.headers.get('range') ?? '', found.size);
  if (range !== 'ignored') {
    if (range === 'unsatisfiable') {
      headers.set('content-range', `bytes */${found.size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set('content-range', `bytes ${range.start}-${range.end}/${found.size}`);
    headers.set('content-length', String(range.end - range.start + 1));
    const body = Readable.toWeb(createReadStream(found.file, range)) as ReadableStream<Uint8Array>;
    return new Response(body, { status: 206, headers });
  }
  headers.set('content-length', String(found.size));
  return new Response(Readable.toWeb(createReadStream(found.file)) as ReadableStream<Uint8Array>, { status: 200, headers });
}
