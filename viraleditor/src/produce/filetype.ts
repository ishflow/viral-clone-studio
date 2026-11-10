// A generated file is named by what it IS. The provider's upload takes the content type of a reference from its name,
// so a JPEG kept under a `.png` name would be refused when the next request reads it, after it was paid for.
import { closeSync, openSync, readSync, renameSync } from 'node:fs';
import { abs } from '../paths.ts';
import type { Kind } from './plan.ts';

export type MediaType = 'png' | 'jpeg' | 'webp' | 'mp3' | 'wav' | 'mp4';

const at = (bytes: Uint8Array, offset: number, text: string): boolean =>
  bytes.length >= offset + text.length && [...text].every((letter, i) => bytes[offset + i] === letter.charCodeAt(0));

/** What a file is, by its first 12 bytes; null when it is none of the types a generator delivers. */
export function typeOf(bytes: Uint8Array): MediaType | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (at(bytes, 0, 'RIFF') && at(bytes, 8, 'WEBP')) return 'webp';
  if (at(bytes, 0, 'RIFF') && at(bytes, 8, 'WAVE')) return 'wav';
  if (at(bytes, 4, 'ftyp')) return 'mp4';                                   // MP4 and M4A: the same container
  if (at(bytes, 0, 'ID3') && bytes.length >= 10) return 'mp3';              // an ID3v2 tag: ten bytes of header
  if (bytes.length >= 4 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return 'mp3';   // a bare MPEG audio frame
  return null;
}

const EXTENSIONS: Record<Kind, Partial<Record<MediaType, string>>> = {
  image: { png: '.png', jpeg: '.jpg', webp: '.webp' },
  clip: { mp4: '.mp4' },
  music: { mp3: '.mp3', wav: '.wav', mp4: '.m4a' },
  voice: { mp3: '.mp3', wav: '.wav', mp4: '.m4a' },
};
const WANTED: Record<Kind, string> = { image: 'a picture (PNG, JPEG, WebP)', clip: 'a video (MP4)', music: 'a sound (MP3, WAV, M4A)', voice: 'a sound (MP3, WAV, M4A)' };

/** The extension a paid file of this kind carries, by what the file is; null when it is nothing the kind may be. */
export function extensionFor(kind: Kind, type: MediaType | null): string | null {
  return type === null ? null : EXTENSIONS[kind][type] ?? null;
}

/**
 * The paid file at `file` (under data/) under the name its content gives it: renamed when its extension says
 * something else. `ok: false`: the file is not there, or is nothing a request of this kind may deliver.
 */
export function named(kind: Kind, file: string): { ok: true; file: string } | { ok: false; why: string } {
  const head = new Uint8Array(12);
  let read = 0;
  try {
    const handle = openSync(abs(file), 'r');
    try { read = readSync(handle, head, 0, head.length, 0); } finally { closeSync(handle); }
  } catch { return { ok: false, why: `the provider said the file is there, and it is not: ${file}` }; }
  const extension = extensionFor(kind, typeOf(head.subarray(0, read)));
  if (extension === null) return { ok: false, why: `the file that arrived is not ${WANTED[kind]}` };
  const real = file.replace(/\.[A-Za-z0-9]+$/, extension);
  if (real !== file) renameSync(abs(file), abs(real));
  return { ok: true, file: real };
}
