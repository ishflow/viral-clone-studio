// From a path on the command line to a checked document: read edit.json, check its shape, read the facts of its media,
// check the media, compose, and (when asked) write the composition and run the renderer's check on it.
// `check`, `frames` and `render` all go through here, so they report the same issues in the same words.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { MediaError } from '../adapters/media.ts';
import { ComposeError, compose } from '../compose/index.ts';
import type { Composition } from '../compose/index.ts';
import { writeComposition } from '../compose/write.ts';
import { PATTERNS, parseEdit } from '../edit/schema.ts';
import type { ComposeFacts, Edit } from '../edit/types.ts';
import type { StreamFacts } from '../ports.ts';
import { checkInputs } from '../quality/index.ts';
import type { Context } from './context.ts';
import { Stop, issue, sh } from './issue.ts';
import type { Issue } from './issue.ts';
import { fromEdit, fromInput, fromRendererCheck, placer, split } from './translate.ts';
import { VERSION } from './version.ts';

/** A path as written on the command line, from the folder the command runs in. */
export const pathOf = (context: Context, given: string): string => resolve(context.cwd, given);
export const isFolder = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

/** The path with every link in it followed and every part in the case the volume stores it, also when its last parts do not exist yet: two names of one file compare equal (`ASSETS/Clip.MP4` and `assets/clip.mp4` on a volume that ignores case). */
export function realOf(path: string): string {
  const missing: string[] = [];
  let head = path;
  while (!existsSync(head) && dirname(head) !== head) { missing.unshift(basename(head)); head = dirname(head); }
  return join(existsSync(head) ? realpathSync.native(head) : head, ...missing);
}

/** JSON.parse with the place of the fault. Stops with `json-invalid`. */
function parseJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    const position = /position (\d+)/.exec(said);
    const before = position ? text.slice(0, Number(position[1])).split('\n') : null;
    const place = /line \d+/.test(said) || before === null ? '' : ` (line ${before.length} column ${before.at(-1)!.length + 1})`;
    throw new Stop([issue('json-invalid', { target: file }, `${file} is not JSON: ${said}${place}.`)]);
  }
}
/** Reads a JSON file. Stops with `file-missing` or `json-invalid` (which names the line). */
export function readJson(file: string, what: string, fix?: string): unknown {
  if (!existsSync(file) || !statSync(file).isFile()) throw new Stop([issue('file-missing', { target: file }, `${what} is not there: ${file}.`, fix)]);
  return parseJson(readFileSync(file, 'utf8'), file);
}

export interface Project {
  file: string;            // edit.json
  dir: string;             // its folder: media files are `<dir>/assets/<name>`
  work: string;            // `<dir>/.viraleditor`: everything the commands write
  edit: Edit;
}

const MEDIA_TYPES = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp3', '.wav', '.m4a', '.aac']);
/** The edit document that most likely was meant: beside the file given, or of the project whose `.viraleditor` folder holds it. */
function meant(file: string): string {
  const inWork = file.indexOf(`${sep}.viraleditor${sep}`);
  const candidates = [...(inWork < 0 ? [] : [join(file.slice(0, inWork), 'edit.json')]), join(dirname(file), 'edit.json')];
  const found = candidates.find((candidate) => candidate !== file && existsSync(candidate));
  return found === undefined ? 'Pass the edit document (edit.json) or the project folder that holds it; `viraleditor init <dir>` writes a working project.'
    : `Pass the edit document of this project: \`viraleditor check ${sh(found)}\`.`;
}
const notAnEdit = (given: string, what: string, hint = meant(given)): Stop => new Stop([issue('not-an-edit', { target: given }, `${given} is not an edit document: ${what}.`, hint)]);

/**
 * Reads the edit document: `given` is an edit.json or the folder that holds one. Stops when there is no document to
 * check: no file (`file-missing`), something else than an edit (`not-an-edit`, which says what it is), no JSON
 * (`json-invalid`), or not the shape of an edit (`schema`; the result then says that nothing else was checked yet).
 */
