import { randomUUID } from 'node:crypto';
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import type { FaintCut, Media, MediaFacts } from '../ports.ts';
import { ExecError, runProcess } from './exec.ts';
import { onlyLocalInputs } from './protocols.ts';

export type MediaErrorCode = 'not-found' | 'not-media' | 'tool-failed' | 'bad-range';
export class MediaError extends Error {
  code: MediaErrorCode;
  constructor(code: MediaErrorCode, message: string) { super(message); this.name = 'MediaError'; this.code = code; }
}

const TIMEOUT_MS = 10 * 60_000;
/** A frame that differs this much from the one before it (ffmpeg's scene score, 0 to 1) starts a new shot. */
const CUT_SCORE = 0.3;
/** A change under CUT_SCORE is a faint cut from this score: over what a hand, a caption or an overlay moves a frame by, under the jump cuts that were measured (see faintCuts). */
const FAINT_SCORE_MIN = 0.12;
/** A faint cut stands alone: no other frame this near it (seconds, before or after) comes within this many times of its score. An effect comes as two changes or more, a cut as one. */
const FAINT_ALONE_SECONDS = 0.25;
const FAINT_ALONE_TIMES = 2.5;
/** Black bars leave the picture at least this much of the frame. When less of a video is ever lit, it is a dark video, and the little that is lit is not its picture. */
const PICTURE_SHARE_MIN = 0.5;
/** Black bars on two opposite sides only (the picture runs the whole width or the whole height of the frame) leave it this much at least: a wide video set in a tall frame is about a third of it. A lit window with black on all four sides is not held to this, only to PICTURE_SHARE_MIN. */
const STRIP_SHARE_MIN = 0.25;
/** A lit area is taken to run a whole side of the frame from this share of that side (cropdetect's even rounding leaves a pixel or two). */
const STRIP_SIDE_MIN = 0.98;
/** The area a video shows is the one lit in at least this share of its frames. With less (two areas about half of the time each, an area that keeps changing) it has none of its own. */
const SHOWN_FRAMES_MIN = 0.6;
/** Two edges this near each other (a share of that side of the frame) are the same edge: a soft border and compression move it by a few pixels from frame to frame. */
const SAME_EDGE_MAX = 0.02;

// ── the contact sheet ──
/** A tile is this wide at most (half of a 720-wide video: text of hook size stays readable), never wider than the video, and narrower when the grid has many columns. */
const TILE_WIDTH = 360;
const TILE_MIN_WIDTH = 120;
const SHEET_MAX_WIDTH = 1600;
/** The plain sheet (no labels, no gaps): tiles this wide, as before the labelled sheet existed. */
const PLAIN_TILE_WIDTH = 270;
/** The space around and between the tiles, in a grey that neither dark nor white footage runs into. */
export const SHEET_GAP = { margin: 12, padding: 12, colour: '0x808080' };

export interface SheetLayout {
  width: number; height: number;                       // of the whole sheet
  tile: { width: number; height: number };
  origin(tile: number): { x: number; y: number };      // the top left corner of a tile, counted in reading order from 0
}
/** Where the tiles of a sheet lie: what ffmpeg's `tile` filter makes of these numbers. */
export function sheetLayout(source: { width: number; height: number }, grid: { columns: number; rows: number }): SheetLayout {
  const { margin, padding } = SHEET_GAP;
  const even = (n: number): number => Math.max(2, 2 * Math.round(n / 2));
  const fits = Math.floor((SHEET_MAX_WIDTH - 2 * margin - (grid.columns - 1) * padding) / grid.columns);
  const width = even(Math.max(TILE_MIN_WIDTH, Math.min(TILE_WIDTH, source.width, fits)));
  const height = even((width * source.height) / source.width);
  return {
    width: 2 * margin + grid.columns * width + (grid.columns - 1) * padding,
    height: 2 * margin + grid.rows * height + (grid.rows - 1) * padding,
    tile: { width, height },
    origin: (tile) => ({ x: margin + (tile % grid.columns) * (width + padding), y: margin + Math.floor(tile / grid.columns) * (height + padding) }),
  };
}

