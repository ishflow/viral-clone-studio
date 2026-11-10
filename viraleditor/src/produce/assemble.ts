// The picture side of produce: the paid media of one variant → its checked video and its poster.
// This file is the order of things for one variant. It never throws: a variant is the unit of delivery, so whatever goes
// wrong comes back as `{ ok: false, reason, detail }` for this variant and is written to its quality.json. Paid files
// that are at fault are named (`faulty`), all of them at once, so that one resume makes exactly those again. A tool that
// fails, or a paid file that is gone from the disk, is `engine-error`: nothing is paid for again because of it.
import { copyFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { MediaError } from '../adapters/media.ts';
import { compose, ComposeError } from '../compose/index.ts';
import type { Composition } from '../compose/index.ts';
import { writeComposition } from '../compose/write.ts';
import type { StopReason } from '../contracts.ts';
import { holds } from '../db/runs.ts';
import type { RunRow } from '../db/runs.ts';
import { LIMITS } from '../edit/presets.ts';
import { parseEdit } from '../edit/schema.ts';
import type { ComposeFacts, Edit } from '../edit/types.ts';
import { abs, rel } from '../paths.ts';
import { RenderError } from '../ports.ts';
import type { Measure, MediaFacts } from '../ports.ts';
import { checkInputs, checkOutput } from '../quality/index.ts';
import type { QualityIssue } from '../quality/index.ts';
import { SILENT_LUFS } from '../quality/thresholds.ts';
import { parseScript, resolve, ResolveError } from '../resolve/index.ts';
import type { ResolveMedia } from '../resolve/index.ts';
import { clipShots, partsOf } from '../template/clips.ts';
import type { TemplateJson } from '../template/schema.ts';
import type { AssembleDeps } from './deps.ts';
import { earsOf, hear } from './speech.ts';
import type { Spoken } from './speech.ts';
import type { Assembled, Faulty, VariantMedia } from './types.ts';
import { WINDOW_FADE_IN, musicStart } from './window.ts';

/** jobs/<runId>/v<n>/quality.json: why the variant stopped (or null), what the input and output checks found, and how each talking clip got its word times. */
export interface Quality { stopped: StopReason | null; detail: string | null; issues: QualityIssue[]; speech: Spoken[] }

// The finished video and its poster, and the names they have until the video has passed its check.
const LOST = 'another worker holds this run now: this worker\'s render was not put in place';
const FINAL = 'final.mp4', POSTER = 'poster.jpg';
const RENDERED = 'render.part', STILL = 'poster.part';      // + '-<worker>.mp4' / '.jpg': each worker has temporary names of its own (F8b)
/** A temporary file of another worker this old belongs to a worker that died (a render runs 30 minutes at most): it is removed (M2). */
const STALE_PART_MS = 60 * 60_000;
/** The part of a worker's name that is safe in a file name. */
const tagOf = (worker: string | null): string => (worker ?? 'none').replace(/[^A-Za-z0-9_-]/g, '_');

/** This variant cannot become a video, for a reason that is known. `faulty`: the paid files it lies in. */
class Stop extends Error {
  reason: StopReason;
  faulty: Faulty[];
  constructor(reason: StopReason, detail: string, faulty: Faulty[] = []) { super(detail); this.name = 'Stop'; this.reason = reason; this.faulty = faulty; }
}

const own = <T>(record: Record<string, T> | undefined, key: string): T | undefined => (record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined);
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
/** The first issue's code and message. */
function told(issues: { code: string; message: string }[]): string {
  const [first] = issues;
  if (first === undefined) return 'no issue was named';
  return `${first.code}: ${first.message}${issues.length > 1 ? ` (and ${issues.length - 1} more)` : ''}`;
}
const errorsOf = (issues: QualityIssue[]): QualityIssue[] => issues.filter((issue) => issue.severity === 'error');
/** The extension of a file when it is a plain one ('.png'): its name in the composition keeps it. */
function extensionOf(file: string): string {
  const extension = extname(file).toLowerCase();
  return /^\.[a-z0-9]+$/.test(extension) ? extension : '';
}

/**
 * A file that is there and is not media is that file's fault and stops the variant with `reason`. A file that is gone
 * (`not-found`) and a tool that fails are thrown on (`engine-error`): a paid file that vanished is not paid for again.
 */
async function reading<T>(reason: StopReason, what: string, faulty: Faulty[], work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof MediaError && error.code === 'not-media') throw new Stop(reason, `${what} cannot be read: ${error.message}`, faulty);
    throw error;
  }
}

