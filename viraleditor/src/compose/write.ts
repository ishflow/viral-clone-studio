// Writes a composition folder: index.html, timeline.json, assets/<media> as links to their sources, assets/fonts/*.woff2.
// It refuses before the first byte when a font or a media file is missing (design R14): lint does not notice a missing
// font, and the render succeeds silently with another one.
import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Composition } from './index.ts';

export type WriteErrorCode = 'media-missing' | 'font-missing';
export class WriteError extends Error {
  code: WriteErrorCode;
  file: string;                       // the path inside the composition folder that could not be provided
  constructor(code: WriteErrorCode, file: string, message: string) { super(message); this.name = 'WriteError'; this.code = code; this.file = file; }
}

/** Where a font file of the composition comes from: the variable fonts installed with the project. Null when it is not there. */
function fontSource(file: string): string | null {
  const name = basename(file);
  try {
    const source = fileURLToPath(import.meta.resolve(`@fontsource-variable/${name.split('-')[0]}/files/${name}`));
    return existsSync(source) ? source : null;
  } catch { return null; }
}

/**
 * `sources`: for every entry of `composition.files` (as written there, `assets/<name>`) the file it is a link to.
 * A link that cannot be made (another volume, no permission) becomes a copy.
 */
export function writeComposition(dir: string, composition: Composition, sources: Record<string, string>): void {
  const media = composition.files.map((file) => {
    const source = Object.hasOwn(sources, file) ? resolve(sources[file]!) : null;
    if (source === null) throw new WriteError('media-missing', file, `no source file was given for ${file}`);
    if (!existsSync(source)) throw new WriteError('media-missing', file, `the source of ${file} does not exist: ${source}`);
    return { file, source };
  });
  const fonts = composition.fonts.map((file) => {
    const source = fontSource(file);
    if (source === null) throw new WriteError('font-missing', file, `the font file for ${file} is not installed (node_modules/@fontsource-variable)`);
    return { file, source };
  });

  for (const { file, source } of media) {
    const target = join(dir, file);
    mkdirSync(dirname(target), { recursive: true });
    rmSync(target, { force: true });                       // an older link: never write through it into its source
    try { symlinkSync(source, target); } catch { copyFileSync(source, target); }
  }
  for (const { file, source } of fonts) {
    const target = join(dir, file);
    mkdirSync(dirname(target), { recursive: true });
    rmSync(target, { force: true });
    copyFileSync(source, target);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'timeline.json'), `${JSON.stringify(composition.timeline, null, 2)}\n`);
  writeFileSync(join(dir, 'index.html'), composition.html);
}
