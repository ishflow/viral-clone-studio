import { describe, expect, it } from 'vitest';
import { extensionFor, typeOf } from './filetype.ts';
import { JPEG, MEDIA, WAV, WEBP } from './testing.ts';

describe('typeOf: what a file is, by its first bytes', () => {
  it('knows the pictures, the sounds and the video a generator delivers', () => {
    expect(typeOf(MEDIA.image)).toBe('png');
    expect(typeOf(JPEG)).toBe('jpeg');
    expect(typeOf(WEBP)).toBe('webp');
    expect(typeOf(WAV)).toBe('wav');
    expect(typeOf(MEDIA.clip)).toBe('mp4');
    expect(typeOf(MEDIA.music)).toBe('mp3');                                                 // an ID3 tag
    expect(typeOf(Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('mp3');   // a bare MPEG audio frame
  });
  it('anything else is no type: text, an empty file, a web page, a RIFF file that is neither', () => {
    for (const bytes of ['fake image 1', '', '<!doctype html>', '{"error":"not found"}', 'RIFF\u0000\u0000\u0000\u0000AVI LIST']) expect(typeOf(Buffer.from(bytes))).toBeNull();
    expect(typeOf(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('extensionFor: the name a paid file must carry', () => {
  it('follows what the file is, inside what its kind may be', () => {
    expect(['png', 'jpeg', 'webp'].map((type) => extensionFor('image', type as never))).toEqual(['.png', '.jpg', '.webp']);
    expect(extensionFor('clip', 'mp4')).toBe('.mp4');
    expect(['mp3', 'wav', 'mp4'].map((type) => extensionFor('music', type as never))).toEqual(['.mp3', '.wav', '.m4a']);
    expect(extensionFor('voice', 'wav')).toBe('.wav');
  });
  it('a file of another family, or of no type, has none', () => {
    expect(extensionFor('image', 'mp3')).toBeNull();
    expect(extensionFor('image', 'mp4')).toBeNull();
    expect(extensionFor('clip', 'png')).toBeNull();
    expect(extensionFor('clip', 'mp3')).toBeNull();
    expect(extensionFor('voice', 'jpeg')).toBeNull();
    expect(extensionFor('music', null)).toBeNull();
  });
});