/** The characters a label needs, 5 × 7 dots each (this ffmpeg build has no `drawtext`). */
const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  s: ['00000', '00000', '01111', '10000', '01110', '00001', '11110'],
};
const PLATE_ALPHA = 210;
/** The labels of a sheet as one transparent RGBA picture of its size: the second of every tile ("1.53s"), white on a dark plate, in the tile's top left corner. */
function sheetLabels(layout: SheetLayout, seconds: number[]): Uint8Array {
  const rgba = new Uint8Array(layout.width * layout.height * 4);
  const dot = layout.tile.width >= 240 ? 3 : 2;                    // pixels per dot of a glyph
  const pad = 2 * dot;
  const put = (x: number, y: number, value: number, alpha: number) => { const i = (y * layout.width + x) * 4; rgba[i] = value; rgba[i + 1] = value; rgba[i + 2] = value; rgba[i + 3] = alpha; };
  seconds.forEach((second, tile) => {
    const text = `${second.toFixed(2)}s`;
    const { x, y } = layout.origin(tile);
    const width = Math.min(layout.tile.width, 2 * pad + text.length * 6 * dot - dot);
    const height = Math.min(layout.tile.height, 2 * pad + 7 * dot);
    for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) put(x + xx, y + yy, 0, PLATE_ALPHA);
    [...text].forEach((char, k) => {
      (GLYPHS[char] ?? []).forEach((row, r) => [...row].forEach((on, q) => {
        if (on !== '1') return;
        for (let dy = 0; dy < dot; dy++) for (let dx = 0; dx < dot; dx++) {
          const xx = pad + (k * 6 + q) * dot + dx;
          const yy = pad + r * dot + dy;
          if (xx < width && yy < height) put(x + xx, y + yy, 255, 255);
        }
      }));
    });
  });
  return rgba;
}
/** An RGBA picture as a PNG file (8 bits a channel, no filter). */
function png(width: number, height: number, rgba: Uint8Array): Buffer {
  const line = width * 4 + 1;
  const rows = Buffer.alloc(line * height);                         // each row starts with its filter byte, 0
  for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * line + 1);
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;                                                       // bit depth
  head[9] = 6;                                                       // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** What ffprobe prints (at -v error) about a damaged file even when it exits 0, as measure.ts reads it. */
const DAMAGE = /invalid|error|partial file|missing|truncat|corrupt|damaged|not found/i;
/** Width and height as the picture is shown: a stream turned by 90° or 270° (a phone clip) swaps them; `frameTurn` is the turn a photo carries on its frame (photoTurn). */
export function shownSize(stream: { width?: number; height?: number; side_data_list?: { rotation?: number }[] }, frameTurn = 0): { width: number; height: number } {
  const rotation = stream.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ?? frameTurn;
  const turned = Math.abs(rotation) % 180 === 90;
  return { width: (turned ? stream.height : stream.width) ?? 0, height: (turned ? stream.width : stream.height) ?? 0 };
}

/** The codecs of pictures that can carry an EXIF orientation: ffmpeg decodes them turned, and ffprobe puts the turn on the frame, not on the stream. */
const PHOTO_CODECS = new Set(['mjpeg', 'png', 'webp', 'tiff']);
/**
 * The turn (degrees) that a photo's first frame carries, for `shownSize`; 0 for a clip, for a stream that has its own rotation, and when nothing is there.
 * `ask` runs ffprobe with these arguments and gives its stdout.
 */
export async function photoTurn(stream: { codec_name?: string; side_data_list?: { rotation?: number }[] }, file: string, ask: (args: string[]) => Promise<string>): Promise<number> {
  if (!PHOTO_CODECS.has(stream.codec_name ?? '') || stream.side_data_list?.some((d) => typeof d.rotation === 'number')) return 0;
  const out = await ask(['-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+#1', '-show_entries', 'frame_side_data=rotation', '-of', 'json', resolve(file)]);
  try {
    const frame = (JSON.parse(out) as { frames?: { side_data_list?: { rotation?: number }[] }[] }).frames?.[0];
    return frame?.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ?? 0;
  } catch { return 0; }
}