/** What the renderer says it cannot do with this composition (`RenderError`) stops the variant with `render-failed`; anything else it throws is a tool that broke. */
async function rendering<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof RenderError) throw new Stop('render-failed', error.message);
    throw error;
  }
}

/** The length of a paid sound file in seconds. A file that cannot be read, holds no sound of a real length, is silent or has no readable loudness, is at fault. */
async function soundOf(measure: Measure, kind: 'music' | 'voice', file: string): Promise<number> {
  const faulty: Faulty[] = [{ kind }];
  const facts = await reading('audio-failed', `the ${kind}`, faulty, () => measure.streams(abs(file)));
  if (facts.sound === null || !Number.isFinite(facts.seconds) || facts.seconds <= 0) {
    throw new Stop('audio-failed', `the ${kind} holds no sound of a length that can be used (${facts.sound === null ? 'no sound stream' : `${facts.seconds} s`}): ${file}`, faulty);
  }
  const loudness = await reading('audio-failed', `the ${kind}`, faulty, () => measure.loudness(abs(file)));
  if (loudness !== null && Number.isNaN(loudness.integrated)) {
    throw new Stop('audio-failed', `the ${kind} has no loudness that can be read (NaN): ${file}`, faulty);
  }
  if (loudness !== null && loudness.integrated < SILENT_LUFS) {
    throw new Stop('audio-failed', `the ${kind} is silent (${Number.isFinite(loudness.integrated) ? loudness.integrated.toFixed(1) : '-inf'} LUFS, limit ${SILENT_LUFS}): ${file}`, faulty);
  }
  return facts.seconds;
}

/** A file where the composition names it, as a link: an older link goes first, so nothing is ever written through it into its source. */
function link(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { force: true });
  try { symlinkSync(source, target); } catch { copyFileSync(source, target); }
}

/** A step that follows a failure and must not hide it: when it fails itself, that is added to what is told. */
function also(what: string, work: () => void): string {
  try { work(); return ''; } catch (error) { return ` · ${what}: ${oneLine(messageOf(error))}`; }
}

/**
 * One variant with all its media → `final.mp4` and `poster.jpg` in its folder. Called for one variant at a time.
 * Only a video that was rendered and passed its check in this call is ever called `final.mp4`: an earlier attempt's
 * files are removed first, and after a failure neither name is left.
 */
