// The picture side with the in-memory fakes: the real resolve, compose, writeComposition, checkInputs and checkOutput run on
// scripted facts, so nothing here needs ffmpeg or a browser.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FakeClock, FakeLlm, FakeGenerator, FakeMedia, FakeRenderer, FakeTranscriber } from '../adapters/fakes.ts';
import { MediaError } from '../adapters/media.ts';
import { compose, ComposeError } from '../compose/index.ts';
import type { RunRow } from '../db/runs.ts';
import type { Timeline } from '../edit/timeline.ts';
import { stylesOf } from '../edit/presets.ts';
import type { Edit } from '../edit/types.ts';
import { abs } from '../paths.ts';
import { RenderError } from '../ports.ts';
import type { AlignedWord, Aligner, CheckIssue, FrameRange, Loudness, Measure, MediaFacts, StreamFacts, Word } from '../ports.ts';
import { SILENT_LUFS } from '../quality/thresholds.ts';
import { parseScript } from '../resolve/index.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';
import { assemble } from './assemble.ts';
import type { AssembleDeps } from './deps.ts';
import { golden, goldenWithParts, goldenWithStill, inputOf, put, seed, startRun, workspace } from './testing.ts';
import type { Assembled, VariantMedia } from './types.ts';

vi.mock('../compose/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../compose/index.ts')>();
  return { ...actual, compose: vi.fn(actual.compose) };       // the real compose; what it was given is kept
});
vi.setConfig({ testTimeout: 120_000 });                      // the machine is shared: a speech video composes 900 frames, and nothing here is judged by the clock

const FPS = 30;
const video = (frames: number, audio: boolean): MediaFacts => ({ width: 720, height: 1280, fps: FPS, frames, seconds: frames / FPS, audio });
const SOUND = { codec: 'aac', sampleRate: 48000, channels: 2 };
const BT709 = { space: 'bt709', transfer: 'bt709', primaries: 'bt709' };
const NOTHING: StreamFacts = {
  width: 0, height: 0, fps: 0, frames: 0, seconds: 0, audio: false, codec: '', pixelFormat: '',
  colour: { space: null, transfer: null, primaries: null }, keyframes: [], sound: null, constantRate: true,
};