export function openProject(context: Context, given: string): Project {
  const asked = pathOf(context, given);
  if (isFolder(asked) && !existsSync(join(asked, 'edit.json'))) {
    const holds = readdirSync(asked).filter((name) => !name.startsWith('.')).slice(0, 8);
    throw notAnEdit(asked, `it is a folder with no edit.json in it (it holds ${holds.length === 0 ? 'nothing' : holds.join(', ')})`,
      'Pass a folder that holds an edit.json, or the edit document itself under whatever name it has; `viraleditor init <dir>` writes a working project.');
  }
  const file = isFolder(asked) ? join(asked, 'edit.json') : asked;
  if (!existsSync(file) || !statSync(file).isFile()) {
    const beside = isFolder(dirname(file)) ? readdirSync(dirname(file)).filter((name) => !name.startsWith('.') && existsSync(join(dirname(file), name, 'edit.json'))).slice(0, 8) : [];
    throw new Stop([issue('file-missing', { target: file }, `The edit document is not there: ${file}.`,
      `${beside.length > 0 ? `Folders beside it that hold an edit.json: ${beside.join(', ')}. ` : ''}Give the project folder that holds edit.json, or the edit document itself; for a new project, \`viraleditor init <dir>\` writes a working one.`)]);
  }
  const bytes = readFileSync(file);
  const type = extname(file).toLowerCase();
  if (bytes.subarray(0, 4096).includes(0)) throw notAnEdit(file, MEDIA_TYPES.has(type) ? `it is a media file (${type.slice(1)}), not text` : 'it is not text (a media file or another binary file)');
  const text = bytes.toString('utf8');
  if (text.trim() === '') throw notAnEdit(file, 'the file is empty');
  if (/^\s*<(?:!doctype|html|\?xml|svg)/i.test(text)) throw notAnEdit(file, `it is an ${/^\s*<(?:\?xml|svg)/i.test(text) ? 'XML' : 'HTML'} file${basename(file) === 'index.html' ? ' (the composition the editor writes)' : ''}`);
  const json = parseJson(text, file);
  if (Array.isArray(json)) throw notAnEdit(file, 'it holds a list, and an edit document is an object with version, canvas, frames, media and shots');
  if (json === null || typeof json !== 'object') throw notAnEdit(file, `it holds ${json === null ? 'null' : `a ${typeof json}`}, and an edit document is an object with version, canvas, frames, media and shots`);
  const has = (key: string) => Object.hasOwn(json, key);
  if (!has('media') && Array.isArray((json as { checkAt?: unknown }).checkAt) && has('animations')) {
    throw notAnEdit(file, 'it is the timeline.json the editor writes (it has checkAt and animations, and no version, canvas or media); `inspect --timeline` takes it, nothing else does');
  }
  if (!has('media') && has('mode') && has('source')) throw notAnEdit(file, 'it is a template.json (it has source and mode, and no media): the pipeline makes an edit document from a template and a fill');
  if (!['version', 'canvas', 'media', 'shots'].some(has)) {
    const keys = Object.keys(json);
    throw notAnEdit(file, `it has none of version, canvas, media, shots (it has ${keys.length === 0 ? 'no keys at all' : `the keys ${keys.slice(0, 8).join(', ')}`})`);
  }

  const parsed = parseEdit(json);
  if (!parsed.ok) {
    throw new Stop(parsed.issues.map(fromEdit), {
      document: file, stage: 'schema',
      next: `Fix these and run \`viraleditor check ${sh(file)}\` again: only the shape of the document was checked. The rule checks (times, boxes, text that must fit) and the media checks have not run yet and may name more.`,
    });
  }
  return { file, dir: dirname(file), work: join(dirname(file), '.viraleditor'), edit: parsed.edit };
}

export interface Examined {
  project: Project;
  issues: Issue[];
  warnings: Issue[];
  streams: Record<string, StreamFacts>;      // the facts of every media file that could be read, by media key
  composition: Composition | null;           // null: the document has errors
  written: string | null;                    // the composition folder, when it was written
  deepCheck: 'ran' | 'stamp' | null;         // the renderer's check: run now, taken from the stamp of a run that passed, or not asked for (or not reached)
  place(target: string | null): string | undefined;   // from an id, an element or a media key to its place in the document
}

/** What compose needs to know of a media file. */
function composeFacts(kind: 'video' | 'image' | 'audio', facts: StreamFacts, fps: number): ComposeFacts {
  if (kind === 'audio') return { frames: Math.floor(facts.seconds * fps), audio: true };
  if (kind === 'image') return { frames: 0, audio: false, width: facts.width, height: facts.height };
  return { frames: facts.frames, audio: facts.audio, width: facts.width, height: facts.height };
}

/**
 * What a deep check that passed is bound to: the bytes of the document, the size and time of every media file, the
 * composition written from them (so a change of the editor itself counts) and the versions. One changed byte: another stamp.
 */
function stampOf(project: Project, composition: Composition): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(VERSION)).update(readFileSync(project.file));
  for (const [key, entry] of Object.entries(project.edit.media).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const stat = statSync(join(project.dir, entry.file));
    hash.update(`\n${key}|${entry.file}|${stat.size}|${stat.mtimeMs}`);
  }
  hash.update(composition.html).update(JSON.stringify(composition.timeline));
  return hash.digest('hex');
}
function stampRead(file: string): string | null {
  try { return (JSON.parse(readFileSync(file, 'utf8')) as { stamp?: string }).stamp ?? null; } catch { return null; }
}

