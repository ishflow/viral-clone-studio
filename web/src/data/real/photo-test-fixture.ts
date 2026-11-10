// The first bytes of a photograph of a given size, for tests: enough for the type check of the uploads and for `photoSize`. No picture data.

const be16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
const be32 = (value: number) => [...be16(Math.floor(value / 0x10000)), ...be16(value % 0x10000)];
const le16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
const chars = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** The EXIF data (a TIFF header and one directory) that names an orientation, in either byte order. */
function tiffOf(orientation: number, littleEndian = false): number[] {
  const u16 = littleEndian ? le16 : be16;
  const u32 = (value: number) => (littleEndian ? [...le16(value), 0, 0] : [0, 0, ...be16(value)]);
  return [...chars(littleEndian ? 'II' : 'MM'), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
}

/** A PNG header. `orientation`: an `eXIf` chunk that names it follows, right after the header or (`afterData`) after a chunk of picture data. */
export function pngOf(width: number, height: number, over: { orientation?: number; littleEndian?: boolean; afterData?: boolean } = {}): Uint8Array {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...chars('IHDR'), ...be32(width), ...be32(height), 8, 2, 0, 0, 0];
  if (over.orientation === undefined) return new Uint8Array(header);
  const chunk = (type: string, body: number[]) => [...be32(body.length), ...chars(type), ...body, 0, 0, 0, 0];   // the checksum is not read
  const tiff = tiffOf(over.orientation, over.littleEndian);
  return new Uint8Array([...header, 0, 0, 0, 0, ...(over.afterData ? chunk('IDAT', [1, 2, 3, 4, 5]) : []), ...chunk('eXIf', tiff)]);
}

/**
 * A whole PNG that any viewer opens, small on the disk: one bit of grey for each pixel, all black, every chunk with its checksum.
 * (The Node module is looked up inside: browser-safe.test.ts holds every non-test file of the data layer to that.)
 */
export function wholePng(width: number, height: number): Uint8Array<ArrayBuffer> {
  const zlib = process.getBuiltinModule('node:zlib');
  const chunk = (type: string, body: Uint8Array): number[] => {
    const named = new Uint8Array([...chars(type), ...body]);
    return [...be32(body.length), ...named, ...be32(zlib.crc32(named))];
  };
  const rows = new Uint8Array((1 + Math.ceil(width / 8)) * height);       // each row: its filter byte (none), then its pixels
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', new Uint8Array([...be32(width), ...be32(height), 1, 0, 0, 0, 0])), ...chunk('IDAT', zlib.deflateSync(rows)), ...chunk('IEND', new Uint8Array())]);
}

/** The photograph the tests of a person swap upload, as the body and as the face: a whole picture, upright, of the least size the rules take. */
export const PERSON_PHOTO = wholePng(340, 341);

/** A JPEG header: JFIF, an optional EXIF segment that names the orientation, then the frame. */
export function jpegOf(width: number, height: number, over: { orientation?: number; littleEndian?: boolean; progressive?: boolean } = {}): Uint8Array {
  const tiff = tiffOf(over.orientation ?? 1, over.littleEndian);
  const exif = over.orientation === undefined ? [] : [0xff, 0xe1, ...be16(2 + 6 + tiff.length), ...chars('Exif'), 0, 0, ...tiff];
  const jfif = [0xff, 0xe0, ...be16(16), ...chars('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const frame = [0xff, over.progressive ? 0xc2 : 0xc0, ...be16(11), 8, ...be16(height), ...be16(width), 1, 1, 0x11, 0];
  return new Uint8Array([0xff, 0xd8, ...jfif, ...exif, ...frame]);
}

/**
 * An extended WebP as a phone or an editor writes one with EXIF data: the header, a chunk of picture data (of an odd length: one
 * byte of padding follows it), then the `EXIF` chunk that names the orientation, with the "Exif" name some writers put before it (`named`).
 */
export function webpWithExif(width: number, height: number, over: { orientation: number; littleEndian?: boolean; named?: boolean }): Uint8Array {
  const chunk = (type: string, body: number[]) => [...chars(type), ...le16(body.length), 0, 0, ...body, ...(body.length % 2 ? [0] : [])];
  const exif = [...(over.named ? [...chars('Exif'), 0, 0] : []), ...tiffOf(over.orientation, over.littleEndian)];
  return new Uint8Array([...webpOf(width, height, 'VP8X'), ...chunk('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 1]), ...chunk('EXIF', exif)]);
}

export function webpOf(width: number, height: number, chunk: 'VP8 ' | 'VP8L' | 'VP8X'): Uint8Array {
  const body = chunk === 'VP8X' ? [0, 0, 0, 0, width - 1 & 0xff, (width - 1) >> 8 & 0xff, (width - 1) >> 16, height - 1 & 0xff, (height - 1) >> 8 & 0xff, (height - 1) >> 16]
    : chunk === 'VP8 ' ? [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height)]
    : (() => { const bits = (width - 1) | ((height - 1) << 14); return [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff, 0, 0, 0, 0, 0]; })();
  return new Uint8Array([...chars('RIFF'), 0, 0, 0, 0, ...chars('WEBP'), ...chars(chunk), body.length, 0, 0, 0, ...body]);
}
