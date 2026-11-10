// The pixel size of a stored photograph, read from its own bytes (no picture library): what the browser's check of a person-swap
// photograph measures, measured again on the server for a request that never passed a browser.

export interface PhotoSize { width: number; height: number }

const be16 = (bytes: Uint8Array, at: number): number => (bytes[at]! << 8) | bytes[at + 1]!;
const be32 = (bytes: Uint8Array, at: number): number => be16(bytes, at) * 0x10000 + be16(bytes, at + 2);
const le16 = (bytes: Uint8Array, at: number): number => bytes[at]! | (bytes[at + 1]! << 8);
const le24 = (bytes: Uint8Array, at: number): number => le16(bytes, at) | (bytes[at + 2]! << 16);
const text = (bytes: Uint8Array, at: number, length: number): string => String.fromCharCode(...bytes.subarray(at, at + length));

/** The size as a viewer shows it: turned on its side when the EXIF orientation says so (5 to 8: a phone held upright). */
const shown = (size: PhotoSize, orientation: number | null): PhotoSize =>
  (orientation !== null && orientation >= 5 && orientation <= 8 ? { width: size.height, height: size.width } : size);

/** The orientation (1 to 8) that EXIF data names, or null. `tiff`: the first byte of the data (its TIFF header); `end`: after its last. */
function tiffOrientation(bytes: Uint8Array, tiff: number, end: number): number | null {
  if (end - tiff < 8) return null;
  const order = text(bytes, tiff, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const u16 = (position: number) => (order === 'II' ? le16(bytes, position) : be16(bytes, position));
  const u32 = (position: number) => (order === 'II' ? le16(bytes, position) + le16(bytes, position + 2) * 0x10000 : be32(bytes, position));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return null;
  const entries = u16(ifd);
  for (let entry = ifd + 2; entry + 12 <= end && entry < ifd + 2 + entries * 12; entry += 12) {
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return null;
}

/** The EXIF orientation an APP1 segment names, or null. `at`: the first byte after the segment's length; `end`: after its last. */
function exifOrientation(bytes: Uint8Array, at: number, end: number): number | null {
  return end - at < 14 || text(bytes, at, 4) !== 'Exif' ? null : tiffOrientation(bytes, at + 6, end);
}

/** A PNG as a viewer shows it (Chrome and WebKit turn it too): the header's size, turned by the orientation of its `eXIf` chunk, which may stand before or after the picture's data. */
function pngSize(bytes: Uint8Array): PhotoSize | null {
  if (bytes.length < 24 || text(bytes, 12, 4) !== 'IHDR') return null;
  const size = { width: be32(bytes, 16), height: be32(bytes, 20) };
  for (let at = 8; at + 8 <= bytes.length;) {                                   // each chunk: its length, its name, its data, a checksum
    const length = be32(bytes, at), name = text(bytes, at + 4, 4);
    if (name === 'eXIf') return shown(size, tiffOrientation(bytes, at + 8, Math.min(at + 8 + length, bytes.length)));
    if (name === 'IEND') break;
    at += 12 + length;
  }
  return size;
}

/** A JPEG as a viewer shows it: the frame's size, turned on its side when the EXIF orientation says so (5 to 8: a phone held upright). */
function jpegSize(bytes: Uint8Array): PhotoSize | null {
  let orientation: number | null = null;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) { at += 1; continue; }                                 // a fill byte
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { at += 2; continue; }   // markers without a length
    const length = be16(bytes, at + 2);
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (frame) {
      if (length < 7) return null;
      const height = be16(bytes, at + 5), width = be16(bytes, at + 7);
      return shown({ width, height }, orientation);
    }
    if (marker === 0xe1) orientation ??= exifOrientation(bytes, at + 4, end);
    if (marker === 0xda) return null;                                           // the picture's data starts: no frame was named
    at = end;
  }
  return null;
}

/**
 * A WebP by its header alone: an extended one may carry EXIF data, and its orientation is NOT applied. The form measures with the
 * browser (measure.ts) and the browsers disagree about such a WebP (compared on real files: Chrome 154 shows and measures it unturned,
 * WebKit 26 turned): this is Chrome's reading.
 */
function webpSize(bytes: Uint8Array): PhotoSize | null {
  if (bytes.length < 30 || text(bytes, 8, 4) !== 'WEBP') return null;
  const chunk = text(bytes, 12, 4);
  if (chunk === 'VP8X') return { width: le24(bytes, 24) + 1, height: le24(bytes, 27) + 1 };
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: le16(bytes, 26) & 0x3fff, height: le16(bytes, 28) & 0x3fff };
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const low = le16(bytes, 21), high = le16(bytes, 23);
    return { width: (low & 0x3fff) + 1, height: (((high << 16) | low) >>> 14 & 0x3fff) + 1 };
  }
  return null;
}

/** The size of a JPEG, PNG or WebP as it is shown, or null when its bytes do not say (not one of them, or cut short). */
export function photoSize(bytes: Uint8Array): PhotoSize | null {
  const size = bytes[0] === 0x89 && bytes[1] === 0x50 ? pngSize(bytes)
    : bytes[0] === 0xff && bytes[1] === 0xd8 ? jpegSize(bytes)
    : text(bytes, 0, 4) === 'RIFF' ? webpSize(bytes) : null;
  return size && size.width > 0 && size.height > 0 ? size : null;
}