export async function assemble(deps: AssembleDeps, run: RunRow, template: TemplateJson, media: VariantMedia): Promise<Assembled> {
  const dir = abs(media.dir);
  const quality: Quality = { stopped: null, detail: null, issues: [], speech: [] };
  const rendered = `${RENDERED}-${tagOf(run.claimedBy)}.mp4`, still = `${STILL}-${tagOf(run.claimedBy)}.jpg`;
  // The folder is the variant's, not the worker's: only the worker that still holds the run may touch final.mp4, poster.jpg and quality.json (F8b).
  const mine = (): boolean => holds(deps.db, run.id, run.claimedBy);
  const clearTemps = (): void => { for (const name of [rendered, still]) rmSync(join(dir, name), { force: true }); };
  /** The temporary files of workers that died mid-render (SIGKILL leaves them): by their name pattern and age only, never a live worker's. */
  const sweepDead = (): void => {
    for (const name of readdirSync(dir)) {
      if (!/^(render|poster)\.part-[A-Za-z0-9_-]+\.(mp4|jpg)$/.test(name) || name === rendered || name === still) continue;
      if (deps.clock.now().getTime() - statSync(join(dir, name)).mtimeMs > STALE_PART_MS) rmSync(join(dir, name), { force: true });
    }
  };
  const clear = (): void => { clearTemps(); try { sweepDead(); } catch { /* no folder yet, or a file gone meanwhile: nothing to sweep */ } if (mine()) for (const name of [FINAL, POSTER]) rmSync(join(dir, name), { force: true }); };
  const keep = (): void => {
    if (!mine()) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'quality.json'), `${JSON.stringify(quality, null, 1)}\n`);
  };
  try {
    if (!mine()) throw new Stop('engine-error', LOST);
    clear();
    await build(deps, template, media, dir, quality, { rendered, still, hold: () => { if (!mine()) throw new Stop('engine-error', LOST); }, verifyRepeat: !(run.input.kind === 'produce' && run.input.sample) });
    keep();
    // the check and the rename follow each other with nothing awaited between: a worker that lost the run while it rendered never puts its video in place
    if (!mine()) throw new Stop('engine-error', LOST);
    renameSync(join(dir, rendered), join(dir, FINAL));
    renameSync(join(dir, still), join(dir, POSTER));
    return { ok: true, video: rel(media.dir, FINAL), image: rel(media.dir, POSTER) };
  } catch (error) {
    const stop = error instanceof Stop ? error : new Stop('engine-error', messageOf(error));
    quality.stopped = stop.reason;
    quality.detail = oneLine(stop.message) + also('the unfinished video could not be removed', clear);
    const detail = quality.detail + also('quality.json could not be written', keep);
    return { ok: false, reason: stop.reason, detail, ...(stop.faulty.length > 0 ? { faulty: stop.faulty } : {}) };
  }
}

