// Cheap local-container admission before a tool with its own decoder sees an untrusted download.
// This identifies a header, not a full decode or a promise that every byte is safe.
import { closeSync, openSync, readSync, statSync } from 'node:fs';

export function localContainer(file: string): boolean {
  if (!statSync(file).isFile()) return false;
  const fd = openSync(file, 'r');
  try {
    const bytes = Buffer.alloc(4096);
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    const head = bytes.subarray(0, count);
    // ISO BMFF (MP4/MOV), RIFF/WAVE, WebM, MP3 and Ogg: no text playlists, manifests or URLs.
    if (count >= 16 && head.toString('ascii', 4, 8) === 'ftyp' && head.readUInt32BE(0) >= 16) return true;
    if (count >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE') return true;
    if (count >= 8 && head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && head.includes(Buffer.from('webm'))) return true;
    if (count >= 10 && head.toString('ascii', 0, 3) === 'ID3' && [2, 3, 4].includes(head[3]!)) return true;
    if (count >= 4 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0 && (head[1]! & 0x18) !== 0x08 && (head[1]! & 6) !== 0 && (head[2]! & 0xf0) !== 0xf0 && (head[2]! & 0xf0) !== 0) return true;
    return count >= 27 && head.toString('ascii', 0, 4) === 'OggS' && head[4] === 0;
  } finally { closeSync(fd); }
}
