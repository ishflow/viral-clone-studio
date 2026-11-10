// Test support: the labelled set of REAL renders (compose + the real renderer) on which the quality checks are measured and
// regression-tested (Task C2). A good render has nothing wrong; a bad render has exactly one planted fault.
// Footage is made with ffmpeg at the canvas size (bright and dark regions, gradients, noise, slow and fast motion); one case
// uses real generated footage when it is on disk.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMeasure } from '../adapters/measure.ts';
import { createRenderer } from '../adapters/renderer.ts';
import { compose } from '../compose/index.ts';
import { writeComposition } from '../compose/write.ts';
import type { Timeline } from '../edit/timeline.ts';
import type { ComposeFacts, Edit, TextStyle } from '../edit/types.ts';
import type { Measure } from '../ports.ts';
import { checkInputs } from './inputs.ts';
import type { QualityIssue } from './issue.ts';
import { checkOutput } from './output.ts';
import { FFMPEG, FFPROBE, ff } from './samples.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HF = join(ROOT, 'node_modules/.bin/hyperframes');
/** Real generated footage (a product shot, 1072x1928 at 24 fps), when the spike's assets are on this disk. */
const REAL = join(ROOT, '..', 'spike/viraleditor-render/assets/clip-d.mp4');
const CLIP_FRAMES = 100;
const RENDER_TIMEOUT_MS = 25 * 60_000;

export interface Canvas { width: 720 | 1080; height: 1280 | 1920 }
export const CANVASES: Canvas[] = [{ width: 720, height: 1280 }, { width: 1080, height: 1920 }];

// ── footage ──
/** The lavfi graph of each clip at a canvas size: its last filter gives the picture. */
function graphs({ width: W, height: H }: Canvas): Record<string, string> {
  const S = `${W}x${H}`;
  const small = `${W / 8}x${H / 8}`;
  // white clouds that drift over a blue sky: the clouds are exactly the colour of white text, and cross a text's rect within a few frames
  const cloud = "255*clip(2.5*(sin(X/W*9+N*0.06)*sin(Y/H*11+N*0.02)+0.5*sin(X/W*23-N*0.09+Y/H*5)-0.15)\\,0\\,1)";
  const dot = (colour: string) => `color=c=${colour}:s=${Math.round(W * 0.12)}x${Math.round(H * 0.08)}:r=30[dot];[bg][dot]overlay=x='${Math.round(W * 0.44)}+${Math.round(W * 0.07)}*sin(n/9)':y='${Math.round(H * 0.72)}+${Math.round(H * 0.02)}*cos(n/7)':shortest=1`;
  return {
    busy: `testsrc2=s=${S}:r=30`,                                                              // hard edges, saturated colours, white and black, things that move
    fractal: `mandelbrot=s=${W / 2}x${H / 2}:r=30,scale=${S}:flags=bicubic`,                     // gradients and fine detail, a slow zoom
    clouds: `nullsrc=s=${small}:r=30,format=gray,geq=lum='${cloud}',format=rgb24,lutrgb=r='90+165*val/255':g='160+95*val/255':b='235+20*val/255',scale=${S}:flags=bicubic,noise=alls=3:allf=t`,
    white: `gradients=s=${S}:r=30:c0=0xffffff:c1=0xe6e6e6:nb_colors=2:x0=0:y0=0:x1=${W}:y1=${H}:speed=0.02,noise=alls=4:allf=t`,     // footage of white text's own colour
    calm: `gradients=s=${S}:r=30:c0=0x2a4a66:c1=0xa88462:nb_colors=2:x0=0:y0=0:x1=${W}:y1=${H}:speed=0.00001[bg];${dot('0xe8c8a0')},noise=alls=3:allf=t`,   // a still background, one small thing that moves
    dark: `gradients=s=${S}:r=30:c0=0x06080c:c1=0x20262e:nb_colors=2:x0=0:y0=0:x1=${W}:y1=${H}:speed=0.00001[bg];${dot('0x6a5a40')},gblur=sigma=${W / 90},noise=alls=5:allf=t`,   // a night scene with one dim light
    black: `color=c=black:s=${S}:r=30`,
  };
}
const ENCODE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart'];
const TAGS = 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709';