function fraction(text: string): number {
  const [a, b] = text.split('/').map(Number);
  return b === undefined ? a! : b === 0 ? 0 : a! / b;
}

/** A lit area of a frame, in pixels from its top left corner; `right` and `bottom` are the first ones past it. */
interface Area { left: number; top: number; right: number; bottom: number }
/** What is lit in any of these areas (one at least). */
const union = (areas: Area[]): Area => areas.reduce((all, area) => ({
  left: Math.min(all.left, area.left), top: Math.min(all.top, area.top), right: Math.max(all.right, area.right), bottom: Math.max(all.bottom, area.bottom),
}));
/**
 * The area most of a video shows, from the area lit in each of its frames: what is lit in the frames that agree with the usual place of every edge.
 * A part of the video that fills more of the frame (an opening pattern, an end card, a flash) is left out of it. null when too few frames agree (SHOWN_FRAMES_MIN).
 */
function shownArea(lit: Area[], frame: { width: number; height: number }): Area | null {
  const usual = (edge: keyof Area): number => lit.map((area) => area[edge]).sort((a, b) => a - b)[Math.floor(lit.length / 2)]!;
  const place: Area = { left: usual('left'), top: usual('top'), right: usual('right'), bottom: usual('bottom') };
  const near = (a: number, b: number, side: number): boolean => Math.abs(a - b) <= SAME_EDGE_MAX * side;
  const agree = lit.filter((area) => near(area.left, place.left, frame.width) && near(area.right, place.right, frame.width)
    && near(area.top, place.top, frame.height) && near(area.bottom, place.bottom, frame.height));
  return agree.length >= SHOWN_FRAMES_MIN * lit.length ? union(agree) : null;
}

/** A frame as `cuts` reads it: the second it starts at, how much it differs from the frame before it (ffmpeg's scene score), and whether ffmpeg took that for a cut. */
interface ScoredFrame { second: number; score: number; cut: boolean }
/**
 * The frames that are a faint cut: a jump cut on the same background, with the same person, moves less of the picture than CUT_SCORE asks for,
 * but it is one frame that stands out of the calm before and after it. Told apart from motion by its score, and from an effect by standing alone.
 */
function faintCuts(frames: ScoredFrame[], fps: number): FaintCut[] {
  const near = Math.round(FAINT_ALONE_SECONDS * fps);
  return frames
    .filter((frame, k) => !frame.cut && frame.score >= FAINT_SCORE_MIN
      && frames.slice(Math.max(0, k - near), k + near + 1).every((other) => other === frame || FAINT_ALONE_TIMES * other.score <= frame.score))
    .map(({ second, score }) => ({ second, score }));
}

/** A second as ffmpeg's command line takes it: a plain decimal to the millisecond, never `1e-7`. */
const plainSeconds = (value: number): string => value.toFixed(3);

