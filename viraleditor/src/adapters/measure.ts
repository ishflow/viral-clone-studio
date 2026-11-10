import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FrameRange, Loudness, Measure, Picture, StreamFacts } from '../ports.ts';
import { ExecError, runProcess } from './exec.ts';
import { onlyLocalInputs } from './protocols.ts';
import { MediaError, photoTurn, shownSize } from './media.ts';

/** r_frame_rate and avg_frame_rate may differ by this share and still be one constant rate. */
const RATE_TOLERANCE = 0.01;
const TIMEOUT_MS = 10 * 60_000;
/** ebur128 prints -120.7 where it has nothing to measure. */
const MOMENTARY_SILENCE = -120;
/** blackdetect: a pixel is black below this share of the luma range (0.05 = luma 27 of 16-235; 0.1 called a dark night shot black); a frame is black when BLACK_PICTURE of its pixels is. */
const BLACK_PIXEL = 0.05;
const BLACK_PICTURE = 0.98;
/** freezedetect: the mean difference to the previous frame, in dB, under which two frames count as the same.
 *  The mean is over the whole frame, so a flat background with a small moving area (a talking head) passes -60 dB as moving and fails -50 dB as frozen (measured: a 40x20 noise box moving for 90 frames: whole clip "frozen" at -50, nothing at -60).
 *  Known limit: a freeze re-encoded at crf 14 ultrafast over noisy footage is seen about 7 frames late (20 reads as 13) and may come back in pieces. At crf 14, 23 and 30 medium, holds of 10, 13 and 21 frames read at their full length. The run length is what the detector says; nothing is added and runs are never joined (joining would count the gap as frozen). */
const FROZEN_NOISE_DB = -60;
/** Runs shorter than this are not reported as frozen (a held beat of a few frames is normal). */
const FROZEN_MIN_FRAMES = 4;
/** What ffprobe / ffmpeg print on stderr (at -v error) when a file is damaged although the exit code is 0. */
const DAMAGE = /invalid|error|partial file|missing|truncat|corrupt|damaged|not found/i;

/** ffmpeg or ffprobe itself is missing or cannot start: nothing about any file can be learned. */
export class ToolUnavailable extends MediaError {
  bin: string;
  constructor(bin: string, message: string) { super('tool-failed', message); this.name = 'ToolUnavailable'; this.bin = bin; }
}

function fraction(text: string | undefined): number {
  const [a, b] = (text ?? '0/1').split('/').map(Number);
  return b === undefined ? a! : b === 0 ? 0 : a! / b;
}
const tag = (value: string | undefined): string | null => (value === undefined || value === 'unknown' ? null : value);
/** ffmpeg prints '-inf' for silence; Number('-inf') is NaN. */
function db(text: string): number {
  return /inf/i.test(text) ? (text.trim().startsWith('-') ? -Infinity : Infinity) : Number(text);
}

interface RawStream {
  codec_type?: string; codec_name?: string; pix_fmt?: string; width?: number; height?: number; r_frame_rate?: string; nb_read_frames?: string;
  color_space?: string; color_transfer?: string; color_primaries?: string; sample_rate?: string; channels?: number;
  avg_frame_rate?: string; start_time?: string; side_data_list?: { rotation?: number }[];
}