/** Makes the clips and the music of one canvas in `dir` (once: a file that is there is kept). Returns media key → file. */
async function makeMedia(dir: string, canvas: Canvas): Promise<Record<string, string>> {
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {};
  const make = async (key: string, args: string[]) => {
    const file = join(dir, `${key}.${key === 'music' ? 'mp3' : 'mp4'}`);
    if (!existsSync(file)) {
      const part = join(dir, `part-${key}.${key === 'music' ? 'mp3' : 'mp4'}`);
      await ff([...args, part]);
      await ff(['-i', part, '-c', 'copy', file]);                 // a clip appears whole or not at all
    }
    files[key] = file;
  };
  for (const [key, graph] of Object.entries(graphs(canvas))) {
    await make(key, ['-f', 'lavfi', '-i', graph, '-vf', TAGS, '-frames:v', String(CLIP_FRAMES), ...ENCODE]);
  }
  // the clip `busy` holding its frame 20 from there on
  await make('frozen', ['-i', files.busy!, '-vf', `split[a][b];[a][b]freezeframes=first=20:last=${CLIP_FRAMES - 1}:replace=20,${TAGS}`, ...ENCODE]);
  if (existsSync(REAL)) {
    const { width: W, height: H } = canvas;
    await make('real', ['-i', REAL, '-vf', `fps=30,scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bicubic,crop=${W}:${H},${TAGS}`, '-frames:v', '90', ...ENCODE]);
  }
  await make('music', ['-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.4:sample_rate=48000:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=5',
    '-filter_complex', 'amix=inputs=2:normalize=0', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k']);
  return files;
}

// ── documents ──
const BLACK = '#000000';
const WHITE = '#ffffff';
/** The edit documents of the set at one canvas. Sizes are written for 720 and scaled. */
function documents({ width, height }: Canvas, real: boolean): Record<string, Edit> {
  const k = width / 720;
  const style = (weight: number, size: number, outline: boolean, font: TextStyle['font'] = 'Inter'): TextStyle =>
    ({ font, weight, size: Math.round(size * k), align: 'center', fill: WHITE, shadows: [], ...(outline ? { outline: { width: 0.08, colour: BLACK } } : {}) });
  const styles = { head: style(800, 64, true), hair: style(200, 40, false), small: style(700, 34, true, 'Montserrat'), bare: style(800, 64, false) };
  const base = { version: 1 as const, language: 'en', canvas: { width, height, fps: 30 as const }, styles };
  const clip = (key: string) => ({ [key]: { file: `assets/${key}.mp4`, kind: 'video' as const } });
  const none = { enter: { kind: 'none' as const }, exit: { kind: 'none' as const } };
  const words = ['small', 'captions', 'under', 'the', 'big', 'line'].map((text, i) => ({ text, at: 6 + i * 8, for: 8 }));
  const over = (key: string): Edit => ({
    ...base, frames: 60, media: clip(key), shots: [{ id: 's1', at: 0, for: 60, media: key }],
    texts: [
      { id: 'head', at: 12, for: 40, box: { left: 8, top: 20, right: 84, bottom: 32 }, style: 'head', copy: 'REAL RENDER', lines: 1 },
      { id: 'hair', at: 10, for: 44, box: { left: 8, top: 38, right: 84, bottom: 46 }, style: 'hair', copy: 'thin line text', lines: 1 },
    ],
    captions: { box: { left: 10, top: 54, right: 82, bottom: 64 }, style: 'small', words, group: { words: 3, lines: 1 } },
  });
  // one text on screen from the shot's first frame to its last (no frame of the shot is without it), one that comes in late
  const two = (key: string): Edit => ({
    ...base, frames: 60, media: clip(key), shots: [{ id: 's1', at: 0, for: 60, media: key }],
    texts: [
      { id: 'whole', at: 0, for: 60, box: { left: 8, top: 18, right: 84, bottom: 30 }, style: 'head', copy: 'ALL SHOT LONG', lines: 1, ...none },
      { id: 'late', at: 18, for: 36, box: { left: 8, top: 40, right: 84, bottom: 52 }, style: 'head', copy: 'COMES IN LATE', lines: 1 },
    ],
  });
  // captions alone, as speech leaves them: the sentence ends close groups of one, two, two and one word. In each group of two the short word comes first,
  // so that on the frame that is judged the long word is the active one and only "I" or "a" shows the fill
  const spoken = ['Wait.', 'I', 'understand', 'a', 'difference.', 'Yes.'].map((text, i) => ({ text, at: 6 + i * 8, for: 8 }));
  const said = (key: string, active?: NonNullable<Edit['captions']>['active']): Edit => ({
    ...base, frames: 60, media: clip(key), shots: [{ id: 's1', at: 0, for: 60, media: key }],
    captions: { box: { left: 10, top: 54, right: 82, bottom: 64 }, style: 'small', words: spoken, group: { words: 2, lines: 1 }, ...(active ? { active } : {}) },
  });
  return {
    busy: over('busy'),
    clouds: two('clouds'),
    white: two('white'),
    // a shot that zooms in from its first frame to its last (the footage is never at rest): over the test pattern, where every edge shows a misplaced pixel, and over the clouds
    push: { ...two('busy'), shots: [{ id: 's1', at: 0, for: 60, media: 'busy', motion: { kind: 'push-in' } }] },
    zoom: { ...two('clouds'), shots: [{ id: 's1', at: 0, for: 60, media: 'clouds', motion: { kind: 'push-in' } }] },
    // a calm shot, a dip through black into a dark shot, a white flash, a crossfade; music and the loudness pass
    cuts: {
      ...base, frames: 120,
      media: { ...clip('calm'), ...clip('dark'), ...clip('busy'), ...clip('fractal'), music: { file: 'assets/music.mp3', kind: 'audio' } },
      shots: [
        { id: 's1', at: 0, for: 30, media: 'calm' },
        { id: 's2', at: 30, for: 30, media: 'dark', in: { kind: 'dip' } },
        { id: 's3', at: 60, for: 30, media: 'busy', in: { kind: 'flash' } },
        { id: 's4', at: 90, for: 30, media: 'fractal', in: { kind: 'crossfade' } },
      ],
      texts: [{ id: 'night', at: 40, for: 18, box: { left: 8, top: 20, right: 84, bottom: 32 }, style: 'head', copy: 'IN THE DARK', lines: 1 }],
      audio: { music: { media: 'music', gain: 1 } },
    },
    lit: said('calm'),                                                                       // the active word in the default colour (#ffe000), a little larger
    pill: said('calm', { kind: 'pill', colour: '#ffe000', text: '#101010' }),                // the active word dark on a yellow pill
    ...(real ? { real: over('real') } : {}),
  };
}

// ── cases ──
export interface Case {
  name: string;
  doc: string;                                   // the document the timeline (the truth) comes from
  fault: string;                                 // what is planted; '' for a good render
  expect: string[];                              // a bad render is found when an issue with one of these codes is reported …
  target?: string;                               // … whose target starts with this
  edit?: (edit: Edit) => Edit;                   // the document that is really rendered
  swap?: Record<string, string>;                 // media key → the clip really put in its place
  after?: { of: string; args: (canvas: Canvas) => string[] };   // not rendered: made with ffmpeg from the render of another case
}
const without = (id: string) => (edit: Edit): Edit => ({ ...edit, texts: (edit.texts ?? []).filter((t) => t.id !== id) });
const mute = ({ captions: _removed, ...rest }: Edit): Edit => rest;
const TEXT = ['text-missing'];
export const CASES: Case[] = [
  { name: 'good-busy', doc: 'busy', fault: '', expect: [] },
  { name: 'good-clouds', doc: 'clouds', fault: '', expect: [] },
  { name: 'good-white', doc: 'white', fault: '', expect: [] },
  { name: 'good-cuts', doc: 'cuts', fault: '', expect: [] },
  { name: 'good-real', doc: 'real', fault: '', expect: [] },
  { name: 'good-push', doc: 'push', fault: '', expect: [] },
  { name: 'good-zoom', doc: 'zoom', fault: '', expect: [] },
  { name: 'removed-busy', doc: 'busy', fault: 'text "head" removed (busy footage, the text comes in late)', expect: TEXT, target: 'head', edit: without('head') },
  { name: 'removed-clouds-late', doc: 'clouds', fault: 'text "late" removed (bright moving footage)', expect: TEXT, target: 'late', edit: without('late') },
  { name: 'removed-clouds-whole', doc: 'clouds', fault: 'text "whole" removed (bright moving footage, covers its whole shot from frame 0)', expect: TEXT, target: 'whole', edit: without('whole') },
  { name: 'removed-white-whole', doc: 'white', fault: 'text "whole" removed (footage of the text colour, covers its whole shot from frame 0)', expect: TEXT, target: 'whole', edit: without('whole') },
  { name: 'removed-zoom-whole', doc: 'zoom', fault: 'text "whole" removed (bright moving footage in a shot that zooms in all along; covers its whole shot from frame 0)', expect: TEXT, target: 'whole', edit: without('whole') },
  { name: 'removed-real', doc: 'real', fault: 'text "head" removed (real footage)', expect: TEXT, target: 'head', edit: without('head') },
  { name: 'bare-white', doc: 'white', fault: 'text "late" in the footage\'s own colour without outline', expect: ['low-contrast', 'text-missing'], target: 'late',
    edit: (edit) => ({ ...edit, texts: edit.texts!.map((t) => (t.id === 'late' ? { ...t, style: 'bare' } : t)) }) },
  { name: 'pushed-busy', doc: 'busy', fault: 'text "head" pushed off its box (48 % of the height lower)', expect: TEXT, target: 'head',
    edit: (edit) => ({ ...edit, texts: edit.texts!.map((t) => (t.id === 'head' ? { ...t, safe: false as const, box: { ...t.box, top: t.box.top + 48, bottom: t.box.bottom + 48 } } : t)) }) },
  { name: 'good-lit', doc: 'lit', fault: '', expect: [] },
  { name: 'good-pill', doc: 'pill', fault: '', expect: [] },
  { name: 'removed-lit', doc: 'lit', fault: 'the captions removed (groups of one and two words, the active word in its colour)', expect: TEXT, target: 'cap-', edit: mute },
  { name: 'removed-pill', doc: 'pill', fault: 'the captions removed (groups of one and two words, the active word dark on a pill)', expect: TEXT, target: 'cap-', edit: mute },
  { name: 'black-clip', doc: 'busy', fault: 'the clip replaced by black', expect: ['black-frames'], swap: { busy: 'black' } },
  { name: 'frozen-clip', doc: 'busy', fault: 'the clip frozen from source frame 20', expect: ['frozen-frames', 'wrong-footage'], swap: { busy: 'frozen' } },
  { name: 'wrong-clip', doc: 'busy', fault: 'the wrong clip (the fractal in place of the test pattern)', expect: ['wrong-footage'], swap: { busy: 'fractal' } },
  { name: 'no-sound', doc: 'cuts', fault: 'the sound stream removed', expect: ['output-mismatch'], after: { of: 'good-cuts', args: () => ['-map', '0:v:0', '-c', 'copy', '-an'] } },
  { name: 'quiet-sound', doc: 'cuts', fault: 'the sound 12 dB low', expect: ['too-quiet'], after: { of: 'good-cuts', args: () => ['-c:v', 'copy', '-af', 'volume=-12dB', '-c:a', 'aac', '-b:a', '192k'] } },
  { name: 'wrong-size', doc: 'busy', fault: 'a file of three quarters the size', expect: ['output-mismatch'],
    after: { of: 'good-busy', args: (c) => ['-vf', `scale=${(c.width * 3) / 4}:${(c.height * 3) / 4}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p'] } },
  { name: 'wrong-rate', doc: 'busy', fault: 'a file at 25 fps', expect: ['output-mismatch'],
    after: { of: 'good-busy', args: () => ['-vf', 'fps=25', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p'] } },
];

export interface Built {
  name: string; size: number; good: boolean; fault: string; expect: string[]; target: string | null;
  file: string;                                  // the render
  dir: string;                                   // the composition folder (assets/ holds what was really rendered)
  edit: Edit;                                    // the document the timeline comes from
  timeline: Timeline;
  sources: Record<string, string>;               // media key → the clip the timeline means
}

export const measure: Measure = createMeasure(FFMPEG, FFPROBE);

/** Builds (or finds, when `root` already holds it) one case at one canvas. null: the case needs footage this disk does not have. */
export async function buildCase(root: string, wanted: Case, canvas: Canvas): Promise<Built | null> {
  const files = await makeMedia(join(root, `media-${canvas.width}`), canvas);
  const docs = documents(canvas, files.real !== undefined);
  const doc = docs[wanted.doc];
  if (!doc) return null;
  const dir = join(root, `${wanted.name}-${canvas.width}`);
  const file = join(dir, 'out', 'render.mp4');
  const facts: Record<string, ComposeFacts> = {};
  for (const key of Object.keys(doc.media)) {
    const s = await measure.streams(files[key]!);
    facts[key] = doc.media[key]!.kind === 'audio' ? { frames: Math.floor(s.seconds * 30), audio: true } : { frames: s.frames, audio: s.sound !== null };
  }
  const truth = compose(doc, facts);
  const built: Built = {
    name: wanted.name, size: canvas.width, good: wanted.fault === '', fault: wanted.fault, expect: wanted.expect, target: wanted.target ?? null,
    file, dir, edit: doc, timeline: truth.timeline, sources: Object.fromEntries(Object.keys(doc.media).map((key) => [key, files[key]!])),
  };
  const done = join(dir, 'done.json');
  if (existsSync(done) && existsSync(file)) return built;
  mkdirSync(join(dir, 'out'), { recursive: true });
  if (wanted.after) {
    const from = await buildCase(root, CASES.find((c) => c.name === wanted.after!.of)!, canvas);
    await ff(['-i', from!.file, ...wanted.after.args(canvas), file]);
  } else {
    const shown = wanted.edit ? compose(wanted.edit(doc), facts) : truth;
    const put = (key: string) => files[wanted.swap?.[key] ?? key]!;
    writeComposition(dir, shown, Object.fromEntries(Object.entries(doc.media).map(([key, entry]) => [entry.file, put(key)])));
    const renderer = createRenderer({ bin: HF, ffmpeg: FFMPEG, ffprobe: FFPROBE, measure, timeoutMs: RENDER_TIMEOUT_MS });
    await renderer.render(dir, file, () => {});
  }
  writeFileSync(done, `${JSON.stringify({ name: wanted.name, size: canvas.width })}\n`);
  return built;
}

/** Every case at every canvas, `jobs` renders at a time. */
export async function buildSet(root: string, jobs = 2, cases: Case[] = CASES, canvases: Canvas[] = CANVASES): Promise<Built[]> {
  for (const canvas of canvases) await makeMedia(join(root, `media-${canvas.width}`), canvas);
  const todo = canvases.flatMap((canvas) => cases.map((c) => ({ c, canvas })));
  // the renders other cases are made from come first, alone
  const first = todo.filter(({ c }) => cases.some((other) => other.after?.of === c.name));
  const rest = todo.filter((t) => !first.includes(t));
  const out: (Built | null)[] = [];
  for (const group of [first, rest]) {
    let next = 0;
    const worker = async () => { while (next < group.length) { const t = group[next++]!; out.push(await buildCase(root, t.c, t.canvas)); } };
    await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
  }
  const order = (b: Built) => cases.findIndex((c) => c.name === b.name) * 10000 + b.size;
  return out.filter((b): b is Built => b !== null).sort((a, b) => order(a) - order(b));
}

export interface Row { name: string; size: number; good: boolean; fault: string; errors: string[]; warnings: string[]; found: boolean; issues: QualityIssue[] }
const short = (i: QualityIssue) => `${i.code}${i.target ? `(${i.target.split('/').pop()})` : ''}`;

/** What the checks say about one render: the output check against the true timeline (and the true sources, unless `withSources` is false); for a good render the input check too. */
export async function judge(built: Built, withSources = true): Promise<Row> {
  const issues = await checkOutput(built.file, built.timeline, measure, withSources ? built.sources : undefined);
  if (built.good) issues.push(...await checkInputs(built.edit, built.dir, measure));
  const found = issues.some((i) => built.expect.includes(i.code) && (built.target === null || (i.target ?? '').startsWith(built.target)));
  return {
    name: built.name, size: built.size, good: built.good, fault: built.fault, found, issues,
    errors: issues.filter((i) => i.severity === 'error').map(short), warnings: issues.filter((i) => i.severity === 'warning').map(short),
  };
}

/** The measurement as one markdown table, and its two totals: errors on good renders (false alarms) and bad renders not found (misses). */
export function table(rows: Row[]): { text: string; falseAlarms: number; warnings: number; misses: number } {
  const lines = ['| render | size | planted fault | errors | warnings | verdict |', '|---|---|---|---|---|---|'];
  let falseAlarms = 0; let warnings = 0; let misses = 0;
  for (const r of rows) {
    const verdict = r.good ? (r.errors.length === 0 ? 'ok' : `FALSE ALARM x${r.errors.length}`) : r.found ? 'found' : 'MISSED';
    if (r.good) { falseAlarms += r.errors.length; warnings += r.warnings.length; } else if (!r.found) misses++;
    lines.push(`| ${r.name} | ${r.size} | ${r.fault || '(none)'} | ${r.errors.join(', ') || '-'} | ${r.warnings.join(', ') || '-'} | ${verdict} |`);
  }
  return { text: lines.join('\n'), falseAlarms, warnings, misses };
}