/** The script of a segment spoken evenly over `seconds`, as a recogniser hears it: no marks, no punctuation. */
function evenly(lines: string, seconds: number, shift = 0): Word[] {
  const texts = parseScript(lines).words;
  const step = (seconds - 0.4) / texts.length;
  return texts.map((text, i) => ({ text: text.replace(/[^\p{L}\p{N}']/gu, ''), start: 0.2 + shift + i * step, end: 0.2 + shift + (i + 0.9) * step }));
}

interface Options {
  golden?: { template: TemplateJson; fill: FillJson };   // in place of the golden of that id
  frames?: Record<string, number>;                  // the normalised clip of a shot; default: what was asked for (beats the billed seconds, speech clip_seconds)
  sound?: Record<string, boolean>;                  // has the normalised clip of a shot sound; default: speech yes, beats no
  normalize?: Record<string, Error>;                // by shot id
  musicSeconds?: number;                            // default 30
  probe?: Record<string, MediaFacts | Error>;       // of a picture, by file name; default 1024×1024 (a photograph), 720×1280 (a still)
  unreadable?: string[];                            // file names `measure.streams` cannot read
  gone?: string[];                                  // file names that are no longer on the disk when `measure.streams` looks
  loud?: Record<string, Loudness>;                  // of a source file, by file name; default -16 LUFS
  heard?: Record<string, Word[]>;                   // by segment id; default: the fill's script, evenly
  aligner?: Aligner;
  streams?: Record<string, Partial<StreamFacts>>;   // by file name, over what the fake measure says by itself
  black?: FrameRange[];                             // of final.mp4
  loudness?: Loudness;                              // of final.mp4
  momentary?: Record<string, number[]>;             // the music's momentary loudness by file name; none: not scripted
  check?: { ok: boolean; issues: CheckIssue[] } | Error;
  render?: Error;
}

interface World {
  dataDir: string; template: TemplateJson; fill: FillJson; run: RunRow; variant: VariantMedia;
  media: FakeMedia; renderer: FakeRenderer; transcriber: FakeTranscriber;
  log: string[];                                    // 'normalize s1', 'words', 'check', 'onRender', 'render', 'still' in the order they happened
  deps: AssembleDeps;
  go: () => Promise<Assembled>;
  file: (name: string) => string;                   // a file of the variant's folder
  read: <T>(name: string) => T;
}

function world(id: 'layering-01' | 'lashly-01', options: Options = {}): World {
  const { dir: dataDir, db } = workspace();
  const { template, fill } = options.golden ?? golden(id);
  seed(template, fill);
  const clock = new FakeClock();
  const run = startRun(db, clock, template, inputOf(template, fill, 1));
  const speech = template.mode === 'speech';
  const paid = (name: string): string => { put(`jobs/${run.id}/paid/v1/${name}`, `paid ${name}`); return `jobs/${run.id}/paid/v1/${name}`; };

  // what the money side hands over
  const variant: VariantMedia = { n: 1, dir: `jobs/${run.id}/v1`, fill, images: {}, clips: {}, music: paid('music.mp3'), voice: speech ? paid('voice.mp3') : null };
  const frames: Record<string, number> = {};
  const normalizes: Record<string, MediaFacts | Error> = {};
  const owners = template.shots.filter((shot) => shot.continues === undefined);   // a shot that continues a clip has no file of its own
  for (const shot of owners) {
    const clip = paid(`clip-${shot.id}.mp4`);
    variant.clips[speech ? shot.segment! : shot.id] = clip;
    if (!speech) variant.images[shot.id] = paid(`image-${shot.id}.png`);
    frames[shot.id] = options.frames?.[shot.id] ?? (speech ? shot.clip_seconds! * FPS : Math.max(4, Math.ceil(shot.clip_seconds!)) * FPS);
    normalizes[abs(clip)] = options.normalize?.[shot.id] ?? video(frames[shot.id]!, options.sound?.[shot.id] ?? speech);
  }
  const probes: Record<string, MediaFacts | Error> = {};
  if (speech) variant.images.presenter = paid('image-presenter.png');
  for (const still of template.stills ?? []) {       // beats too: the money side hands over every paid image
    variant.images[still.id] = paid(`image-${still.id}.png`);
    probes[abs(variant.images[still.id]!)] = { width: 720, height: 1280, fps: 25, frames: 1, seconds: 0.04, audio: false };
  }
  for (const product of fill.products) for (const image of product.images) probes[abs(image)] = { width: 1024, height: 1024, fps: 25, frames: 1, seconds: 0.04, audio: false };

  for (const file of Object.keys(probes)) probes[file] = options.probe?.[basename(file)] ?? probes[file]!;

  const log: string[] = [];
  const folder = join(dataDir, variant.dir);
  const rendered = (file: string) => dirname(file) === folder && extname(file) === '.mp4';   // the video of this attempt, whatever it is called
  const media = new FakeMedia({ normalizes: { by: normalizes }, probes: { by: probes }, stills: { queue: [true] }, writeFiles: true });
  const normalised = new Map<string, string>();     // a normalised clip → its shot, learned from what was asked of `normalize`
  const transcriber = new FakeTranscriber();
  const total = speech ? Object.values(frames).reduce((sum, n) => sum + n, 0) : Math.max(...template.shots.map((shot) => shot.at! + shot.for!));
  const renderer = new FakeRenderer({
    checks: [options.check ?? { ok: true, issues: [] }],
    renders: [options.render ?? { facts: video(total, true), content: 'a rendered video' }],
  });

  let table: Timeline | undefined;                    // one composition per world: its frame table is read once
  const timelineOf = (file: string): Timeline => (table ??= JSON.parse(readFileSync(join(dirname(file), 'timeline.json'), 'utf8')) as Timeline);

  // What a real Measure sees in a picture. Footage: every file has a flat colour of its own (never near black or white), a
  // little different on every frame. A source file shows its footage alone. The render shows, on each frame, the footage of
  // the shot that is on (at the source frame the frame table says) or, while the shot is a window, the picture behind it with
  // the shot inside the window's rect; over that the cards, then the text lines (the plate of the style when it has one, and
  // the letters as a block in the fill colour) and the caption groups that are on. What the render shows of a media key is
  // the file the composition folder links under that key, so a wrong link shows wrong footage.
  type Rgb = [number, number, number];
  const footage = (file: string, frame: number): Rgb => {
    let hash = 7;
    for (const letter of realpathSync(file)) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
    return [32 + (hash % 48) + (frame % 16), 32 + ((hash >>> 8) % 48) + (frame % 16), 32 + ((hash >>> 16) % 48) + (frame % 16)];
  };
  const rgbOf = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
  const paint = (picture: { width: number; height: number; rgb: Uint8Array }, rect: { x: number; y: number; width: number; height: number }, colour: Rgb): void => {
    const left = Math.max(0, rect.x), right = Math.min(picture.width, rect.x + rect.width);
    if (right <= left) return;
    const row = new Uint8Array((right - left) * 3);
    for (let i = 0; i < row.length; i++) row[i] = colour[i % 3]!;
    for (let y = Math.max(0, rect.y); y < Math.min(picture.height, rect.y + rect.height); y++) picture.rgb.set(row, (y * picture.width + left) * 3);
  };
  const inset = (rect: { x: number; y: number; width: number; height: number }, by: number) => ({ x: rect.x + by, y: rect.y + by, width: rect.width - 2 * by, height: rect.height - 2 * by });
  let document: { edit: Edit; styles: ReturnType<typeof stylesOf> } | undefined;      // the edit the composition was made of, read once
  const documentOf = () => (document ??= ((edit: Edit) => ({ edit, styles: stylesOf(edit) }))(JSON.parse(readFileSync(join(folder, 'edit.json'), 'utf8')) as Edit));
  const flat = (width: number, height: number, colour: Rgb) => {
    const picture = { width, height, rgb: new Uint8Array(width * height * 3) };
    paint(picture, { x: 0, y: 0, width, height }, colour);
    return picture;
  };
  const measure: Measure = {
    async streams(file) {
      const name = basename(file), over = options.streams?.[name] ?? {};
      if (options.unreadable?.includes(name)) throw new MediaError('not-media', `not a readable media file: ${name}`);
      if (options.gone?.includes(name)) throw new MediaError('not-found', `no such file: ${name}`);
      if (rendered(file)) {
        const timeline = timelineOf(file);
        return { ...NOTHING, ...video(timeline.frames, timeline.audio.length > 0), codec: 'h264', pixelFormat: 'yuv420p', colour: BT709, sound: timeline.audio.length > 0 ? SOUND : null, ...over };
      }
      if (extname(name) === '.mp4') {
        const shot = name.replace(/^clip-|\.mp4$/g, ''), n = frames[shot] ?? 0;
        const sound = options.sound?.[shot] ?? speech;
        return { ...NOTHING, ...video(n, sound), codec: 'h264', pixelFormat: 'yuv420p', colour: BT709, keyframes: Array.from({ length: Math.ceil(n / FPS) }, (_, i) => i * FPS), sound: sound ? SOUND : null, ...over };
      }
      if (extname(name) === '.mp3') return { ...NOTHING, seconds: name === 'voice.mp3' ? 6 : options.musicSeconds ?? 30, audio: true, codec: 'mp3', sound: { codec: 'mp3', sampleRate: 44100, channels: 2 }, ...over };
      return { ...NOTHING, width: name.startsWith('still-') ? 720 : 1024, height: name.startsWith('still-') ? 1280 : 1024, frames: 1, codec: 'png', pixelFormat: 'rgb24', ...over };
    },
    async black(file) { return rendered(file) ? options.black ?? [] : []; },
    async frozen() { return []; },
    async momentary(file) { return options.momentary?.[basename(file)] ?? []; },
    async loudness(file) { return rendered(file) ? options.loudness ?? { integrated: -14, truePeak: -1.5, range: 5 } : options.loud?.[basename(file)] ?? { integrated: -16, truePeak: -2, range: 6 }; },
    async picture(file, frame) {
      if (!rendered(file)) {
        const facts = Object.entries(probes).find(([path]) => existsSync(path) && realpathSync(path) === realpathSync(file))?.[1];
        const size = facts === undefined || facts instanceof Error ? template.canvas : facts;      // a clip is normalised to the canvas
        return flat(size.width, size.height, footage(file, frame));
      }
      const timeline = timelineOf(file);
      const { edit, styles } = documentOf();
      const linked = (key: string) => join(folder, edit.media[key]!.file);
      const on = (item: { at: number; for: number }) => item.at <= frame && frame < item.at + item.for;
      const shot = timeline.shots.find(on) ?? timeline.shots.at(-1)!;
      const moving = footage(linked(shot.media), shot.kind === 'video' ? shot.from + (frame - shot.at) : 0);
      const picture = flat(timeline.width, timeline.height, moving);
      const window = timeline.windows.find((opened) => opened.shot === shot.id && on(opened));
      if (window) {
        const behind = window.pictures.find(on) ?? window.pictures[0]!;
        paint(picture, { x: 0, y: 0, width: timeline.width, height: timeline.height }, footage(linked(behind.behind), 0));
        paint(picture, window.rect, moving);
      }
      for (const card of timeline.cards) if (on(card)) paint(picture, card.rect, footage(linked(card.media), 0));
      for (const line of timeline.texts) {
        if (!on(line)) continue;
        const plate = styles[edit.texts!.find((text) => text.id === line.id)!.style]?.plate;
        if (plate) paint(picture, line.rect, rgbOf(plate.colour));
        paint(picture, inset(line.rect, plate ? 8 : 4), rgbOf(line.colour));
      }
      for (const group of timeline.captions) if (on(group)) paint(picture, inset(group.rect, 4), rgbOf(group.colour));
      return picture;
    },
  };

  // the order of things, seen from outside
  const names = new Map(owners.map((shot) => [abs(variant.clips[speech ? shot.segment! : shot.id]!), shot.id]));
  const normalize = media.normalize.bind(media), still = media.still.bind(media);
  const check = renderer.check.bind(renderer), render = renderer.render.bind(renderer);
  media.normalize = (file, to, target) => { log.push(`normalize ${names.get(file)}`); normalised.set(to, names.get(file)!); return normalize(file, to, target); };
  media.still = (file, second, to) => { log.push('still'); return still(file, second, to); };
  /** What a recogniser hears in a clip is what that clip says: by default the fill's lines of its segment, evenly over the length asked for. */
  transcriber.words = async (file, language) => {
    log.push('words');
    transcriber.calls.push({ media: file, language });
    const shot = template.shots.find((each) => each.id === normalised.get(file))!;
    return options.heard?.[shot.segment!] ?? evenly(fill.script![shot.segment!]!, shot.clip_seconds!);
  };
  renderer.check = (dir) => { log.push('check'); return check(dir); };
  renderer.render = (dir, to, onProgress) => { log.push('render'); return render(dir, to, onProgress); };

  const deps: AssembleDeps = {
    db, clock, media, renderer, transcriber, measure, generator: new FakeGenerator(), llm: new FakeLlm(),
    onRender: () => log.push('onRender'),
    ...(options.aligner ? { aligner: options.aligner } : {}),
  };
  const file = (name: string) => join(dataDir, variant.dir, name);
  return {
    dataDir, template, fill, run, variant, media, renderer, transcriber, log, deps, file,
    go: () => assemble(deps, run, template, variant),
    read: <T>(name: string) => JSON.parse(readFileSync(file(name), 'utf8')) as T,
  };
}

interface Quality { stopped: string | null; detail: string | null; issues: { code: string; severity: string; target: string | null }[]; speech: { segment: string; share: number; times: string; why: string }[] }
const normalizeCalls = (w: World) => w.media.calls.flatMap((call) => (call.kind === 'normalize' ? [call] : []));

describe('assemble, a beats template', () => {
  it('normalises every clip, composes into the variant\'s folder, checks, renders, checks the video, makes the poster', async () => {
    const w = world('layering-01');
    expect(await w.go()).toEqual({ ok: true, video: `${w.variant.dir}/final.mp4`, image: `${w.variant.dir}/poster.jpg` });
    expect(w.log).toEqual(['normalize s1', 'normalize s2', 'normalize s3', 'normalize s4', 'normalize s5', 'check', 'onRender', 'render', 'still']);

    // every clip to the canvas, without its sound; the paid file itself is never written over
    const calls = normalizeCalls(w);
    expect(calls.map((call) => call.target)).toEqual(Array.from({ length: 5 }, () => ({ width: 720, height: 1280, fps: 30, audio: false })));
    for (const call of calls) {
      expect(call.to.startsWith(w.file(''))).toBe(true);
      expect(readFileSync(call.file, 'utf8')).toMatch(/^paid clip-/);
    }

    // the composition folder: the page, the frame table, the media as links to the normalised clips and the paid music
    expect(existsSync(w.file('index.html'))).toBe(true);
    expect(lstatSync(w.file('assets/clip-s1.mp4')).isSymbolicLink()).toBe(true);
    expect(realpathSync(w.file('assets/clip-s1.mp4'))).toBe(realpathSync(calls[0]!.to));
    expect(realpathSync(w.file('assets/music.mp3'))).toBe(realpathSync(abs(w.variant.music!)));

    // a clip longer than its shot is used from its start, for the shot's frames
    const timeline = w.read<Timeline>('timeline.json');
    expect(timeline.frames).toBe(240);
    expect(timeline.shots.map((shot) => [shot.id, shot.at, shot.for, shot.from])).toEqual([['s1', 0, 39, 0], ['s2', 39, 48, 0], ['s3', 87, 38, 0], ['s4', 125, 45, 0], ['s5', 170, 70, 0]]);

    // the render goes to a name of its own in the variant's folder, and the poster is taken from it
    const [checked, made] = w.renderer.calls as [{ kind: 'check'; dir: string }, { kind: 'render'; dir: string; to: string; progress: unknown[] }];
    expect(checked).toEqual({ kind: 'check', dir: w.file('') });
    expect(made).toMatchObject({ kind: 'render', dir: w.file(''), progress: [{ frame: 240, frames: 240 }] });
    expect(dirname(made.to)).toBe(w.file(''));
    expect(basename(made.to)).not.toBe('final.mp4');
    expect(w.media.calls.at(-1)).toMatchObject({ kind: 'still', file: made.to });
    // what is left is the finished video and its poster under their names, and nothing else of the attempt
    expect(readFileSync(w.file('final.mp4'), 'utf8')).toBe('a rendered video');
    expect(readFileSync(w.file('poster.jpg'), 'utf8')).toBe('fake media');
    expect(readdirSync(w.file('')).sort()).toEqual(['assets', 'clips', 'edit.json', 'final.mp4', 'index.html', 'poster.jpg', 'quality.json', 'timeline.json']);
    expect(w.transcriber.calls).toEqual([]);
    expect(w.read<Quality>('quality.json')).toEqual({ stopped: null, detail: null, issues: [], speech: [] });
  });

  it('the poster is a frame on which the first text stands still', async () => {
    const w = world('layering-01');
    await w.go();
    const timeline = w.read<Timeline>('timeline.json');
    const still = w.media.calls.at(-1) as { second: number };
    const frame = Math.round(still.second * FPS);
    expect(still.second).toBe(timeline.checkAt[0]! / FPS);
    expect(frame).toBeGreaterThanOrEqual(timeline.texts[0]!.rest.at);
    expect(frame).toBeLessThan(timeline.texts[0]!.rest.at + timeline.texts[0]!.rest.for);
  });

  it('keeps the edit document beside the composition', async () => {
    const w = world('layering-01');
    await w.go();
    const edit = w.read<Edit>('edit.json');
    expect(edit.frames).toBe(240);
    expect(edit.media['clip-s1']).toEqual({ file: 'assets/clip-s1.mp4', kind: 'video' });
    expect(edit.audio?.music?.loop).toBeUndefined();                      // 30 s of music for 8 s of video
  });

  it('music longer than the video starts at its fullest window, with a short fade-in', async () => {
    const w = world('layering-01', { momentary: { 'music.mp3': [...Array.from({ length: 100 }, () => -21), ...Array.from({ length: 200 }, () => -12)] } });   // 8 s video, 30 s music
    expect((await w.go()).ok).toBe(true);
    expect(w.read<Edit>('edit.json').audio?.music).toMatchObject({ from: 300, fadeIn: 3 });
  });

  it('music that is no louder anywhere stays at its first frame', async () => {
    const w = world('layering-01', { momentary: { 'music.mp3': Array.from({ length: 300 }, () => -14) } });
    expect((await w.go()).ok).toBe(true);
    const music = w.read<Edit>('edit.json').audio?.music;
    expect(music?.from).toBeUndefined();
    expect(music?.fadeIn).toBeUndefined();
  });

  it('music shorter than the video is looped', async () => {
    const w = world('layering-01', { musicSeconds: 5 });
    expect((await w.go()).ok).toBe(true);
    expect(w.read<Edit>('edit.json').audio?.music?.loop).toBe(true);
    expect(w.read<Timeline>('timeline.json').audio.filter((part) => part.media === 'music').length).toBeGreaterThan(1);
  });

  it('music exactly as long as the video is not looped', async () => {
    const w = world('layering-01', { musicSeconds: 8 });
    expect((await w.go()).ok).toBe(true);
    expect(w.read<Edit>('edit.json').audio?.music?.loop).toBeUndefined();
  });

  it('a clip shorter than its shot stops the variant with clips-failed, before anything is checked or rendered', async () => {
    const w = world('layering-01', { frames: { s5: 69 } });               // the shot shows 70 frames
    expect(await w.go()).toMatchObject({ ok: false, reason: 'clips-failed' });
    expect(w.renderer.calls).toEqual([]);
    expect(w.log).not.toContain('onRender');
    const quality = w.read<Quality>('quality.json');
    expect(quality.stopped).toBe('clips-failed');
    expect(quality.detail).toMatch(/s5.*70.*69/);
    expect(existsSync(w.file('final.mp4'))).toBe(false);
  });

  it('a shot needs its clip also under the transition that follows it', async () => {
    const w = world('layering-01', { frames: { s4: 52 } });               // 45 frames and 8 under the crossfade into s5
    expect(await w.go()).toMatchObject({ ok: false, reason: 'clips-failed' });
    expect((await world('layering-01', { frames: { s4: 53 } }).go()).ok).toBe(true);
  });

  it('a paid clip that is not a video stops the variant with clips-failed', async () => {
    const w = world('layering-01', { normalize: { s2: new MediaError('not-media', 'not a media file') } });
    expect(await w.go()).toMatchObject({ ok: false, reason: 'clips-failed' });
    expect(w.read<Quality>('quality.json').detail).toMatch(/s2.*not a media file/);
    expect(w.renderer.calls).toEqual([]);
  });

  it('an error of the input check stops the variant with render-failed; nothing is checked or rendered', async () => {
    const w = world('layering-01', { streams: { 'clip-s3.mp4': { fps: 25 } } });
    expect(await w.go()).toMatchObject({ ok: false, reason: 'render-failed' });
    expect(w.renderer.calls).toEqual([]);
    const quality = w.read<Quality>('quality.json');
    expect(quality.stopped).toBe('render-failed');
    expect(quality.issues).toContainEqual(expect.objectContaining({ code: 'media-fps', severity: 'error', target: 'clip-s3' }));
  });

  it('a warning of the input check does not stop the variant and is kept', async () => {
    const w = world('layering-01', { streams: { 'clip-s3.mp4': { colour: { space: null, transfer: null, primaries: null } } } });
    expect((await w.go()).ok).toBe(true);
    expect(w.read<Quality>('quality.json')).toMatchObject({ stopped: null, issues: [{ code: 'media-colour', severity: 'warning', target: 'clip-s3' }] });
  });

  it('issues of the renderer\'s check stop the variant with render-failed, and nothing is rendered', async () => {
    const w = world('layering-01', { check: { ok: false, issues: [{ code: 'text_box_overflow', message: 'the hook leaves its box', target: 'hook', second: 0.5 }] } });
    expect(await w.go()).toMatchObject({ ok: false, reason: 'render-failed' });
    expect(w.log.slice(-1)).toEqual(['check']);
    expect(w.read<Quality>('quality.json')).toMatchObject({ stopped: 'render-failed', detail: expect.stringMatching(/text_box_overflow.*the hook leaves its box/) });
    expect(existsSync(w.file('final.mp4'))).toBe(false);
  });

  it('a RenderError of the check or of the render stops the variant with render-failed, and onRender tells the step it failed in', async () => {
    const checked = world('layering-01', { check: new RenderError('hyperframes lint exited 2') });
    const refused = await checked.go();
    expect(refused).toEqual({ ok: false, reason: 'render-failed', detail: 'hyperframes lint exited 2' });
    expect(checked.log).not.toContain('onRender');
    const rendered = world('layering-01', { render: new RenderError('hyperframes render exited 1') });
    expect(await rendered.go()).toEqual({ ok: false, reason: 'render-failed', detail: 'hyperframes render exited 1' });
    expect(rendered.log.slice(-2)).toEqual(['onRender', 'render']);
    expect(rendered.read<Quality>('quality.json').detail).toMatch(/hyperframes render exited 1/);
  });

  it('a quality error on the render stops the variant with render-failed and removes final.mp4', async () => {
    const w = world('layering-01', { black: [{ at: 100, for: 12 }] });
    expect(await w.go()).toMatchObject({ ok: false, reason: 'render-failed' });
    expect(w.log.slice(-1)).toEqual(['render']);                          // no poster
    expect(existsSync(w.file('final.mp4'))).toBe(false);
    expect(existsSync(w.file('poster.jpg'))).toBe(false);
    expect(w.read<Quality>('quality.json')).toMatchObject({ stopped: 'render-failed', issues: [{ code: 'black-frames', severity: 'error', target: 's3' }] });
  });

  it('a quality warning on the render is kept, and the video is delivered', async () => {
    const w = world('layering-01', { loudness: { integrated: -20, truePeak: -6, range: 5 } });
    expect((await w.go()).ok).toBe(true);
    expect(existsSync(w.file('final.mp4'))).toBe(true);
    expect(w.read<Quality>('quality.json')).toMatchObject({ stopped: null, issues: [{ code: 'too-quiet', severity: 'warning' }] });
  });

  it('the output check is given the sources: black that is in the clip itself is a warning, not a render fault', async () => {
    const w = world('layering-01', { black: [{ at: 100, for: 12 }] });
    const black = w.deps.measure.black.bind(w.deps.measure);
    const s3 = () => realpathSync(normalizeCalls(w)[2]!.to);             // the normalised clip of shot s3
    w.deps.measure.black = async (file) => (realpathSync(file) === s3() ? [{ at: 0, for: 38 }] : black(file));
    expect((await w.go()).ok).toBe(true);
    expect(w.read<Quality>('quality.json').issues.map((issue) => issue.code)).toContain('dark-footage');
  });
});

describe('assemble, a beats template whose shots 2 and 3 continue the clip of shot 1', () => {
  // goldenWithParts: s1 (39 frames), s2 (48) and s3 (38) show the 5 s clip of s1 (150 frames); s4 and s5 own their clips
  it('one clip per shot that owns one is normalised; the parts show it from where they lie, and the checks of the video find nothing', async () => {
    const w = world('layering-01', { golden: goldenWithParts() });
    expect(await w.go()).toEqual({ ok: true, video: `${w.variant.dir}/final.mp4`, image: `${w.variant.dir}/poster.jpg` });
    expect(w.log).toEqual(['normalize s1', 'normalize s4', 'normalize s5', 'check', 'onRender', 'render', 'still']);
    const timeline = w.read<Timeline>('timeline.json');
    // 150 − 125 = 25 frames unused: gaps of 13 and 12; s3 ends on the clip's last frame (112 + 38 = 150)
    expect(timeline.shots.map((shot) => [shot.id, shot.at, shot.for, shot.from])).toEqual([['s1', 0, 39, 0], ['s2', 39, 48, 52], ['s3', 87, 38, 112], ['s4', 125, 45, 0], ['s5', 170, 70, 0]]);
    expect(new Set(timeline.shots.slice(0, 3).map((shot) => shot.media)).size).toBe(1);
    expect(Object.keys(w.read<Edit>('edit.json').media).filter((key) => key.startsWith('clip-'))).toEqual(['clip-s1', 'clip-s4', 'clip-s5']);
    expect(w.read<Quality>('quality.json').issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
  it('a clip shorter than its parts together stops the variant with the owner\'s clip at fault; one that just holds them is used', async () => {
    const short = world('layering-01', { golden: goldenWithParts(), frames: { s1: 124 } });
    expect(await short.go()).toMatchObject({ ok: false, reason: 'clips-failed', faulty: [{ kind: 'clip', id: 's1' }] });
    expect(short.read<Quality>('quality.json').detail).toBe('the clip of shot "s1" is shorter than its parts: the shots "s1", "s2", "s3" show 125 frames of it (with the next shot\'s transition), the clip has 124');
    const exact = world('layering-01', { golden: goldenWithParts(), frames: { s1: 125 } });
    expect(await exact.go()).toMatchObject({ ok: true });
    expect(exact.read<Timeline>('timeline.json').shots.slice(0, 3).map((shot) => shot.from)).toEqual([0, 39, 87]);
  });
  it('a generated still of a beats template is not read: the video never shows it, so it cannot stop the variant', async () => {
    const w = world('layering-01', { golden: goldenWithStill(), probe: { 'image-lead.png': new MediaError('not-media', 'not a picture') } });
    expect(await w.go()).toMatchObject({ ok: true });
    expect(w.media.calls.filter((call) => call.kind === 'probe' && basename(call.file) === 'image-lead.png')).toEqual([]);
  });
});

describe('assemble, a speech template', () => {
  it('takes time from the clips: one shot per segment, end to end, with the script as captions', async () => {
    const w = world('lashly-01');
    expect(await w.go()).toEqual({ ok: true, video: `${w.variant.dir}/final.mp4`, image: `${w.variant.dir}/poster.jpg` });
    expect(w.log).toEqual(['normalize s1', 'normalize s2', 'normalize s3', 'words', 'words', 'words', 'check', 'onRender', 'render', 'still']);

    // the clips come by segment id and keep their sound
    const calls = normalizeCalls(w);
    expect(calls.map((call) => call.file)).toEqual(['trial', 'formula', 'verdict'].map((segment) => abs(w.variant.clips[segment]!)));
    expect(calls.every((call) => call.target.audio)).toBe(true);
    // the recogniser hears the normalised clips, in the fill's language
    expect(w.transcriber.calls).toEqual(calls.map((call) => ({ media: call.to, language: 'en' })));

    const timeline = w.read<Timeline>('timeline.json');
    expect(timeline.shots.map((shot) => [shot.id, shot.at, shot.for])).toEqual([['s1', 0, 360], ['s2', 360, 270], ['s3', 630, 270]]);
    expect(timeline.frames).toBe(900);
    const shown = timeline.captions.flatMap((group) => group.words.map((word) => word.text));
    expect(shown.slice(0, 4)).toEqual(['I', 'tried', 'the', 'lash']);     // the script's words, not what was heard
    expect(shown.at(-1)).toBe('sign.');

    // the customer's photographs and the stills are in the composition, with their real sizes given to compose
    expect(realpathSync(w.file('assets/product-1-1.png'))).toBe(realpathSync(abs(w.fill.products[0]!.images[0]!)));
    expect(realpathSync(w.file('assets/still-proof-before.png'))).toBe(realpathSync(abs(w.variant.images['proof-before']!)));
    expect(existsSync(w.file('assets/image-presenter.png'))).toBe(false); // the presenter still is only the clips' input
    expect(timeline.cards.map((card) => card.media)).toEqual(expect.arrayContaining(['product-1', 'product-1-2', 'product-1-3']));

    const quality = w.read<Quality>('quality.json');
    expect(quality.stopped).toBeNull();
    expect(quality.speech.map((clip) => [clip.segment, clip.share, clip.times])).toEqual([['trial', 1, 'recogniser'], ['formula', 1, 'recogniser'], ['verdict', 1, 'recogniser']]);
  });

  it('a shot is as long as its clip came out, not as long as it was asked for', async () => {
    const w = world('lashly-01', { frames: { s2: 250 }, heard: { formula: evenly(golden('lashly-01').fill.script!.formula!, 250 / FPS) } });
    expect((await w.go()).ok).toBe(true);
    const timeline = w.read<Timeline>('timeline.json');
    expect(timeline.shots.map((shot) => [shot.at, shot.for])).toEqual([[0, 360], [360, 250], [610, 270]]);
    expect(timeline.frames).toBe(880);
  });

  it('a speaker clip whose words do not match its lines stops the variant with clips-failed', async () => {
    const other = evenly('Today we are talking about something else entirely, my new skin care routine for the winter months.', 9);
    const w = world('lashly-01', { heard: { formula: other } });
    expect(await w.go()).toMatchObject({ ok: false, reason: 'clips-failed' });
    expect(w.renderer.calls).toEqual([]);
    const quality = w.read<Quality>('quality.json');
    expect(quality.stopped).toBe('clips-failed');
    expect(quality.detail).toMatch(/formula/);
    expect(quality.speech.find((clip) => clip.segment === 'formula')!.share).toBeLessThan(0.5);
  });

  it('a talking clip without sound stops the variant with clips-failed, and the recogniser is not asked about it', async () => {
    const w = world('lashly-01', { sound: { s3: false } });
    expect(await w.go()).toMatchObject({ ok: false, reason: 'clips-failed' });
    expect(w.read<Quality>('quality.json').detail).toMatch(/s3.*no sound/);
    expect(w.transcriber.calls.length).toBe(2);                           // the two clips that have sound
  });

  it('music shorter than the talking is looped', async () => {
    const w = world('lashly-01', { musicSeconds: 20 });
    expect((await w.go()).ok).toBe(true);
    expect(w.read<Edit>('edit.json').audio?.music?.loop).toBe(true);
  });

  describe('with an aligner', () => {
    /** Places every word a tenth of a second after where the recogniser heard it; `scores` by clip in order (an Error rejects). */
    function alignerOf(w: () => World, scores: (number | Error)[], ready: { ready: boolean; note: string | null } = { ready: true, note: null }) {
      let running = 0;
      const fake = {
        most: 0, calls: [] as { media: string; words: string[]; language: string }[],
        async ready() { return ready; },
        async align(media: string, words: string[], language: string): Promise<AlignedWord[]> {
          const n = fake.calls.push({ media, words, language }) - 1;
          fake.most = Math.max(fake.most, ++running);
          await new Promise<void>((resolve) => setImmediate(resolve));
          running--;
          const score = scores[n]!;
          if (score instanceof Error) throw score;
          const shot = w().template.shots[n]!;
          return evenly(w().fill.script![shot.segment!]!, shot.clip_seconds!, 0.1).map((word, i) => ({ ...word, text: words[i]!, score }));
        },
      };
      return fake;
    }
    const firstWordAt = (w: World) => w.read<Timeline>('timeline.json').captions.flatMap((group) => group.words)[1]!.at;

    it('good scores: the captions take the aligner\'s times, one clip at a time, and quality.json says so', async () => {
      const plain = world('lashly-01');
      await plain.go();
      let w!: World;
      const aligner = alignerOf(() => w, [0.95, 0.93, 0.96]);
      w = world('lashly-01', { aligner });
      expect((await w.go()).ok).toBe(true);
      expect(aligner.most).toBe(1);
      expect(aligner.calls.map((call) => call.media)).toEqual(normalizeCalls(w).map((call) => call.to));
      expect(aligner.calls[1]!.words.slice(0, 4)).toEqual(['It\'s', 'the', 'Lashly', 'serum']);
      expect(aligner.calls.every((call) => call.language === 'en')).toBe(true);
      expect(firstWordAt(w)).toBe(firstWordAt(plain) + 3);                // a tenth of a second later
      expect(w.read<Quality>('quality.json').speech.map((clip) => clip.times)).toEqual(['aligner', 'aligner', 'aligner']);
    });

    it('low scores and a rejection keep the recogniser\'s times for that clip and never stop the variant', async () => {
      const plain = world('lashly-01');                                  // first: a world takes the data folder for itself
      await plain.go();
      let w!: World;
      const aligner = alignerOf(() => w, [0.4, new Error('align.py exited 1'), 0.95]);
      w = world('lashly-01', { aligner });
      expect((await w.go()).ok).toBe(true);
      expect(firstWordAt(w)).toBe(firstWordAt(plain));
      const speech = w.read<Quality>('quality.json').speech;
      expect(speech.map((clip) => clip.times)).toEqual(['recogniser', 'recogniser', 'aligner']);
      expect(speech[0]!.why).toMatch(/0\.40/);
      expect(speech[1]!.why).toMatch(/align\.py exited 1/);
    });

    it('a pause stays a pause: the word before 2 s of silence keeps a short length, and its caption group ends near it', async () => {
      // the first segment (38 words): four words a second, each 0.2 s long by the aligner, and 2 s of silence after the tenth
      const aligner: Aligner = {
        async ready() { return { ready: true, note: null }; },
        async align(_media, words) {
          if (words.length !== 38) throw new Error('only the first clip is aligned here');
          return words.map((text, i) => { const start = 0.3 + i * 0.25 + (i >= 10 ? 2 : 0); return { text, start, end: start + 0.2, score: 0.95 }; });
        },
      };
      const w = world('lashly-01', { aligner });
      expect((await w.go()).ok).toBe(true);
      expect(w.read<Quality>('quality.json').speech.map((clip) => clip.times)).toEqual(['aligner', 'recogniser', 'recogniser']);
      // the word itself, in the edit document: from 2.55 s for its own sound and a little more, not the 67 frames up to the next word
      expect(w.read<Edit>('edit.json').captions!.words.slice(8, 11).map((word) => [word.text, word.at, word.for])).toEqual([['me', 69, 8], ['about', 77, 10], ['for', 144, 8]]);
      // its caption group, in the frame table: the pause ends the group, at most the hold (12 frames) after its last word, and nothing is on screen through the silence
      const groups = w.read<Timeline>('timeline.json').captions;
      const g = groups.findIndex((group) => group.words.some((word) => word.index === 9));
      const group = groups[g]!, next = groups[g + 1]!;
      expect(group.words.at(-1)!.index).toBe(9);
      expect(group.at + group.for).toBeLessThanOrEqual(77 + 10 + 12);
      expect(next.at).toBe(144);                                          // 4.8 s: the eleventh word, after the silence
    });

    it('not ready: the aligner is never called', async () => {
      let w!: World;
      const aligner = alignerOf(() => w, [], { ready: false, note: 'no Python environment' });
      w = world('lashly-01', { aligner });
      expect((await w.go()).ok).toBe(true);
      expect(aligner.calls).toEqual([]);
      expect(w.read<Quality>('quality.json').speech.every((clip) => clip.times === 'recogniser' && /not ready/.test(clip.why))).toBe(true);
    });

    it('a beats template never asks it', async () => {
      let asked = 0;
      const aligner: Aligner = { async ready() { asked++; return { ready: true, note: null }; }, async align() { throw new Error('not for beats'); } };
      const w = world('layering-01', { aligner });
      expect((await w.go()).ok).toBe(true);
      expect(asked).toBe(0);
    });
  });
});

/** Video and picture files in the variant's folder itself, dot files included: after a failed attempt there is none. */
const leftovers = (w: World) => readdirSync(w.file('')).filter((name) => /\.(mp4|jpg)$/.test(name));

describe('assemble never throws: a tool that fails stops this variant with engine-error', () => {
  const none = () => {};
  const cases: [string, 'layering-01' | 'lashly-01', Options, (w: World) => void, string][] = [
    ['media.normalize, any error', 'layering-01', { normalize: { s2: new Error('spawn ffmpeg ENOENT') } }, none, 'spawn ffmpeg ENOENT'],
    ['media.normalize, the tool failed', 'layering-01', { normalize: { s2: new MediaError('tool-failed', 'ffmpeg exited 1') } }, none, 'ffmpeg exited 1'],
    ['media.probe of a photograph', 'lashly-01', { probe: { 'tube-closed.png': new MediaError('tool-failed', 'ffprobe exited 1') } }, none, 'ffprobe exited 1'],
    ['transcriber.words', 'lashly-01', {}, (w) => { w.transcriber.words = async () => { throw new Error('whisper timed out'); }; }, 'whisper timed out'],
    ['measure.streams of the music', 'layering-01', {}, (w) => { w.deps.measure.streams = async () => { throw new Error('ffprobe is gone'); }; }, 'ffprobe is gone'],
    ['measure.black inside the input check', 'layering-01', {}, (w) => { w.deps.measure.black = async () => { throw new Error('blackdetect failed'); }; }, 'blackdetect failed'],
    ['renderer.check, any error', 'layering-01', { check: new Error('chrome did not start') }, none, 'chrome did not start'],
    ['renderer.render, any error', 'layering-01', { render: new Error('the render child died') }, none, 'the render child died'],
    ['measure.black inside the output check', 'layering-01', {}, (w) => { w.deps.measure.black = async (file) => { if (dirname(file) === w.file('')) throw new Error('blackdetect failed on the render'); return []; }; }, 'blackdetect failed on the render'],
    ['measure.picture inside the output check', 'layering-01', {}, (w) => { w.deps.measure.picture = async () => { throw new Error('no such frame'); }; }, 'no such frame'],
    ['media.still', 'layering-01', {}, (w) => { w.media.still = async () => { throw new Error('no frame at 0.5 s'); }; }, 'no frame at 0.5 s'],
    ['the write of quality.json', 'layering-01', {}, (w) => { mkdirSync(w.file('quality.json'), { recursive: true }); }, 'quality.json'],
    ['the handler\'s onRender', 'layering-01', {}, (w) => { w.deps.onRender = () => { throw new Error('the board is gone'); }; }, 'the board is gone'],
  ];
  it.each(cases)('%s', async (port, id, options, breakIt, message) => {
    const w = world(id, options);
    breakIt(w);
    const out = await w.go();                                             // it comes back; nothing is thrown
    expect(out).toMatchObject({ ok: false, reason: 'engine-error', detail: expect.stringContaining(message) });
    expect(out).not.toHaveProperty('faulty');                             // no paid file is at fault
    expect(leftovers(w)).toEqual([]);
    if (port !== 'the write of quality.json') expect(w.read<Quality>('quality.json')).toMatchObject({ stopped: 'engine-error', detail: expect.stringContaining(message) });
  });

  it('the detail is one line', async () => {
    const w = world('layering-01', { render: new RenderError('hyperframes render exited 1\n  at frame 12\n  chrome crashed') });
    const out = await w.go();
    expect(out).toMatchObject({ ok: false, detail: 'hyperframes render exited 1 at frame 12 chrome crashed' });
  });

  it('a quality.json that cannot be written does not hide why the variant stopped', async () => {
    const w = world('layering-01', { frames: { s5: 69 } });
    mkdirSync(w.file('quality.json'), { recursive: true });
    const out = await w.go();
    expect(out).toMatchObject({ ok: false, reason: 'clips-failed', faulty: [{ kind: 'clip', id: 's5' }] });
    expect(out).toMatchObject({ detail: expect.stringMatching(/s5.*70.*69.*quality\.json could not be written/) });
  });
});

describe('no stale and no half result', () => {
  const earlier = (w: World) => { put(`${w.variant.dir}/final.mp4`, 'an earlier attempt'); put(`${w.variant.dir}/poster.jpg`, 'an earlier poster'); };
  const stops: [string, Options, string][] = [
    ['a clip that is too short', { frames: { s5: 69 } }, 'clips-failed'],
    ['an error of the input check', { streams: { 'clip-s3.mp4': { fps: 25 } } }, 'render-failed'],
    ['an issue of the renderer\'s check', { check: { ok: false, issues: [{ code: 'text_box_overflow', message: 'the hook leaves its box', target: 'hook', second: 0.5 }] } }, 'render-failed'],
    ['a renderer that fails without touching its file', { render: new RenderError('hyperframes render exited 1') }, 'render-failed'],
    ['an error of the output check', { black: [{ at: 100, for: 12 }] }, 'render-failed'],
  ];
  it.each(stops)('an earlier attempt\'s video and poster are gone when this attempt stops at %s', async (_what, options, reason) => {
    const w = world('layering-01', options);
    earlier(w);
    expect(await w.go()).toMatchObject({ ok: false, reason });
    expect(leftovers(w)).toEqual([]);
  });

  it('a paid video is rendered with the repeat check, a template\'s sample video is rendered once', async () => {
    const asked = async (sample: boolean): Promise<unknown> => {
      const w = world('layering-01');
      if (w.run.input.kind === 'produce') w.run.input.sample = sample;
      const render = w.renderer.render.bind(w.renderer);
      let call: unknown = 'not rendered';
      w.renderer.render = (dir, to, onProgress, options) => { call = options; return render(dir, to, onProgress); };
      expect((await w.go()).ok).toBe(true);
      return call;
    };
    expect(await asked(false)).toEqual({ verifyRepeat: true });
    expect(await asked(true)).toEqual({ verifyRepeat: false });
  });

  it('a picture that differs in every render stops the variant with render-failed, and no video is left', async () => {
    const w = world('layering-01', { render: new RenderError('render-picture-unstable') });
    expect(await w.go()).toMatchObject({ ok: false, reason: 'render-failed', detail: 'render-picture-unstable' });
    expect(leftovers(w)).toEqual([]);
  });

  it('the earlier files are gone as soon as the attempt begins: a worker killed in the middle leaves none', async () => {
    const w = world('layering-01');
    earlier(w);
    const seen: string[][] = [];
    const normalize = w.media.normalize.bind(w.media);
    w.media.normalize = (file, to, target) => { seen.push(leftovers(w)); return normalize(file, to, target); };
    expect((await w.go()).ok).toBe(true);
    expect(seen[0]).toEqual([]);
  });

  it('an attempt that succeeds replaces the earlier files', async () => {
    const w = world('layering-01');
    earlier(w);
    expect((await w.go()).ok).toBe(true);
    expect(readFileSync(w.file('final.mp4'), 'utf8')).toBe('a rendered video');
    expect(readFileSync(w.file('poster.jpg'), 'utf8')).toBe('fake media');
    expect(leftovers(w).sort()).toEqual(['final.mp4', 'poster.jpg']);
  });

  it('a renderer that wrote half a file and failed leaves nothing', async () => {
    for (const [error, reason] of [[new RenderError('hyperframes render exited 1'), 'render-failed'], [new Error('the render child died'), 'engine-error']] as const) {
      const w = world('layering-01');
      w.renderer.render = async (_dir, to) => { writeFileSync(to, 'half a video'); throw error; };
      expect(await w.go()).toMatchObject({ ok: false, reason });
      expect(leftovers(w)).toEqual([]);
    }
  });

  it('a video whose check could not be run is not left where a finished one lies', async () => {
    const w = world('layering-01');
    w.deps.measure.black = async (file) => { if (dirname(file) === w.file('')) throw new Error('blackdetect failed'); return []; };
    expect(await w.go()).toMatchObject({ ok: false, reason: 'engine-error' });
    expect(w.log.slice(-1)).toEqual(['render']);
    expect(leftovers(w)).toEqual([]);
  });

  it('a poster that cannot be made: the checked video is not delivered and not left', async () => {
    const w = world('layering-01');
    w.media.still = async () => { throw new Error('no frame'); };
    expect(await w.go()).toMatchObject({ ok: false, reason: 'engine-error' });
    expect(leftovers(w)).toEqual([]);
  });

  it('the video is called final.mp4 only after its check has passed', async () => {
    const w = world('layering-01');
    const seen: boolean[] = [];
    const black = w.deps.measure.black.bind(w.deps.measure);
    w.deps.measure.black = async (file) => { if (dirname(file) === w.file('')) seen.push(existsSync(w.file('final.mp4'))); return black(file); };
    expect((await w.go()).ok).toBe(true);
    expect(seen).toEqual([false]);                                        // the output check read the video under another name
    expect(existsSync(w.file('final.mp4'))).toBe(true);
  });
});

describe('a fault of a paid file is named, so that exactly that file can be made again', () => {
  it('a clip shorter than its shot', async () => {
    expect(await world('layering-01', { frames: { s5: 69 } }).go()).toEqual({ ok: false, reason: 'clips-failed', detail: expect.stringMatching(/s5.*70.*69/), faulty: [{ kind: 'clip', id: 's5' }] });
    expect(await world('layering-01', { frames: { s4: 52 } }).go()).toMatchObject({ reason: 'clips-failed', faulty: [{ kind: 'clip', id: 's4' }] });
  });

  it('a clip of 0 frames: clips-failed, by shot id in beats and by segment id in speech', async () => {
    const beats = world('layering-01', { frames: { s2: 0 } });
    expect(await beats.go()).toMatchObject({ ok: false, reason: 'clips-failed', faulty: [{ kind: 'clip', id: 's2' }] });
    expect(beats.renderer.calls).toEqual([]);
    const speech = world('lashly-01', { frames: { s2: 0 } });
    expect(await speech.go()).toMatchObject({ ok: false, reason: 'clips-failed', faulty: [{ kind: 'clip', id: 'formula' }] });
    expect(speech.transcriber.calls.length).toBe(2);                      // the other two clips are still looked at
    expect(speech.renderer.calls).toEqual([]);
  });

  it('a paid clip that is not a video', async () => {
    const w = world('layering-01', { normalize: { s2: new MediaError('not-media', 'not a media file') } });
    expect(await w.go()).toMatchObject({ ok: false, reason: 'clips-failed', faulty: [{ kind: 'clip', id: 's2' }] });
  });

  it('a talking clip too short for its words', async () => {
    const w = world('lashly-01', { frames: { s2: 10 } });                // 22 words, one frame each at least
    expect(await w.go()).toMatchObject({ ok: false, reason: 'clips-failed', detail: expect.stringMatching(/formula.*10 frames.*22 words/), faulty: [{ kind: 'clip', id: 'formula' }] });
    expect(w.renderer.calls).toEqual([]);
  });

  it('a talking clip that does not speak its lines, and one without sound', async () => {
    const other = evenly('Today we are talking about something else entirely, my new skin care routine for the winter months.', 9);
    expect(await world('lashly-01', { heard: { formula: other } }).go()).toMatchObject({ ok: false, reason: 'clips-failed', faulty: [{ kind: 'clip', id: 'formula' }] });
    expect(await world('lashly-01', { sound: { s3: false } }).go()).toMatchObject({ ok: false, reason: 'clips-failed', faulty: [{ kind: 'clip', id: 'verdict' }] });
  });

  const music: [string, Options][] = [
    ['of 29 frames, too short to loop', { musicSeconds: 29 / 30 }],
    ['of 6 frames', { musicSeconds: 0.2 }],
    ['whose length is not a number', { streams: { 'music.mp3': { seconds: Number('N/A') } } }],
    ['of no length', { streams: { 'music.mp3': { seconds: 0 } } }],
    ['of a negative length', { streams: { 'music.mp3': { seconds: -1 } } }],
    ['without a sound stream', { streams: { 'music.mp3': { sound: null } } }],
    ['that cannot be read', { unreadable: ['music.mp3'] }],
  ];
  it.each(music)('music %s: audio-failed', async (_what, options) => {
    const w = world('layering-01', options);
    const out = await w.go();
    expect(out).toEqual({ ok: false, reason: 'audio-failed', detail: expect.stringContaining('music'), faulty: [{ kind: 'music' }] });
    expect(w.renderer.calls).toEqual([]);
  });

  const SILENT: Loudness = { integrated: -70, truePeak: -70, range: 0 };
  it('music that is silent: audio-failed before any render, with the music to make again', async () => {
    for (const loudness of [SILENT, { ...SILENT, integrated: Number.NEGATIVE_INFINITY }]) {
      const w = world('layering-01', { loud: { 'music.mp3': loudness } });
      expect(await w.go()).toEqual({ ok: false, reason: 'audio-failed', detail: expect.stringMatching(/music is silent.*-60/), faulty: [{ kind: 'music' }] });
      expect(w.renderer.calls).toEqual([]);
    }
    // at the limit itself it is not silent (the limit is the quality checks' own)
    expect(SILENT_LUFS).toBe(-60);
    expect((await world('layering-01', { loud: { 'music.mp3': { ...SILENT, integrated: SILENT_LUFS } } }).go()).ok).toBe(true);
  });

  it('a loudness that is NaN is not a measurement: audio-failed, never read as sound', async () => {
    const w = world('layering-01', { loud: { 'music.mp3': { ...SILENT, integrated: Number.NaN } } });
    expect(await w.go()).toEqual({ ok: false, reason: 'audio-failed', detail: expect.stringMatching(/music has no loudness that can be read/), faulty: [{ kind: 'music' }] });
    expect(w.renderer.calls).toEqual([]);
  });

  it('a voice sample that is silent: audio-failed, with the voice to make again', async () => {
    const w = world('lashly-01', { loud: { 'voice.mp3': SILENT } });
    expect(await w.go()).toMatchObject({ ok: false, reason: 'audio-failed', detail: expect.stringMatching(/voice is silent/), faulty: [{ kind: 'voice' }] });
    expect(w.renderer.calls).toEqual([]);
  });

  describe('a paid file that has vanished is not paid for again: engine-error, and no file to make again', () => {
    const vanished: [string, 'layering-01' | 'lashly-01', Options][] = [
      ['a clip', 'layering-01', { normalize: { s2: new MediaError('not-found', 'no such file: clip-s2.mp4') } }],
      ['the music', 'layering-01', { gone: ['music.mp3'] }],
      ['the voice sample', 'lashly-01', { gone: ['voice.mp3'] }],
      ['a generated still', 'lashly-01', { probe: { 'image-proof-before.png': new MediaError('not-found', 'no such file: image-proof-before.png') } }],
    ];
    it.each(vanished)('%s', async (_what, id, options) => {
      const w = world(id, options);
      const out = await w.go();
      expect(out).toMatchObject({ ok: false, reason: 'engine-error', detail: expect.stringContaining('no such file') });
      expect(out).not.toHaveProperty('faulty');
      expect(w.renderer.calls).toEqual([]);
    });
  });

  describe('every paid file at fault is named in one pass, so that one resume replaces them all', () => {
    it('three clips of a beats video: not a video, without frames, too short', async () => {
      const w = world('layering-01', { normalize: { s2: new MediaError('not-media', 'not a media file') }, frames: { s4: 0, s5: 69 } });
      const out = await w.go();
      expect(out).toMatchObject({ ok: false, reason: 'clips-failed', faulty: [{ kind: 'clip', id: 's2' }, { kind: 'clip', id: 's4' }, { kind: 'clip', id: 's5' }] });
      expect(out).toMatchObject({ detail: expect.stringMatching(/s2.*not a media file \(and 2 more paid files at fault\)$/) });
      expect(normalizeCalls(w).length).toBe(5);                           // every clip was looked at
    });

    it('two talking clips: one without sound, one that speaks other lines', async () => {
      const other = evenly('Today we are talking about something else entirely, my new skin care routine for the winter months.', 9);
      const w = world('lashly-01', { sound: { s1: false }, heard: { verdict: other } });
      expect(await w.go()).toMatchObject({ ok: false, reason: 'clips-failed', faulty: [{ kind: 'clip', id: 'trial' }, { kind: 'clip', id: 'verdict' }] });
      expect(w.transcriber.calls.length).toBe(2);
    });

    it('files of different kinds: the reason is the first one\'s, all are named', async () => {
      const other = evenly('Today we are talking about something else entirely, my new skin care routine for the winter months.', 9);
      const w = world('lashly-01', {
        unreadable: ['voice.mp3'], heard: { formula: other }, loud: { 'music.mp3': SILENT },
        probe: { 'image-proof-after.png': new MediaError('not-media', 'not a media file') },
      });
      expect(await w.go()).toMatchObject({
        ok: false, reason: 'audio-failed',
        faulty: [{ kind: 'voice' }, { kind: 'clip', id: 'formula' }, { kind: 'music' }, { kind: 'image', id: 'proof-after' }],
        detail: expect.stringMatching(/voice.*\(and 3 more paid files at fault\)$/),
      });
      expect(w.renderer.calls).toEqual([]);
    });

    it('a tool that fails on the way still stops at once, with no file named', async () => {
      const w = world('layering-01', { normalize: { s2: new MediaError('not-media', 'not a media file'), s3: new MediaError('tool-failed', 'ffmpeg exited 1') } });
      const out = await w.go();
      expect(out).toMatchObject({ ok: false, reason: 'engine-error', detail: 'ffmpeg exited 1' });
      expect(out).not.toHaveProperty('faulty');
    });
  });

  it('music of 30 frames is enough: it loops', async () => {
    const w = world('layering-01', { musicSeconds: 1 });
    expect((await w.go()).ok).toBe(true);
    expect(w.read<Edit>('edit.json').audio?.music?.loop).toBe(true);
  });

  it.each([['that cannot be read', { unreadable: ['voice.mp3'] }], ['whose length is not a number', { streams: { 'voice.mp3': { seconds: Number.NaN } } }]] as [string, Options][])(
    'a voice sample %s: audio-failed', async (_what, options) => {
      const w = world('lashly-01', options);
      expect(await w.go()).toEqual({ ok: false, reason: 'audio-failed', detail: expect.stringContaining('voice'), faulty: [{ kind: 'voice' }] });
      expect(w.renderer.calls).toEqual([]);
    });

  it('a generated still that cannot be read: images-failed, with the still to make again', async () => {
    const w = world('lashly-01', { probe: { 'image-proof-before.png': new MediaError('not-media', 'not a media file') } });
    expect(await w.go()).toEqual({ ok: false, reason: 'images-failed', detail: expect.stringMatching(/proof-before.*not a media file/), faulty: [{ kind: 'image', id: 'proof-before' }] });
    expect(w.renderer.calls).toEqual([]);
  });

  it('a customer\'s photograph that cannot be read: images-failed, and no paid file to make again', async () => {
    const w = world('lashly-01', { probe: { 'tube-closed.png': new MediaError('not-media', 'not a media file') } });
    const out = await w.go();
    expect(out).toMatchObject({ ok: false, reason: 'images-failed', detail: expect.stringMatching(/product-1.*not a media file/) });
    expect(out).not.toHaveProperty('faulty');
  });

  describe('what the editor refuses about the document stays render-failed, with the first issue as detail and no file at fault', () => {
    it('resolve refuses it', async () => {
      const w = world('lashly-01');
      w.variant.fill.script!.formula = 'It\'s the Lashly serum from ACME. Aloe, shea, jojoba, and you just swipe it on your lash line every night, like eyeliner.';   // its marks are gone
      const out = await w.go();
      expect(out).toMatchObject({ ok: false, reason: 'render-failed', detail: expect.stringMatching(/^[a-z-]+: .*(name|inside|routine)/) });
      expect(out).not.toHaveProperty('faulty');
      expect(w.renderer.calls).toEqual([]);
    });

    it('compose refuses it', async () => {
      const w = world('layering-01');
      vi.mocked(compose).mockImplementationOnce(() => {
        throw new ComposeError([
          { code: 'text-fit', path: 'texts[0]', message: 'the hook does not fit its box', fix: 'shorten it' },
          { code: 'text-fit', path: 'texts[1]', message: 'the name does not fit its box', fix: 'shorten it' },
        ]);
      });
      const out = await w.go();
      expect(out).toEqual({ ok: false, reason: 'render-failed', detail: 'text-fit: the hook does not fit its box (and 1 more)' });
      expect(w.renderer.calls).toEqual([]);
      expect(existsSync(w.file('index.html'))).toBe(false);
    });

    it('the input check, the renderer\'s check and the output check refuse it', async () => {
      const input = await world('layering-01', { streams: { 'clip-s3.mp4': { fps: 25 } } }).go();
      expect(input).toMatchObject({ ok: false, reason: 'render-failed', detail: expect.stringMatching(/^media-fps: /) });
      const check = await world('layering-01', { check: { ok: false, issues: [{ code: 'text_box_overflow', message: 'the hook leaves its box', target: 'hook', second: 0.5 }] } }).go();
      expect(check).toEqual({ ok: false, reason: 'render-failed', detail: 'text_box_overflow: the hook leaves its box' });
      const output = await world('layering-01', { black: [{ at: 100, for: 12 }] }).go();
      expect(output).toMatchObject({ ok: false, reason: 'render-failed', detail: expect.stringMatching(/^black-frames: /) });
      for (const out of [input, check, output]) expect(out).not.toHaveProperty('faulty');
    });
  });
});

describe('what compose is given', () => {
  it('the real size of every picture, the frames of every clip and of the music', async () => {
    const w = world('lashly-01', { probe: { 'tube-open-applicator.png': { width: 2000, height: 500, fps: 25, frames: 1, seconds: 0.04, audio: false } } });
    vi.mocked(compose).mockClear();
    expect((await w.go()).ok).toBe(true);
    expect(vi.mocked(compose).mock.calls.length).toBe(1);
    const [edit, facts] = vi.mocked(compose).mock.calls[0]!;
    expect(Object.entries(edit.media).filter(([, entry]) => entry.kind === 'image').map(([key]) => key).sort())
      .toEqual(['product-1', 'product-1-2', 'product-1-3', 'still-proof-after', 'still-proof-before']);
    expect(facts).toEqual({
      'clip-s1': { frames: 360, audio: true, width: 720, height: 1280 },
      'clip-s2': { frames: 270, audio: true, width: 720, height: 1280 },
      'clip-s3': { frames: 270, audio: true, width: 720, height: 1280 },
      music: { frames: 900, audio: true },
      'product-1': { frames: 1, audio: false, width: 1024, height: 1024 },
      'product-1-2': { frames: 1, audio: false, width: 2000, height: 500 },
      'product-1-3': { frames: 1, audio: false, width: 1024, height: 1024 },
      'still-proof-before': { frames: 1, audio: false, width: 720, height: 1280 },
      'still-proof-after': { frames: 1, audio: false, width: 720, height: 1280 },
    });
  });
});

describe('assemble, a worker that lost the run while it rendered (F8b)', () => {
  it('its render never replaces the new owner\'s video, and it leaves no temporary file behind', async () => {
    const w = world('layering-01');
    const late = w.run;                                                         // claimed by 'worker-test'
    const folder = join(dirname(w.file('x')), '');
    const render = w.renderer.render.bind(w.renderer);
    let second: Assembled | null = null;
    let owned: Buffer | null = null;
    let first = true;
    w.renderer.check = async () => ({ ok: true, issues: [] });
    w.media.still = async (_file, _second, to) => { writeFileSync(to, 'a poster'); };
    w.renderer.render = async (dir, to, onProgress) => {
      if (!first) { writeFileSync(to, 'the new owner\'s render'); return facts!; }
      first = false;
      facts = await render(dir, to, onProgress);                               // the late worker's render is done ...
      // ... but meanwhile the run was taken over, and the new worker made the whole variant
      w.deps.db.prepare("UPDATE runs SET claimed_by = 'worker-2' WHERE id = ?").run(late.id);
      second = await assemble(w.deps, { ...late, claimedBy: 'worker-2' }, w.template, w.variant);
      owned = readFileSync(w.file('final.mp4'));
      return facts;
    };
    let facts: MediaFacts | null = null;
    const result = await assemble(w.deps, late, w.template, w.variant);
    expect(second, JSON.stringify(second)).toMatchObject({ ok: true });
    expect(result).toMatchObject({ ok: false, reason: 'engine-error' });
    expect(result.ok ? '' : result.detail).toMatch(/another worker holds this run/);
    expect(readFileSync(w.file('final.mp4')).equals(owned!)).toBe(true);        // the new owner's video, as it was
    expect(existsSync(w.file('poster.jpg'))).toBe(true);
    expect(readdirSync(folder).filter((name) => name.includes('.part'))).toEqual([]);
    const kept = JSON.parse(readFileSync(w.file('quality.json'), 'utf8'));
    expect(kept.stopped).toBeNull();                                            // the new owner's quality.json, not the late worker's
  });

  it('a worker that no longer holds the run at the start touches nothing', async () => {
    const w = world('layering-01');
    w.deps.db.prepare("UPDATE runs SET claimed_by = 'worker-2' WHERE id = ?").run(w.run.id);
    mkdirSync(dirname(w.file('final.mp4')), { recursive: true });
    writeFileSync(w.file('final.mp4'), 'the new owner\'s video');
    const result = await assemble(w.deps, w.run, w.template, w.variant);
    expect(result).toMatchObject({ ok: false });
    expect(readFileSync(w.file('final.mp4'), 'utf8')).toBe('the new owner\'s video');
    expect(w.log).not.toContain('render');
  });
});

describe('assemble, a worker that stalls and loses the run in the middle of the build (I2)', () => {
  const takeOver = (w: World) => w.deps.db.prepare("UPDATE runs SET claimed_by = 'worker-2' WHERE id = ?").run(w.run.id);

  it('characterizes the open shared-clip race: a late normalizer changes the new owner composition input after publication', async () => {
    const w = world('layering-01');
    const normalize = w.media.normalize.bind(w.media);
    let first = true;
    let published: Buffer | undefined;
    let acceptedClip: Buffer | undefined;
    let second: Assembled | undefined;
    w.media.normalize = async (file, to, target) => {
      if (!first) return normalize(file, to, target);
      first = false;
      // Simulate an already-started decoder returning after takeover and a complete replacement build.
      takeOver(w);
      second = await assemble(w.deps, { ...w.run, claimedBy: 'worker-2' }, w.template, w.variant);
      published = readFileSync(w.file('final.mp4'));
      acceptedClip = readFileSync(w.file('assets/clip-s1.mp4'));
      const facts = await normalize(file, to, target);
      writeFileSync(to, 'obsolete decoder output');
      return facts;
    };
    const obsolete = await w.go();
    expect(second, JSON.stringify(second)).toMatchObject({ ok: true });
    expect(obsolete).toMatchObject({ ok: false, reason: 'engine-error' });
    expect(readFileSync(w.file('final.mp4'))).toEqual(published);
    expect(JSON.parse(readFileSync(w.file('quality.json'), 'utf8')).stopped).toBeNull();
    // This is evidence of the remaining vulnerability, not a claim that custody is fixed.
    const currentInput = readFileSync(w.file('assets/clip-s1.mp4'));
    expect(currentInput.equals(acceptedClip!)).toBe(false);
    expect(currentInput.toString()).toBe('obsolete decoder output');
  });

  it('taken over while it normalises a clip: it writes no edit.json, no composition, starts no check and no render', async () => {
    const w = world('layering-01');
    const normalize = w.media.normalize.bind(w.media);
    w.media.normalize = async (...args) => { takeOver(w); return normalize(...args); };
    const result = await assemble(w.deps, w.run, w.template, w.variant);
    expect(result).toMatchObject({ ok: false, reason: 'engine-error' });
    expect(result.ok ? '' : result.detail).toMatch(/another worker holds this run/);
    expect(existsSync(w.file('edit.json'))).toBe(false);
    expect(existsSync(w.file('index.html'))).toBe(false);
    expect(existsSync(w.file('assets'))).toBe(false);
    expect(w.log).not.toContain('check');
    expect(w.log).not.toContain('render');
    expect(existsSync(w.file('quality.json'))).toBe(false);                      // the new owner's file to write
  });

  it('taken over while the renderer checks the composition: no render is started', async () => {
    const w = world('layering-01');
    const check = w.renderer.check.bind(w.renderer);
    w.renderer.check = async (dir) => { takeOver(w); return check(dir); };
    const result = await assemble(w.deps, w.run, w.template, w.variant);
    expect(result).toMatchObject({ ok: false, reason: 'engine-error' });
    expect(w.log).not.toContain('render');
    expect(existsSync(w.file('final.mp4'))).toBe(false);
  });
});

describe('assemble, leftovers of a worker that died mid-render (M2)', () => {
  it('removes old render.part-<worker> / poster.part-<worker> files of other workers, and nothing else', async () => {
    const w = world('layering-01');
    const old = new Date(w.deps.clock.now().getTime() - 2 * 3600_000);
    mkdirSync(w.file(''), { recursive: true });
    const put = (name: string, when: Date | null) => { writeFileSync(w.file(name), name); if (when) utimesSync(w.file(name), when, when); };
    put('render.part-worker-dead.mp4', old);
    put('poster.part-worker-dead.jpg', old);
    put('render.part-worker-live.mp4', new Date(w.deps.clock.now().getTime() - 60_000));   // a live worker's render: young
    put('notes.mp4', old);                                                                   // not of the pattern
    expect(await w.go()).toMatchObject({ ok: true });
    const left = readdirSync(w.file(''));
    expect(left).not.toContain('render.part-worker-dead.mp4');
    expect(left).not.toContain('poster.part-worker-dead.jpg');
    expect(left).toContain('render.part-worker-live.mp4');
    expect(left).toContain('notes.mp4');
  });
});