/** ffmpeg / ffprobe measurements for the quality checks. `ffmpeg` and `ffprobe` are paths to the binaries. All ranges are frames at the file's own rate. */
export function createMeasure(ffmpeg: string, ffprobe: string): Measure {
  async function tool(bin: string, args: string[]) {
    try {
      return await runProcess(bin, onlyLocalInputs(bin === ffprobe ? 'ffprobe' : 'ffmpeg', args), { timeoutMs: TIMEOUT_MS, isolatedHome: true });
    } catch (e) {
      if (e instanceof ExecError) throw e.code === 'spawn-failed' ? new ToolUnavailable(bin, e.message) : new MediaError('tool-failed', e.message);
      throw e;
    }
  }
  function exists(file: string): void {
    if (!existsSync(file)) throw new MediaError('not-found', `no such file: ${file}`);
  }
  /** ffmpeg decoding `file` through `-af/-vf` into the null muxer; returns stderr at `info` level (`verbose`: the per-frame log of ebur128). */
  async function scan(file: string, filter: ['-vf' | '-af', string], what: string, level: 'info' | 'verbose' = 'info'): Promise<string> {
    exists(file);
    const r = await tool(ffmpeg, ['-hide_banner', '-nostats', '-nostdin', '-v', level, '-i', file, ...filter, '-f', 'null', '-']);
    if (r.code !== 0) {
      if (DAMAGE.test(r.stderr)) throw new MediaError('not-media', `${what}: cannot decode ${file}`);
      throw new MediaError('tool-failed', `ffmpeg exited ${r.code}: ${r.stderr.trim().slice(-500)}`);
    }
    return r.stderr;
  }

  async function probeFile(file: string): Promise<{ facts: StreamFacts; offset: number }> {
    exists(file);
    const r = await tool(ffprobe, ['-v', 'error', '-count_frames', '-show_entries',
      'stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate,avg_frame_rate,start_time,nb_read_frames,color_space,color_transfer,color_primaries,sample_rate,channels:stream_side_data=rotation:format=duration,start_time',
      '-of', 'json', resolve(file)]);           // the full path: a relative name that starts with a dash would be read as an option
    if (r.code !== 0 || (r.stderr.trim() !== '' && DAMAGE.test(r.stderr))) {
      if (r.code === 0 || /Invalid data found|moov atom not found|could not find codec|does not contain any stream/i.test(r.stderr)) throw new MediaError('not-media', `not a readable media file: ${file}`);
      throw new MediaError('tool-failed', `ffprobe exited ${r.code}: ${r.stderr.trim().slice(-500)}`);
    }
    let info: { streams?: RawStream[]; format?: { duration?: string; start_time?: string } };
    try { info = JSON.parse(r.stdout); } catch { throw new MediaError('tool-failed', 'ffprobe printed no JSON'); }
    const video = info.streams?.find((s) => s.codec_type === 'video');
    const audio = info.streams?.find((s) => s.codec_type === 'audio');
    if (!video && !audio) throw new MediaError('not-media', `no video or sound stream in ${file}`);
    // keyframes: the packets flagged K, numbered in the order the file stores them (presentation order for the clips made here)
    let keyframes: number[] = [];
    if (video) {
      const p = await tool(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', resolve(file)]);
      if (p.code !== 0) throw new MediaError('tool-failed', `ffprobe exited ${p.code}: ${p.stderr.trim().slice(-500)}`);
      const rows = p.stdout.trim().split('\n').filter((l) => l !== '').map((l) => {
        const [time, flags] = l.split(',');
        return { time: Number(time), key: (flags ?? '').startsWith('K') };
      });
      rows.sort((a, b) => a.time - b.time);
      keyframes = rows.map((row, i) => (row.key ? i : -1)).filter((i) => i >= 0);
    }
    const fps = fraction(video?.r_frame_rate);
    const avg = fraction(video?.avg_frame_rate);
    // seconds between the start of the file and the first picture: filters see timestamps counted from the file's start
    const offset = video ? Math.max(0, Number(video.start_time ?? 0) - Number(info.format?.start_time ?? 0)) : 0;
    const facts: StreamFacts = {
      ...(video ? shownSize(video, await photoTurn(video, file, async (args) => (await tool(ffprobe, args)).stdout)) : { width: 0, height: 0 }),   // as shown: a clip turned by rotation metadata, a photo turned by its EXIF orientation, is decoded turned
      fps,
      frames: Number(video?.nb_read_frames ?? 0),
      seconds: Number(info.format?.duration ?? 0),
      audio: audio !== undefined,
      codec: video?.codec_name ?? audio?.codec_name ?? '',
      pixelFormat: video?.pix_fmt ?? '',
      colour: { space: tag(video?.color_space), transfer: tag(video?.color_transfer), primaries: tag(video?.color_primaries) },
      keyframes,
      sound: audio ? { codec: audio.codec_name ?? '', sampleRate: Number(audio.sample_rate ?? 0), channels: audio.channels ?? 0 } : null,
      constantRate: !video || (fps > 0 && Math.abs(avg - fps) / fps <= RATE_TOLERANCE),
    };
    return { facts, offset };
  }

  /** One full probe per file (it decodes the whole file to count frames): kept for as long as the file is unchanged. */
  const probed = new Map<string, { stamp: string; result: Promise<{ facts: StreamFacts; offset: number }> }>();
  function probe(file: string) {
    exists(file);
    const st = statSync(file);
    const stamp = `${st.size}:${st.mtimeMs}`;
    const known = probed.get(file);
    if (known && known.stamp === stamp) return known.result;
    const result = probeFile(file);
    probed.set(file, { stamp, result });
    result.catch(() => { if (probed.get(file)?.result === result) probed.delete(file); });
    return result;
  }
  const streams = async (file: string): Promise<StreamFacts> => (await probe(file)).facts;

  /** Width and height only, without decoding the file (what `picture` needs). */
  async function size(file: string): Promise<{ width: number; height: number }> {
    exists(file);
    const known = probed.get(file);
    if (known) { const f = (await known.result.catch(() => null))?.facts; if (f && f.width > 0) return f; }
    const r = await tool(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height:stream_side_data=rotation', '-of', 'json', resolve(file)]);
    let stream: RawStream | undefined;
    try { stream = (JSON.parse(r.stdout) as { streams?: RawStream[] }).streams?.[0]; } catch { stream = undefined; }
    const shown = stream ? shownSize(stream, await photoTurn(stream, file, async (args) => (await tool(ffprobe, args)).stdout)) : { width: 0, height: 0 };
    if (r.code !== 0 || !shown.width || !shown.height) throw new MediaError('not-media', `no readable video stream in ${file}`);
    return shown;
  }

  async function picturedStreams(file: string): Promise<StreamFacts & { offset: number }> {
    const { facts, offset } = await probe(file);
    if (facts.fps <= 0) throw new MediaError('not-media', `no video stream in ${file}`);
    return { ...facts, offset };
  }

  return {
    streams,

    async black(file) {
      const { fps, frames, offset } = await picturedStreams(file);
      // tpad adds one copy of the last frame, so that a run reaching the last frame is closed by a frame of its own (without it black_end is the last frame's time and the run loses a frame)
      const log = await scan(file, ['-vf', `tpad=stop=1:stop_mode=clone,blackdetect=d=0:pix_th=${BLACK_PIXEL}:pic_th=${BLACK_PICTURE}`], 'black');
      const runs: FrameRange[] = [];
      for (const m of log.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)) {
        const at = Math.round((Number(m[1]) - offset) * fps);
        const end = Math.min(frames, Math.round((Number(m[2]) - offset) * fps));
        runs.push({ at, for: end - at });
      }
      return runs.filter((r) => r.for >= 1);
    },

    async frozen(file) {
      const { fps, frames, offset } = await picturedStreams(file);
      const minSeconds = FROZEN_MIN_FRAMES / fps;
      const log = await scan(file, ['-vf', `freezedetect=n=${FROZEN_NOISE_DB}dB:d=${minSeconds}`], 'frozen');
      const starts = [...log.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
      const lengths = [...log.matchAll(/freeze_duration: ([\d.]+)/g)].map((m) => Number(m[1]));
      // a freeze that lasts to the last frame is never closed: ffmpeg prints its start and nothing more
      // freeze_start is the timestamp of the last frame that still differed: the identical frames start one frame later
      const runs: FrameRange[] = starts.map((start, i) => {
        const at = Math.round((start - offset) * fps) + 1;
        return { at, for: lengths[i] === undefined ? frames - at : Math.round(lengths[i]! * fps) };
      });
      return runs;
    },

    async loudness(file): Promise<Loudness | null> {
      const facts = await streams(file);
      if (!facts.sound) return null;
      const log = await scan(file, ['-af', 'ebur128=peak=true:framelog=quiet'], 'loudness');
      const summary = log.slice(log.lastIndexOf('Summary:'));
      const integrated = /I:\s+(-?[\d.]+|-?inf) LUFS/.exec(summary);
      const range = /LRA:\s+(-?[\d.]+|-?inf) LU/.exec(summary);
      const peak = /Peak:\s+(-?[\d.]+|-?inf) dBFS/.exec(summary);
      if (!integrated || !range || !peak) throw new MediaError('tool-failed', `ebur128 printed no summary for ${file}`);
      return { integrated: db(integrated[1]!), truePeak: db(peak[1]!), range: db(range[1]!) };
    },

    async momentary(file): Promise<number[]> {
      const facts = await streams(file);
      if (!facts.sound) return [];
      const log = await scan(file, ['-af', 'ebur128=framelog=verbose'], 'momentary loudness', 'verbose');
      const values: number[] = [];
      for (const line of log.split('\n')) {
        const m = /\bt:\s*[\d.]+.*?\bM:\s*(-?[\d.]+|-?inf)/.exec(line);
        if (m) values.push(db(m[1]!) <= MOMENTARY_SILENCE ? -Infinity : db(m[1]!));
      }
      return values;
    },

    async picture(file, frame): Promise<Picture> {
      if (!Number.isInteger(frame) || frame < 0) throw new MediaError('tool-failed', `not a frame number: ${frame}`);
      const facts = await size(file);
      const dir = mkdtempSync(join(tmpdir(), 've-measure-'));
      const raw = join(dir, 'frame.rgb');
      try {
        // `select` by frame number: the n-th decoded frame, not the one near a rounded second
        const r = await tool(ffmpeg, ['-y', '-v', 'error', '-nostdin', '-i', file, '-vf', `select=eq(n\\,${frame})`, '-fps_mode', 'passthrough',
          '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
        if (r.code !== 0) throw new MediaError('tool-failed', `ffmpeg exited ${r.code}: ${r.stderr.trim().slice(-500)}`);
        const bytes = existsSync(raw) ? readFileSync(raw) : Buffer.alloc(0);
        if (bytes.length !== facts.width * facts.height * 3) throw new MediaError('tool-failed', `${file} has no frame ${frame}`);
        return { width: facts.width, height: facts.height, rgb: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
