// The reference video of a preparation: fetched once into `sources/<id>/`, then looked at (what is said, a sheet of its frames,
// where it cuts) and, when a beats template is written from it, drawn shot by shot. Everything is kept there (meta.json,
// transcript.json, sheet/sheet.jpg, shots/page-N.jpg), so a later run for the same reference fetches, measures and draws nothing
// again. The sheet and the shot pages have a folder of their own each: the model's adapter opens the folder of a file it is
// given, and these pictures are the only thing of the reference the model may open.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { FPS } from '../edit/presets.ts';
import type { SourceRange } from '../contracts.ts';
import type { Downloader, FrameRange, Media, Transcriber, Word } from '../ports.ts';
import { RANGE_SECONDS_MIN, SOURCE_SECONDS_MAX, VIDEO_SECONDS_MAX } from '../template/limits.ts';
import { shotPlan, shownFrames } from './cuts.ts';

interface WriteOwner { writeOwned?: <T>(body: () => T) => T; checkOwnership?: () => void }
const owned = <T>(deps: WriteOwner, body: () => T): T => deps.writeOwned ? deps.writeOwned(body) : body();

/** The video cannot be fetched or cannot be read. */
/** The downloader refused the video for its length or size (or because it is live): the same answer as for a video over the limit, and no retry. */
export class SourceTooLong extends Error {
  constructor(message: string) { super(message); this.name = 'SourceTooLong'; }
}
export class SourceUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'SourceUnavailable'; }
}

/** The range a customer picked is not one: not ascending, shorter than a template may use, longer than a video may be, or not in the video. */
export class RangeRefused extends Error {
  constructor(message: string) { super(message); this.name = 'RangeRefused'; }
}

/** What is wrong with a range whatever the video, or null. Only finite numbers pass: they reach ffmpeg's command line. */
export function rangeProblem(range: SourceRange): string | null {
  if (typeof range !== 'object' || range === null) return 'the range is not made of numbers';   // a stored input can hold anything
  const { from, to } = range;
  if (typeof from !== 'number' || typeof to !== 'number' || !Number.isFinite(from) || !Number.isFinite(to)) return 'the range is not made of numbers';
  if (from < 0 || to <= from) return 'the range does not go forward from the start of the video';
  if (to - from < RANGE_SECONDS_MIN) return `the range is shorter than ${RANGE_SECONDS_MIN} s`;
  if (to - from > VIDEO_SECONDS_MAX) return `the range is longer than ${VIDEO_SECONDS_MAX} s`;
  return null;
}

/** The range as it is cut from a video of `seconds`: one that ends up to half a second past the end ends where the video does. */
export function fitRange(range: SourceRange, seconds: number): SourceRange {
  const problem = rangeProblem(range);
  if (problem !== null) throw new RangeRefused(problem);
  if (range.to > seconds + 0.5) throw new RangeRefused('the range ends after the video does');
  const fit = { from: range.from, to: Math.min(range.to, seconds) };
  const left = rangeProblem(fit);
  if (left !== null) throw new RangeRefused(left);
  return fit;
}

/** Cuts the range out of `file` into `out`; the media port's refusal of a range is the customer's bad range, any other failure is the video's. */
export async function cutRange(media: Pick<Media, 'trim'>, file: string, range: SourceRange, out: string): Promise<void> {
  try { await media.trim(file, range.from, range.to, out); } catch (error) {
    if (error instanceof Error && error.name === 'MediaError' && (error as { code?: unknown }).code === 'bad-range') throw new RangeRefused(said(error));
    throw new SourceUnavailable(`the video could not be cut: ${said(error)}`);
  }
}

export interface Source { video: string; url: string; title: string; seconds: number; views: number | null; likes: number | null }
export interface Look extends Source {
  sheet: string;                                              // the frame sheet: the one file of the reference the model is given
  grid: { columns: number; rows: number };
  sheetSeconds: number[];                                     // the second of each frame of the sheet, row by row
  words: Word[];                                              // what is said
  shots: FrameRange[];                                        // the shot plan: the cuts measured on the file, in frames of a template
}