/** Everything up to the checked video and its poster under their temporary names. Throws `Stop` for what is known; anything else thrown is a tool's failure. */
async function build(deps: AssembleDeps, template: TemplateJson, media: VariantMedia, dir: string, quality: Quality, names: { rendered: string; still: string; hold: () => void; verifyRepeat: boolean }): Promise<void> {
  const { hold } = names;                                // throws when this worker no longer holds the run: asked before each stage that writes into the variant's folder (I2)
  const { fill } = media;
  const { fps } = template.canvas;
  const speech = template.mode === 'speech';
  const sources: Record<string, string> = {};            // a file of the composition ('assets/…') → the file it is a link to
  const clips: Record<string, MediaFacts> = {};          // the normalised clips, by their file of the composition
  const stills: Record<string, MediaFacts> = {};         // the generated stills, likewise
  const given: ResolveMedia = { clips: {}, music: null, images: {}, words: {} };
  const asset = (name: string, source: string): string => { sources[`assets/${name}`] = source; return `assets/${name}`; };

  // ── the paid files, every one of them: what is at fault is noted and the next file is looked at ──
  const found: Stop[] = [];
  const examine = async (work: () => Promise<void>): Promise<void> => {
    try { await work(); } catch (error) {
      if (!(error instanceof Stop) || error.faulty.length === 0) throw error;
      found.push(error);
    }
  };

  // the voice sample the talking clips were made from: when it is no sound, the clips cannot be right
  const voice = media.voice;
  if (speech && voice !== null) await examine(async () => { await soundOf(deps.measure, 'voice', voice); });

  // the clips: every one to the canvas, its rate and BT.709; a talking clip keeps its sound. One per shot that owns a clip:
  // a shot that continues a clip shows a part of the owner's file
  for (const shot of clipShots(template)) {
    const key = speech ? shot.segment ?? '' : shot.id;   // the clip's key in `media.clips`
    const from = own(media.clips, key);
    if (from === undefined) throw new Error(`variant ${media.n} was handed over without the clip of shot "${shot.id}"`);
    hold();
    await examine(async () => {
      const faulty: Faulty[] = [{ kind: 'clip', id: key }];
      const to = join(dir, 'clips', `${shot.id}.mp4`);
      mkdirSync(dirname(to), { recursive: true });
      const facts = await reading('clips-failed', `the clip of shot "${shot.id}"`, faulty, () => deps.media.normalize(abs(from), to, { ...template.canvas, audio: speech }));
      if (!Number.isInteger(facts.frames) || facts.frames < 1) throw new Stop('clips-failed', `the clip of shot "${shot.id}" has no frames (${facts.frames})`, faulty);
      if (speech && !facts.audio) throw new Stop('clips-failed', `the clip of shot "${shot.id}" has no sound: it cannot speak its lines`, faulty);
      // beats: a clip longer than its shot is used from its start; a shorter one cannot fill its shot (a talking shot is as long as its clip).
      // A clip with parts (shots that continue it) is laid out over its whole length by resolve: too short is shorter than its parts together
      const parts = speech ? [] : partsOf(template, shot.id);
      const needed = parts.reduce((sum, part) => sum + part.frames, 0), shown = shot.for ?? 0;
      if (facts.frames < needed) {
        throw new Stop('clips-failed', parts.length === 1
          ? `the clip of shot "${shot.id}" is shorter than its shot: the shot shows ${shown} frames${needed > shown ? ` and ${needed - shown} more under the next transition` : ''}, the clip has ${facts.frames}`
          : `the clip of shot "${shot.id}" is shorter than its parts: the shots ${parts.map((part) => `"${part.shot.id}"`).join(', ')} show ${needed} frames of it (with the next shot's transition), the clip has ${facts.frames}`, faulty);
      }
      const file = asset(`clip-${shot.id}.mp4`, to);
      clips[file] = facts;
      given.clips[shot.id] = { file, frames: facts.frames };
    });
  }

  // speech: what each talking clip says and when, one clip at a time
  if (speech) {
    const ears = await earsOf(deps.transcriber, deps.aligner);
    for (const shot of template.shots) {
      const clip = given.clips[shot.id];
      if (clip === undefined) continue;                  // already at fault
      const segment = shot.segment ?? '';
      await examine(async () => {
        const faulty: Faulty[] = [{ kind: 'clip', id: segment }];
        const script = parseScript(own(fill.script, segment) ?? '').words;
        if (script.length > clip.frames) throw new Stop('clips-failed', `the clip of segment "${segment}" is too short for its lines: ${clip.frames} frames cannot show ${script.length} words one after the other`, faulty);
        const { spoken, words } = await hear(ears, sources[clip.file]!, segment, script, fill.language, clip.frames / fps);
        quality.speech.push(spoken);
        if (words === null) throw new Stop('clips-failed', `the clip of segment "${segment}" does not speak its lines: ${spoken.why}`, faulty);
        given.words[segment] = words;
      });
    }
  }

  // the music
  let musicFrames = 0;
  const music = media.music;
  if (music !== null) {
    await examine(async () => {
      musicFrames = Math.floor(await soundOf(deps.measure, 'music', music) * fps);
      given.music = { file: asset(`music${extensionOf(music)}`, abs(music)), frames: musicFrames };
    });
  }

  // the generated stills: shown by a card or a window of a speech video; a beats video never shows one (its first frames were made from them)
  for (const still of speech ? template.stills ?? [] : []) {
    const from = own(media.images, still.id);
    if (from === undefined) throw new Error(`variant ${media.n} was handed over without the still "${still.id}"`);
    await examine(async () => {
      const facts = await reading('images-failed', `the still "${still.id}"`, [{ kind: 'image', id: still.id }], () => deps.media.probe(abs(from)));
      const file = asset(`still-${still.id}${extensionOf(from)}`, abs(from));
      stills[file] = facts;
      given.images[`still:${still.id}`] = file;
    });
  }

  const [first, ...more] = found;
  if (first !== undefined) {
    const others = more.length === 0 ? '' : ` (and ${more.length} more paid file${more.length === 1 ? '' : 's'} at fault)`;
    throw new Stop(first.reason, `${first.message}${others}`, found.flatMap((stop) => stop.faulty));
  }

  // ── the customer's photographs ──
  fill.products.forEach((product, p) => product.images.forEach((image, i) => {
    given.images[i === 0 ? `product:${p + 1}` : `product:${p + 1}.${i + 1}`] = asset(`product-${p + 1}-${i + 1}${extensionOf(image)}`, abs(image));
  }));

  // ── the edit document ──
  let resolved: Edit;
  try { resolved = resolve(template, fill, given); } catch (error) {
    if (error instanceof ResolveError) throw new Stop('render-failed', told([error]));
    throw error;
  }
  if (resolved.audio?.music && musicFrames < resolved.frames) {
    // music shorter than the video starts again; a file too short for that cannot be used
    if (musicFrames < LIMITS.loopFrames) throw new Stop('audio-failed', `the music is too short to be looped under a video of ${resolved.frames} frames: it has ${musicFrames}, and a looped file has at least ${LIMITS.loopFrames}`, [{ kind: 'music' }]);
    resolved.audio.music.loop = true;
  }
  if (resolved.audio?.music && resolved.audio.music.from === undefined && musicFrames > resolved.frames) {
    // music longer than the video starts at its fullest stretch, not at a quiet intro
    const { music: track } = resolved.audio;
    const values = await reading('audio-failed', 'the music', [{ kind: 'music' }], () => deps.measure.momentary(abs(music!)));
    const start = musicStart(values, musicFrames, resolved.frames, fps);
    if (start > 0) { track.from = start; track.fadeIn = WINDOW_FADE_IN; }
  }
  const parsed = parseEdit(resolved);
  if (!parsed.ok) throw new Stop('render-failed', told(parsed.issues));
  const edit = parsed.edit;
  hold();
  writeFileSync(join(dir, 'edit.json'), `${JSON.stringify(edit, null, 1)}\n`);

  // ── every file the document shows: its facts for compose, and its place in the composition folder for the input check ──
  const facts: Record<string, ComposeFacts> = {};
  const shown: Record<string, string> = {};              // media key → the file, for the output check
  for (const [key, { file, kind }] of Object.entries(edit.media)) {
    const source = sources[file];
    if (source === undefined) throw new Error(`the edit names ${file}, which this variant does not have`);
    shown[key] = source;
    if (kind === 'audio') facts[key] = { frames: musicFrames, audio: true };
    else {
      // a clip and a still were read above; a customer's photograph is read here, and no paid file is at fault when it cannot be
      const probed = clips[file] ?? stills[file] ?? await reading('images-failed', `the picture "${key}"`, [], () => deps.media.probe(source));
      facts[key] = { frames: probed.frames, audio: probed.audio, width: probed.width, height: probed.height };
    }
    hold();
    link(source, join(dir, file));
  }
  const inputs = await checkInputs(edit, dir, deps.measure);
  quality.issues.push(...inputs);
  if (errorsOf(inputs).length > 0) throw new Stop('render-failed', told(errorsOf(inputs)));

  // ── the composition, written and checked ──
  let composition: Composition;
  try { composition = compose(edit, facts); } catch (error) {
    if (error instanceof ComposeError) throw new Stop('render-failed', told(error.issues));
    throw error;
  }
  hold();
  writeComposition(dir, composition, sources);
  const checked = await rendering(() => deps.renderer.check(dir));
  hold();
  if (!checked.ok || checked.issues.length > 0) throw new Stop('render-failed', checked.issues.length > 0 ? told(checked.issues) : 'the renderer\'s check failed without naming an issue');

  // ── the render, the check of the video, the poster ──
  deps.onRender?.();
  const rendered = join(dir, names.rendered);
  hold();
  // a video that is delivered is rendered until two renders show the same picture; a template's own sample video is rendered once
  await rendering(() => deps.renderer.render(dir, rendered, () => {}, { verifyRepeat: names.verifyRepeat }));
  const output = await checkOutput(rendered, composition.timeline, deps.measure, shown);
  quality.issues.push(...output);
  if (errorsOf(output).length > 0) throw new Stop('render-failed', told(errorsOf(output)));
  const { timeline } = composition;
  const poster = timeline.checkAt[0] ?? Math.min(timeline.fps, timeline.frames - 1);   // a frame on which the first text stands still; without texts, one second in
  await deps.media.still(rendered, poster / timeline.fps, join(dir, names.still));
}
