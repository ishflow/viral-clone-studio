// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { photoSize } from './photo-size';
import { jpegOf, pngOf, webpOf, webpWithExif } from './photo-test-fixture';

describe('the size of a photograph, read from its bytes', () => {
  it('of a PNG: its header', () => {
    expect(photoSize(pngOf(340, 800))).toEqual({ width: 340, height: 800 });
    expect(photoSize(pngOf(70_000, 3))).toEqual({ width: 70_000, height: 3 });
  });

  it('of a JPEG: its frame, baseline or progressive, after whatever segments come first', () => {
    expect(photoSize(jpegOf(600, 900))).toEqual({ width: 600, height: 900 });
    expect(photoSize(jpegOf(600, 900, { progressive: true }))).toEqual({ width: 600, height: 900 });
  });

  it('of a JPEG a phone held upright took: turned as its EXIF orientation says, in either byte order', () => {
    expect(photoSize(jpegOf(4000, 3000, { orientation: 6 }))).toEqual({ width: 3000, height: 4000 });
    expect(photoSize(jpegOf(4000, 3000, { orientation: 8, littleEndian: true }))).toEqual({ width: 3000, height: 4000 });
    expect(photoSize(jpegOf(4000, 3000, { orientation: 3 }))).toEqual({ width: 4000, height: 3000 });   // upside down: the same sides
    expect(photoSize(jpegOf(4000, 3000, { orientation: 1 }))).toEqual({ width: 4000, height: 3000 });
  });

  it('of a WebP: lossy, lossless and extended', () => {
    expect(photoSize(webpOf(400, 700, 'VP8 '))).toEqual({ width: 400, height: 700 });
    expect(photoSize(webpOf(400, 700, 'VP8L'))).toEqual({ width: 400, height: 700 });
    expect(photoSize(webpOf(5000, 9000, 'VP8X'))).toEqual({ width: 5000, height: 9000 });
  });

  it('of a PNG a phone held upright took: turned as the orientation of its eXIf chunk says, wherever the chunk stands, in either byte order', () => {
    expect(photoSize(pngOf(4000, 3000, { orientation: 6 }))).toEqual({ width: 3000, height: 4000 });
    expect(photoSize(pngOf(4000, 3000, { orientation: 5, littleEndian: true, afterData: true }))).toEqual({ width: 3000, height: 4000 });
    expect(photoSize(pngOf(4000, 3000, { orientation: 3 }))).toEqual({ width: 4000, height: 3000 });   // upside down: the same sides
    expect(photoSize(pngOf(4000, 3000, { orientation: 1, afterData: true }))).toEqual({ width: 4000, height: 3000 });
  });

  it('of a WebP that carries an EXIF orientation: the size its header says, as Chrome measures it in the form (it shows such a WebP unturned; WebKit turns it)', () => {
    expect(photoSize(webpWithExif(4000, 3000, { orientation: 6 }))).toEqual({ width: 4000, height: 3000 });
    expect(photoSize(webpWithExif(3000, 4000, { orientation: 8, littleEndian: true, named: true }))).toEqual({ width: 3000, height: 4000 });
  });

  it('of a PNG whose EXIF data is cut before the end of the entry that names the orientation, or names none: the size its header says, never an error', () => {
    const png = pngOf(4000, 3000, { orientation: 6 });
    for (const cut of [9, 12, 20, 25, 30]) expect(photoSize(png.subarray(0, png.length - cut))).toEqual({ width: 4000, height: 3000 });
    expect(photoSize(pngOf(4000, 3000, { orientation: 0 }))).toEqual({ width: 4000, height: 3000 });
    expect(photoSize(pngOf(4000, 3000, { orientation: 9, afterData: true }))).toEqual({ width: 4000, height: 3000 });
  });

  it('is not known of bytes that do not say it: a cut header, a JPEG without a frame, another file', () => {
    expect(photoSize(pngOf(340, 800).subarray(0, 12))).toBeNull();
    expect(photoSize(jpegOf(600, 900).subarray(0, 6))).toBeNull();
    expect(photoSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(photoSize(new TextEncoder().encode('not a picture at all, only some words'))).toBeNull();
    expect(photoSize(new Uint8Array(0))).toBeNull();
  });
});