export const SHEET_GRID = { columns: 4, rows: 4 };
/** A shot takes two tiles of a shot sheet. */
export const SHOTS_A_PAGE = (SHEET_GRID.columns * SHEET_GRID.rows) / 2;
/** The language the reference is transcribed in. A run does not say it, and the scans search in English. */
const LANGUAGE = 'en';

const Meta = z.object({
  url: z.string(), file: z.string(), title: z.string(), seconds: z.number(), views: z.number().nullable(), likes: z.number().nullable(),
  sheet: z.object({ columns: z.number(), rows: z.number(), seconds: z.array(z.number()) }).nullable(),
  range: z.object({ from: z.number(), to: z.number() }).optional(),                    // the part of the video that was cut out: the file is only that part
  // the second of each hard cut, the faint cuts between them (not told by a source measured before they were), and the length of the picture
  cuts: z.object({ seconds: z.array(z.number()), faint: z.array(z.object({ second: z.number(), score: z.number() })).optional(), length: z.number() }).optional(),
  pages: z.array(z.string()).optional(),                                               // the shot sheets, as paths in the folder
});
const Transcript = z.array(z.object({ text: z.string(), start: z.number(), end: z.number() }));

/** A JSON file of the folder as its schema reads it, or null when it is not there or not what was written. */
function stored<T>(file: string, schema: z.ZodType<T>): T | null {
  if (!existsSync(file)) return null;
  try { return schema.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch { return null; }
}
const keep = (file: string, value: unknown): void => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const said = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The length of the video fetched into `dir` before, or null when none was. */
export function storedSeconds(dir: string): number | null {
  return stored(join(dir, 'meta.json'), Meta)?.seconds ?? null;
}

/**
 * The video in `dir`: the one fetched before, or a download. Its length is what the download says, else `fallbackSeconds`
 * (what the scan saw); when neither knows it, the file is measured, so that "too long" is decided before anything is transcribed.
 * With a `range` the part of it is cut out (once: meta.json names the cut file) and the part is the source, so its length is `to - from`.
 */
export async function fetchSource(deps: { downloader: Downloader; media: Media } & WriteOwner, dir: string, url: string, fallbackSeconds: number, range?: SourceRange): Promise<Source> {
  const meta = stored(join(dir, 'meta.json'), Meta);
  if (meta !== null && existsSync(resolve(dir, meta.file))) {
    return { video: resolve(dir, meta.file), url: meta.url, title: meta.title, seconds: meta.seconds, views: meta.views, likes: meta.likes };
  }
  owned(deps, () => mkdirSync(dir, { recursive: true }));
  let got: Awaited<ReturnType<Downloader['video']>>;
  try { got = await deps.downloader.video(url, dir); } catch (error) {
    // by name and code, not instanceof: this file knows the Downloader port, not the adapter behind it
    if (error instanceof Error && error.name === 'DownloadError' && (error as { code?: unknown }).code === 'rejected') throw new SourceTooLong(`the video was refused: ${said(error)}`);
    throw new SourceUnavailable(`the video could not be fetched: ${said(error)}`);
  }
  let seconds = got.seconds > 0 ? got.seconds : fallbackSeconds;
  if (!(seconds > 0)) {
    try { seconds = (await deps.media.probe(resolve(got.file))).seconds; } catch (error) { throw new SourceUnavailable(`the video could not be measured: ${said(error)}`); }
  }
  let source: Source = { video: resolve(got.file), url, title: got.title, seconds, views: got.views, likes: got.likes };
  let cut: SourceRange | undefined;
  if (range !== undefined) {
    if (seconds > SOURCE_SECONDS_MAX) throw new SourceTooLong(`the video is longer than ${SOURCE_SECONDS_MAX} s`);
    // the range is fitted to the file's own length, which the cut checks it against: a download's whole seconds may be a little more
    let measured: number;
    try { measured = (await deps.media.probe(source.video)).seconds; } catch (error) { throw new SourceUnavailable(`the video could not be measured: ${said(error)}`); }
    cut = fitRange(range, measured);
    const part = join(dir, 'range.mp4');
    await cutRange(deps.media, source.video, cut, part);
    source = { ...source, video: part, seconds: cut.to - cut.from };
  }
  owned(deps, () => keep(join(dir, 'meta.json'), { url, file: relative(dir, source.video), title: source.title, seconds: source.seconds, views: source.views, likes: source.likes, sheet: null, ...(cut ? { range: cut } : {}) } satisfies z.infer<typeof Meta>));
  return source;
}

/** What is said in the video, the sheet of its frames and its cuts; each is made once. */
export async function lookAt(deps: { transcriber: Transcriber; media: Media } & WriteOwner, dir: string, source: Source): Promise<Look> {
  const transcript = join(dir, 'transcript.json'), sheet = join(dir, 'sheet', 'sheet.jpg'), metaFile = join(dir, 'meta.json');
  try {
    let words = stored(transcript, Transcript);
    if (words === null) {
      words = await deps.transcriber.words(source.video, LANGUAGE);
      owned(deps, () => keep(transcript, words));
    }
    let meta = stored(metaFile, Meta);
    /** What was measured or drawn is written into the meta.json of the source, when it has one. */
    const record = (made: Partial<z.infer<typeof Meta>>): void => {
      if (meta === null) return;
      meta = { ...meta, ...made };
      owned(deps, () => keep(metaFile, meta));
    };
    let tiles = existsSync(sheet) ? meta?.sheet ?? null : null;
    if (tiles === null) {
      owned(deps, () => mkdirSync(dirname(sheet), { recursive: true }));
      tiles = { ...SHEET_GRID, seconds: (await deps.media.sheet(source.video, sheet, SHEET_GRID)).seconds };
      record({ sheet: tiles });
    }
    // the cuts, and the length of the picture itself: a download says its length in whole seconds, and the last shot ends where the picture does
    let cuts = meta?.cuts ?? null;
    if (cuts === null) {
      const facts = await deps.media.probe(source.video);
      cuts = { ...(await deps.media.cuts(source.video)), length: facts.frames / facts.fps };
      record({ cuts });
    }
    // a download of VIDEO_SECONDS_MAX whole seconds may measure a little more: the plan ends where a video may end at the latest
    const shots = shotPlan(cuts.seconds, Math.min(cuts.length, VIDEO_SECONDS_MAX), FPS, cuts.faint);
    return { ...source, sheet, grid: { columns: tiles.columns, rows: tiles.rows }, sheetSeconds: tiles.seconds, words, shots };
  } catch (error) {
    throw new SourceUnavailable(`the video could not be read: ${said(error)}`);
  }
}

/**
 * The shot sheets of a look, for the model that writes a beats template: every shot of the plan as two tiles side by side, how
 * it starts and how it ends, SHOTS_A_PAGE shots a page. Drawn only when such a template is about to be written, once: meta.json
 * names the pages, and a later run draws nothing again.
 */
export async function shotPages(deps: { media: Media } & WriteOwner, dir: string, look: Look): Promise<string[]> {
  const metaFile = join(dir, 'meta.json');
  try {
    const meta = stored(metaFile, Meta);
    let pages = meta?.pages?.every((page) => existsSync(join(dir, page))) ? meta.pages : null;
    if (pages === null) {
      pages = [];
      owned(deps, () => mkdirSync(join(dir, 'shots'), { recursive: true }));
      for (let from = 0; from < look.shots.length; from += SHOTS_A_PAGE) {
        const page = join('shots', `page-${pages.length + 1}.jpg`);
        const at = look.shots.slice(from, from + SHOTS_A_PAGE).flatMap((shot) => shownFrames(shot).map((frame) => frame / FPS));
        await deps.media.sheet(look.video, join(dir, page), { ...SHEET_GRID, labels: true, at });
        pages.push(page);
      }
      if (meta !== null) owned(deps, () => keep(metaFile, { ...meta, pages }));
    }
    return pages.map((page) => join(dir, page));
  } catch (error) {
    throw new SourceUnavailable(`the shots of the video could not be drawn: ${said(error)}`);
  }
}
