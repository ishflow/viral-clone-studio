// The 'hardware' encode path (task C3). The HyperFrames CLI encodes the delivered picture with its hardware encoder
// (h264_videotoolbox: no libx264 stage, the measured bottleneck), and ONE ffmpeg pass of ours copies that picture,
// completes its colour tags and sets the loudness. The picture is encoded once; our pass never decodes it.
// Here: the arguments of both sides, the probe that says whether the hardware encoder works, and the check of the
// delivered file that does not decode it. No state.
import { RenderError } from '../ports.ts';
import type { MediaFacts } from '../ports.ts';
import { ExecError, runProcess } from './exec.ts';

/** Who encodes the delivered picture. 'cli': libx264 CRF 16 inside the HyperFrames CLI (the software path).
 *  'hardware': h264_videotoolbox inside the CLI at DELIVERY_BPP. */
export type EncodePath = 'cli' | 'hardware';
export const HARDWARE_ENCODER = 'h264_videotoolbox';

/**
 * Bits per pixel and frame of the delivered picture on the hardware path: 0.29 is 18 Mbit/s at 1080×1920×30 and
 * 8 Mbit/s at 720×1280×30. Measured on the animated 30 s 1080×1920 test against a lossless reference
 * (docs/research/2026-10-04-viraleditor-speed-2.md): at 18 Mbit/s the average PSNR and SSIM equal libx264 CRF 16
 * (48.66 dB against 48.71); the CLI's own default for `--gpu` (0.16, 10 Mbit/s) is 1.8 dB under it.
 */
export const DELIVERY_BPP = 0.29;

export interface PictureShape { width: number; height: number; fps: number }

/** Whole megabits per second for a picture at `bpp` bits per pixel and frame; never under 1. */
export function megabits(shape: PictureShape, bpp: number): number {
  return Math.max(1, Math.round((shape.width * shape.height * shape.fps * bpp) / 1e6));
}

/** What `hyperframes render` gets on top of its usual arguments, per path. */
export function cliEncodeArgs(path: EncodePath, shape: PictureShape): string[] {
  return path === 'hardware' ? ['--gpu', '--video-bitrate', `${megabits(shape, DELIVERY_BPP)}M`] : [];
}

/** The CLI's hardware encoder writes the BT.709 matrix into the stream but neither the primaries nor the transfer: 1 is BT.709 in all three. */
const BT709_TAGS = 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1';

/**
 * The sound filter of a loudness pass, for both encode paths: `volume`, then (when `limit` is a dBTP ceiling) a peak limiter
 * with no level change of its own. The limiter works at 4 times the rate: at 48 kHz its sample peak holds, but the true
 * peak between the samples of a limited signal passes it by more than a dB.
 */
export function gainFilter(pass: { gain: number; limit: number | null }): string {
  const volume = `volume=${Number(pass.gain.toFixed(3))}dB`;
  return pass.limit === null ? volume : `${volume},aresample=192000,alimiter=limit=${Number((10 ** (pass.limit / 20)).toFixed(4))}:level=0,aresample=48000`;
}

/**
 * The one pass of the 'hardware' path: the first picture stream copied bit for bit with its colour tags completed
 * (BT.709), the first sound stream (when there is one) with the gain (and the limiter, when `limit` is given) as AAC at 48 kHz, or copied when `gain` is null.
 */
export function finalPassArgs(pass: { from: string; to: string; gain: number | null; limit?: number | null }): string[] {
  const sound = pass.gain === null
    ? ['-c:a', 'copy']
    : ['-af', gainFilter({ gain: pass.gain, limit: pass.limit ?? null }), '-c:a', 'aac', '-ar', '48000', '-b:a', '192k'];
  return ['-y', '-v', 'error', '-nostdin', '-i', pass.from, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-bsf:v', BT709_TAGS,
    ...sound, '-movflags', '+faststart', pass.to];
}

/**
 * Does the hardware encoder work on this machine with this ffmpeg? Encodes one small frame, without the software
 * stand-in (`-allow_sw` stays off). Returns null when it does, otherwise the reason in one line.
 */
export async function hardwareEncoderFault(ffmpeg: string, timeoutMs: number): Promise<string | null> {
  const args = ['-hide_banner', '-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=size=320x240:rate=1:duration=1',
    '-frames:v', '1', '-an', '-c:v', HARDWARE_ENCODER, '-f', 'null', '-'];
  try {
    const r = await runProcess(ffmpeg, args, { timeoutMs });
    if (r.code === 0) return null;
    const why = r.stderr.trim().split('\n').filter((line) => line.trim() !== '').at(-1) ?? '';
    return `${HARDWARE_ENCODER} does not work with ${ffmpeg} (exit ${r.code}${why === '' ? '' : `: ${why.slice(0, 200)}`})`;
  } catch (e) {
    return `${HARDWARE_ENCODER} could not be tried: ${e instanceof ExecError ? e.message : String(e)}`;
  }
}

/**
 * Size, rate, frame count, length and sound of a file as its container states them (ffprobe reads the header; no frame
 * is decoded, so it takes a tenth of a second where a decoding count takes 5 to 14 s for 900 frames at 1080×1920 on a
 * busy machine). Throws RenderError when ffprobe cannot read the file.
 */
export async function containerFacts(ffprobe: string, file: string, timeoutMs: number): Promise<MediaFacts> {
  let r;
  try {
    r = await runProcess(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,nb_frames:format=duration', '-of', 'json', file], { timeoutMs });
  } catch (e) { throw new RenderError(`cannot read the rendered file: ${e instanceof ExecError ? e.message : String(e)}`); }
  let info: { streams?: { codec_type?: string; width?: number; height?: number; r_frame_rate?: string; nb_frames?: string }[]; format?: { duration?: string } } | null = null;
  try { info = r.code === 0 ? JSON.parse(r.stdout) : null; } catch { /* not JSON: reported below */ }
  const video = info?.streams?.find((s) => s.codec_type === 'video');
  if (!info || !video) throw new RenderError(`cannot read the rendered file: ffprobe exited ${r.code}${r.stderr.trim() === '' ? '' : `: ${r.stderr.trim().slice(-300)}`}`);
  const [a, b] = (video.r_frame_rate ?? '0/1').split('/').map(Number);
  return {
    width: video.width ?? 0, height: video.height ?? 0,
    fps: b === undefined ? a ?? 0 : b === 0 ? 0 : a! / b,
    frames: Number(video.nb_frames ?? 0),
    seconds: Number(info.format?.duration ?? 0),
    audio: info.streams!.some((s) => s.codec_type === 'audio'),
  };
}
