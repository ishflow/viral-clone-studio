import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shortEdit, shortFacts } from './fixture.ts';
import { compose } from './index.ts';
import { WriteError, writeComposition } from './write.ts';

/** A folder with one small file per media file of the short document. */
function media(): { dir: string; sources: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), 've-write-'));
  const sources: Record<string, string> = {};
  for (const name of ['a.mp4', 'b.mp4', 'c.mp4', 'serum.png', 'beat.mp3']) {
    const file = join(dir, 'made', name);
    mkdirSync(join(dir, 'made'), { recursive: true });
    writeFileSync(file, `content of ${name}`);
    sources[`assets/${name}`] = file;
  }
  return { dir, sources };
}

describe('writeComposition', () => {
  const composition = compose(shortEdit(), shortFacts());

  it('writes index.html and timeline.json, links the media and copies the two files of every font', () => {
    const { dir, sources } = media();
    const out = join(dir, 'v1');
    writeComposition(out, composition, sources);
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toBe(composition.html);
    expect(JSON.parse(readFileSync(join(out, 'timeline.json'), 'utf8'))).toEqual(composition.timeline);
    for (const file of composition.files) {
      expect(lstatSync(join(out, file)).isSymbolicLink()).toBe(true);
      expect(readFileSync(join(out, file), 'utf8')).toBe(`content of ${file.slice('assets/'.length)}`);
    }
    expect(readdirSync(join(out, 'assets/fonts')).sort()).toEqual(['inter-latin-ext-wght-normal.woff2', 'inter-latin-wght-normal.woff2', 'montserrat-latin-ext-wght-normal.woff2', 'montserrat-latin-wght-normal.woff2']);
    for (const font of composition.fonts) expect(statSync(join(out, font)).size).toBeGreaterThan(10_000);
  });

  it('writes a second time into the same folder without touching the sources', () => {
    const { dir, sources } = media();
    const out = join(dir, 'v1');
    writeComposition(out, composition, sources);
    writeComposition(out, composition, sources);
    expect(readFileSync(sources['assets/a.mp4']!, 'utf8')).toBe('content of a.mp4');
    expect(readFileSync(join(out, 'assets/a.mp4'), 'utf8')).toBe('content of a.mp4');
  });

  it('refuses, with nothing written, when a media file has no source or the source does not exist', () => {
    const { dir, sources } = media();
    const { 'assets/b.mp4': _, ...withoutB } = sources;
    const out = join(dir, 'v1');
    expect(() => writeComposition(out, composition, withoutB)).toThrowError(WriteError);
    try { writeComposition(out, composition, { ...sources, 'assets/beat.mp3': join(dir, 'nowhere.mp3') }); } catch (error) {
      expect(error).toMatchObject({ code: 'media-missing', file: 'assets/beat.mp3' });
    }
    expect(existsSync(out)).toBe(false);
  });

  it('refuses, with nothing written, when a font file is not installed', () => {
    const { dir, sources } = media();
    const out = join(dir, 'v1');
    const other = { ...composition, fonts: [...composition.fonts, 'assets/fonts/comic-latin-wght-normal.woff2'] };
    try { writeComposition(out, other, sources); expect.unreachable(); } catch (error) {
      expect(error).toBeInstanceOf(WriteError);
      expect(error).toMatchObject({ code: 'font-missing', file: 'assets/fonts/comic-latin-wght-normal.woff2' });
    }
    expect(existsSync(out)).toBe(false);
  });
});