/**
 * `depth`: 'document' checks the document and its media; 'written' also writes the composition folder (only when there
 * is no error); 'deep' also runs the renderer's check on it. With `trustStamp`, a deep check that passed for exactly
 * this document, these media files and this composition is not run again.
 */
export async function examine(context: Context, project: Project, depth: 'document' | 'written' | 'deep', trustStamp = false): Promise<Examined> {
  const { edit } = project;
  const { measure } = context.tools;

  // the facts of the media. A file that is missing or damaged is named by checkInputs below; a tool that does not run stops everything
  const streams: Record<string, StreamFacts> = {};
  for (const [key, entry] of Object.entries(edit.media)) {
    const path = join(project.dir, entry.file);
    if (!PATTERNS.file.test(entry.file) || !existsSync(path)) continue;          // a name outside assets/ is an issue (media-file), not a file to read
    try {
      streams[key] = await measure.streams(path);
    } catch (error) {
      if (!(error instanceof MediaError)) throw error;
      if (error.code === 'tool-failed') throw new Stop([issue('tool-failed', { target: 'ffprobe' }, `ffprobe could not read the media of the document: ${error.message}`)]);
    }
  }

  const inputs = split((await checkInputs(edit, project.dir, measure)).map((found) => fromInput(found, edit, project.dir)));
  const facts = Object.fromEntries(Object.entries(streams).map(([key, s]) => [key, composeFacts(edit.media[key]!.kind, s, edit.canvas.fps)]));
  let composition: Composition | null = null;
  let composed: Issue[] = [];
  try {
    composition = compose(edit, facts);
  } catch (error) {
    if (!(error instanceof ComposeError)) throw error;
    composed = error.issues.map(fromEdit);
  }
  // one fault, one issue. A file that could not be read has no facts: compose says so again (media-facts, media-size-unknown).
  if (inputs.issues.length > 0) composed = composed.filter((found) => found.code !== 'media-facts' && found.code !== 'media-size-unknown');
  // A clip that is too short is named by compose at the shot (clip-short) and by the media check at the file (media-short).
  const short = new Set(composed.filter((found) => found.code === 'clip-short').map((found) => edit.shots[Number(/^shots\[(\d+)\]/.exec(found.path ?? '')?.[1])]?.media));
  // A file name the document may not have (media-file: outside assets/) is not looked for where it points.
  const misnamed = new Set(composed.filter((found) => found.code === 'media-file').map((found) => /^media\.([^.]+)/.exec(found.path ?? '')?.[1]));
  const keyOf = (found: Issue): string => (found.path ?? '').replace(/^media\./, '');
  const issues = [...composed, ...inputs.issues.filter((found) => !(found.code === 'media-short' && short.has(keyOf(found))) && !misnamed.has(keyOf(found)))];
  const warnings = inputs.warnings.filter((found) => !misnamed.has(keyOf(found)));
  const place = placer(edit, composition?.timeline ?? null);

  let written: string | null = null;
  let deepCheck: Examined['deepCheck'] = null;
  if (depth !== 'document' && composition !== null && issues.length === 0) {
    written = join(project.work, 'composition');
    writeComposition(written, composition, Object.fromEntries(composition.files.map((name) => [name, join(project.dir, name)])));
    if (depth === 'deep') {
      const stampFile = join(project.work, 'deep-check.json');
      const stamp = stampOf(project, composition);
      if (trustStamp && stampRead(stampFile) === stamp) deepCheck = 'stamp';
      else {
        rmSync(stampFile, { force: true });
        const checked = await context.tools.renderer('looks').check(written);
        issues.push(...checked.issues.map((found) => fromRendererCheck(found, place, edit.canvas.fps, written!)));
        deepCheck = 'ran';
        if (issues.length === 0) {
          mkdirSync(project.work, { recursive: true });
          writeFileSync(stampFile, `${JSON.stringify({ stamp, passed: context.clock.now().toISOString() })}\n`);
        }
      }
    }
  }
  return { project, issues, warnings, streams, composition: issues.length === 0 ? composition : null, written, deepCheck, place };
}

/** Frames worth looking at: one inside the rest of every text, caption group and card (nothing moves there); without any, the middle of every shot. At most eight, spread over the video. */
export function stillsOf(examined: Examined): number[] {
  const timeline = examined.composition?.timeline;
  if (!timeline) return [];
  const all = timeline.checkAt.length > 0 ? timeline.checkAt : timeline.shots.map((shot) => shot.at + Math.floor(shot.for / 2));
  const most = 8;
  if (all.length <= most) return all;
  return [...new Set(Array.from({ length: most }, (_, i) => all[Math.round((i * (all.length - 1)) / (most - 1))]!))];
}