/** ffmpeg / ffprobe adapter. `ffmpeg` and `ffprobe` are paths to the binaries. */
export function createMedia(ffmpeg: string, ffprobe: string): Media {
  async function tool(bin: string, args: string[]) {
    try {
      return await runProcess(bin, onlyLocalInputs(bin === ffprobe ? 'ffprobe' : 'ffmpeg', args), { timeoutMs: TIMEOUT_MS, isolatedHome: true });
    } catch (e) {
      if (e instanceof ExecError) throw new MediaError('tool-failed', e.message);
      throw e;
    }
  }
  /** Runs ffmpeg with the output at a temp name beside `to` and renames it over `to` only when ffmpeg succeeded and wrote a file. */
  async function ffmpegTo(to: string, args: string[], what: string): Promise<void> {
    const ext = extname(to);
    const tmp = join(dirname(to), `.${basename(to, ext)}.${randomUUID().slice(0, 8)}.tmp${ext}`);
    try {
      await ffmpegRun([...args, tmp]);
      if (!existsSync(tmp)) throw new MediaError('tool-failed', `ffmpeg wrote nothing: ${what}`);
      renameSync(tmp, to);
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  /** What ffmpeg printed. */
  async function ffmpegRun(args: string[]): Promise<string> {
    const r = await tool(ffmpeg, ['-y', '-v', 'error', '-nostdin', ...args]);
    if (r.code !== 0) throw new MediaError('tool-failed', `ffmpeg exited ${r.code}: ${r.stderr.trim().slice(-500)}`);
    return r.stdout;
  }

  type Streams = { codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; nb_read_frames?: string; side_data_list?: { rotation?: number }[] }[];

  /** What ffprobe says of the file, or the typed error for a missing, non-media or (with `count`) damaged one. `count` decodes every frame: seconds on a 4K clip. */
  async function readStreams(file: string, count: boolean): Promise<{ streams?: Streams; format?: { duration?: string } }> {
    if (!existsSync(file)) throw new MediaError('not-found', `no such file: ${file}`);
    // the full path: a relative name that starts with a dash would be read as an option
    const r = await tool(ffprobe, ['-v', 'error', ...(count ? ['-count_frames'] : []), '-show_entries',
      'stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_frames:stream_side_data=rotation:format=duration', '-of', 'json', resolve(file)]);
    // exit 0 with damage reported: frames are missing (a file cut short whose header promises the whole length)
    if (r.code !== 0 || (r.stderr.trim() !== '' && DAMAGE.test(r.stderr))) {
      if (r.code === 0 || /Invalid data found|moov atom not found|could not find codec|does not contain any stream/i.test(r.stderr)) throw new MediaError('not-media', `not a media file: ${file}`);
      throw new MediaError('tool-failed', `ffprobe exited ${r.code}: ${r.stderr.trim().slice(-500)}`);
    }
    let info: { streams?: Streams; format?: { duration?: string } };
    try { info = JSON.parse(r.stdout); } catch { throw new MediaError('tool-failed', 'ffprobe printed no JSON'); }
    const video = info.streams?.find((s) => s.codec_type === 'video');
    if (!video || !video.width || !video.height) throw new MediaError('not-media', `no video stream in ${file}`);
    return info;
  }

  async function probe(file: string): Promise<MediaFacts> {
    const info = await readStreams(file, true);
    const video = info.streams!.find((s) => s.codec_type === 'video')!;
    return {
      ...shownSize(video, await photoTurn(video, file, async (args) => (await tool(ffprobe, args)).stdout)),
      fps: fraction(video.r_frame_rate ?? '0/1'),
      frames: Number(video.nb_read_frames ?? 0),
      seconds: Number(info.format?.duration ?? 0),
      audio: info.streams!.some((s) => s.codec_type === 'audio'),
    };
  }

  /** The matrix the source's YUV should be read with: its tag, or a guess by size (HD is 709, SD is 601) when untagged; null = leave to ffmpeg. */
  async function inputMatrix(file: string): Promise<'bt709' | 'bt601' | null> {
    // the stored size, not the shown one: the encoder chose its matrix for the frame it encoded (a turned 640x480 clip is still SD)
    const r = await tool(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,color_space', '-of', 'json', resolve(file)]);
    let stream: { width?: number; height?: number; color_space?: string } | undefined;
    try { stream = r.code === 0 ? (JSON.parse(r.stdout) as { streams?: { width?: number; height?: number; color_space?: string }[] }).streams?.[0] : undefined; } catch { stream = undefined; }
    const tag = stream?.color_space ?? '';
    if (tag === 'bt709') return 'bt709';
    if (tag === 'smpte170m' || tag === 'bt470bg') return 'bt601';
    if (tag === '' || tag === 'unknown') return (stream?.width ?? 0) > 1024 || (stream?.height ?? 0) > 576 ? 'bt709' : 'bt601';
    return null;
  }

  /**
   * ffmpeg's `crop` (with the comma after it) to the picture of a video that has black bars around it: the score of a cut is taken in the picture,
   * since over a frame that is half bars a real cut scores half and is missed. '' when there are no bars, and when what is lit is no picture (see PICTURE_SHARE_MIN and STRIP_SHARE_MIN).
   * The picture is the area most of the video shows (shownArea): a few seconds that fill the whole frame do not hide the bars of the rest.
   */
  async function pictureCrop(file: string, frame: { width: number; height: number }): Promise<string> {
    // cropdetect, started again at every frame, prints the area lit in that frame alone. Even sides (4:2:0), not its multiples of 16
    const printed = await ffmpegRun(['-i', file, '-vf', 'cropdetect=round=2:reset=1,metadata=print:file=-', '-an', '-f', 'null', '-']);
    const lit = [...printed.matchAll(/cropdetect\.w=(-?\d+)\s+lavfi\.cropdetect\.h=(-?\d+)\s+lavfi\.cropdetect\.x=(-?\d+)\s+lavfi\.cropdetect\.y=(-?\d+)/g)]
      .map((match) => match.slice(1).map(Number) as [number, number, number, number])
      .filter(([w, h]) => w > 0 && h > 0)                           // nothing lit in a frame: both sides come out negative
      .map(([w, h, x, y]): Area => ({ left: x, top: y, right: x + w, bottom: y + h }));
    if (lit.length === 0) return '';
    const cropTo = ({ left, top, right, bottom }: Area): string => {
      const w = right - left;
      const h = bottom - top;
      const share = (w * h) / (frame.width * frame.height);
      const strip = w >= STRIP_SIDE_MIN * frame.width || h >= STRIP_SIDE_MIN * frame.height;   // bars on two opposite sides: a real edge runs a whole side, a patch of light in the dark does not
      return share >= 1 || share < (strip ? STRIP_SHARE_MIN : PICTURE_SHARE_MIN) ? '' : `crop=${w}:${h}:${left}:${top},`;
    };
    // the area most of the video shows; a video without one, or with one too small to be a picture, is measured, as a whole, in what is lit in any of its frames
    const shown = shownArea(lit, frame);
    return (shown && cropTo(shown)) || cropTo(union(lit));
  }

  return {
    probe,

    async normalize(file, to, target) {
      await probe(file); // a typed error for a missing or non-media input, before ffmpeg runs
      const { width: w, height: h, fps } = target;
      // read the source with its own matrix, convert to BT.709 limited range (accurate rounding), then tag
      const m = await inputMatrix(file);
      const inMatrix = m ? `in_color_matrix=${m}:` : '';
      const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase:${inMatrix}out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,crop=${w}:${h},setsar=1,fps=${fps},format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709`;
      await ffmpegTo(to, ['-i', file, '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', String(fps), '-keyint_min', String(fps), '-sc_threshold', '0',
        ...(target.audio ? ['-c:a', 'aac'] : ['-an']), '-movflags', '+faststart'], 'normalize');
      return probe(to);
    },

    async still(file, second, to) {
      await readStreams(file, false); // a typed error for a missing or non-media input; the frame count is not needed to take one frame
      await ffmpegTo(to, ['-ss', String(second), '-i', file, '-frames:v', '1', '-q:v', '2'], `no frame at ${second} s in ${file}`);
    },

    async sheet(file, to, grid) {
      const facts = await probe(file);
      const tiles = grid.columns * grid.rows;
      const step = facts.frames / tiles;
      const last = facts.frames - 1;
      // the frames at the seconds asked for, else the frame in the middle of each of `tiles` equal parts; picked by index, and the second reported is that frame's own
      const indexes = grid.at !== undefined
        ? grid.at.map((second) => Math.max(0, Math.min(last, Math.round(second * facts.fps))))
        : Array.from({ length: tiles }, (_, i) => Math.min(last, Math.floor((i + 0.5) * step)));
      // `select` takes a frame once, in the order of the video: a tile that is not later than the one before it would move every tile after it
      if (indexes.length > tiles || indexes.some((k, i) => i > 0 && k <= indexes[i - 1]!)) throw new MediaError('tool-failed', `a sheet of ${tiles} tiles takes at most ${tiles} frames, each later than the one before it`);
      const seconds = indexes.map((k) => k / facts.fps);
      const pick = indexes.map((k) => `eq(n\\,${k})`).join('+');
      if (grid.labels !== true) {                                  // the plain sheet: tiles side by side, nothing drawn on them
        const vf = `select='${pick}',scale=${PLAIN_TILE_WIDTH}:-2,tile=${grid.columns}x${grid.rows}`;
        await ffmpegTo(to, ['-i', file, '-vf', vf, '-fps_mode', 'passthrough', '-frames:v', '1', '-q:v', '3'], 'sheet');
        return { seconds };
      }
      // the tiles with a gap around each, and over them, in the same pass, the second of every tile in its corner
      const layout = sheetLayout(facts, grid);
      if (!existsSync(dirname(to))) throw new MediaError('tool-failed', `the folder for the sheet is not there: ${dirname(to)}`);
      const labels = join(dirname(to), `.${basename(to)}.${randomUUID().slice(0, 8)}.labels.png`);
      const graph = `[0:v]select='${pick}',scale=${layout.tile.width}:${layout.tile.height},tile=${grid.columns}x${grid.rows}:margin=${SHEET_GAP.margin}:padding=${SHEET_GAP.padding}:color=${SHEET_GAP.colour}[tiles];[tiles][1:v]overlay=0:0:format=rgb`;
      try {
        writeFileSync(labels, png(layout.width, layout.height, sheetLabels(layout, seconds)));
        await ffmpegTo(to, ['-i', file, '-i', labels, '-filter_complex', graph, '-fps_mode', 'passthrough', '-frames:v', '1', '-q:v', '3'], 'sheet');
      } finally {
        rmSync(labels, { force: true });
      }
      return { seconds };
    },

    async trim(file, from, to, out) {
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || from >= to) throw new MediaError('bad-range', `not a range of seconds: ${from} to ${to}`);
      const facts = await probe(file);
      if (to > facts.seconds) throw new MediaError('bad-range', `the range ends at ${to} s, the clip is ${facts.seconds} s long`);
      // re-encoded, not stream-copied: a copy starts at a keyframe and drifts by seconds
      await ffmpegTo(out, ['-i', file, '-ss', plainSeconds(from), '-to', plainSeconds(to), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        ...(facts.audio ? ['-c:a', 'aac'] : ['-an']), '-movflags', '+faststart'], 'trim');
      return probe(out);
    },

    async cuts(file) {
      const facts = await probe(file);
      // one run scores every frame: `select` sends the frames ffmpeg's scene score picks to its second output, where they are marked, and all the others
      // to its first. Both are printed, each frame with its second and its score, as it comes (`direct`: two printers on one pipe write whole lines).
      // The marked ones end in a sink, not in an output of their own: a video without a cut would fail there for want of a frame
      const graph = `[0:v]${await pictureCrop(file, facts)}select='1+gt(scene,${CUT_SCORE})':n=2[rest][cuts];`
        + '[cuts]metadata=mode=add:key=hard_cut:value=1,metadata=print:file=-:direct=1,nullsink;[rest]metadata=print:file=-:direct=1';
      const printed = await ffmpegRun(['-i', file, '-filter_complex', graph, '-an', '-f', 'null', '-']);
      const frames = printed.split(/^frame:/m).flatMap((block): ScoredFrame[] => {
        const second = /pts_time:([0-9.]+)/.exec(block);
        const score = /^lavfi\.scene_score=([0-9.]+)$/m.exec(block);
        return second ? [{ second: Number(second[1]), score: Number(score?.[1] ?? 0), cut: /^hard_cut=1$/m.test(block) }] : [];
      }).sort((a, b) => a.second - b.second);
      // the first frame has none before it and is never a cut
      return { seconds: frames.filter((frame) => frame.cut && frame.second > 0).map((frame) => frame.second), faint: faintCuts(frames, facts.fps) };
    },
  };
}
