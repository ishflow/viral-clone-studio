// Test support: small media files made with ffmpeg, good ones and deliberately bad ones. Used by the tests of the measurements and of the quality checks.
import { existsSync } from 'node:fs';
import { runProcess } from '../adapters/exec.ts';
import type { Timeline } from '../edit/timeline.ts';

export const FFMPEG = '/opt/homebrew/bin/ffmpeg';
export const FFPROBE = '/opt/homebrew/bin/ffprobe';
export const haveFfmpeg = existsSync(FFMPEG) && existsSync(FFPROBE);
/** The machine is shared and loaded: tests that run ffmpeg get this long. */
export const SLOW = 180_000;

export async function ff(args: string[]): Promise<void> {
  const r = await runProcess(FFMPEG, ['-y', '-v', 'error', '-nostdin', ...args], { timeoutMs: SLOW });
  if (r.code !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${r.stderr}`);
}

/** ffmpeg's `sine` source has an amplitude of 1/8: a peak at -18 dBFS. */
const SINE_PEAK_DB = 18;

/** A rectangle drawn in a flat colour on some frames: how these tests stand in for text (this ffmpeg has no drawtext). */
export interface Box { x: number; y: number; width: number; height: number; colour: string; from?: number; to?: number }
export interface VideoSpec {
  width?: number; height?: number; fps?: number; seconds?: number;
  background?: string;                          // flat colour under the noise; default dark grey
  source?: string;                              // a whole lavfi source instead of the flat colour with noise (it must give the size and rate itself)
  noise?: number;                               // temporal noise, so that every frame differs; default 20
  boxes?: Box[];                                // drawn on frames from … to (inclusive); default all
  freeze?: { first: number; last: number } | { first: number; last: number }[];    // frames first … last all show frame `first`
  crf?: number; preset?: string;                // encoder settings; default 14 ultrafast
  gop?: number;                                 // keyframe distance in frames; default: the rate (one a second)
  tagged?: boolean;                             // BT.709 colour tags; default true
  sound?: { db: number; frequency?: number } | null;    // a sine whose peak is at this dBFS before encoding; default none
  filter?: string;                              // appended to the video filter chain (after the boxes)
}

/** A clip of noise on a flat colour (every frame differs), with optional boxes, a frozen stretch, tags and a sine. */
export async function makeVideo(file: string, spec: VideoSpec = {}): Promise<void> {
  const { width = 270, height = 480, fps = 30, seconds = 3 } = spec;
  const source = spec.source ?? `color=c=${spec.background ?? '#303030'}:s=${width}x${height}:r=${fps}:d=${seconds},noise=alls=${spec.noise ?? 20}:allf=t`;
  const chain: string[] = [];
  for (const b of spec.boxes ?? []) {
    const enable = b.from === undefined && b.to === undefined ? '' : `:enable='between(n,${b.from ?? 0},${b.to ?? 1e9})'`;
    chain.push(`drawbox=x=${b.x}:y=${b.y}:w=${b.width}:h=${b.height}:color=${b.colour}:t=fill${enable}`);
  }
  [spec.freeze ?? []].flat().forEach((z, i) => chain.push(`split[a${i}][b${i}];[a${i}][b${i}]freezeframes=first=${z.first}:last=${z.last}:replace=${z.first}`));
  if (spec.filter) chain.push(spec.filter);
  // -colorspace / -color_primaries / -color_trc on the encoder write only the matrix into the file: the tags must travel on the frames
  if (spec.tagged !== false) chain.push('setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709');
  const sound = spec.sound ?? null;
  await ff([
    '-f', 'lavfi', '-i', source,
    ...(sound ? ['-f', 'lavfi', '-i', `sine=frequency=${sound.frequency ?? 440}:sample_rate=48000:duration=${seconds}`, '-af', `volume=${sound.db + SINE_PEAK_DB}dB`] : []),
    ...(chain.length ? ['-vf', chain.join(',')] : []),
    '-c:v', 'libx264', '-preset', spec.preset ?? 'ultrafast', '-crf', String(spec.crf ?? 14), '-g', String(spec.gop ?? fps), '-keyint_min', String(spec.gop ?? fps), '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
    ...(sound ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
    '-movflags', '+faststart', file,
  ]);
}

/** A still picture. */
export async function makeImage(file: string, width: number, height: number): Promise<void> {
  await ff(['-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}`, '-frames:v', '1', file]);
}

/** A sound file: a sine whose peak is at `db` dBFS before encoding, or silence. Extension picks the container (.mp3 / .wav). */
export async function makeSound(file: string, options: { seconds?: number; db?: number; silent?: boolean } = {}): Promise<void> {
  const seconds = options.seconds ?? 2;
  const input = options.silent ? `anullsrc=r=44100:cl=stereo:d=${seconds}` : `sine=frequency=440:sample_rate=44100:duration=${seconds}`;
  await ff(['-f', 'lavfi', '-i', input, ...(options.silent ? [] : ['-af', `volume=${(options.db ?? -12) + SINE_PEAK_DB}dB`]), file]);
}

/** A hand-written timeline for a 270x480, 30 fps, 90-frame render stand-in: one video shot that plays throughout, no sound, no text. Pass what differs. */
export function makeTimeline(over: Partial<Timeline> = {}): Timeline {
  return {
    fps: 30, frames: 90, width: 270, height: 480,
    shots: [{ id: 'main', element: 'shot-main', media: 'clip', kind: 'video', at: 0, for: 90, tail: 0, from: 0 }],
    transitions: [], windows: [], texts: [], captions: [], cards: [], audio: [], animations: [], master: null, checkAt: [],
    ...over,
  };
}

/** A clip of noise whose picture starts `offset` seconds after its sound (the sound starts at 0, the picture at `offset`), with black on frames from … to. */
export async function makeOffset(file: string, offset: number, black: { from: number; to: number }): Promise<void> {
  const picture = `color=c=#404040:s=270x480:r=30:d=3,noise=alls=20:allf=t,drawbox=enable='between(n,${black.from},${black.to})':x=0:y=0:w=270:h=480:color=black:t=fill`;
  await ff(['-itsoffset', String(offset), '-f', 'lavfi', '-i', picture, '-f', 'lavfi', '-i', 'sine=duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
}
/** A variable-rate clip: frames 30 … 60 of a 30 fps clip are dropped and the timestamps kept. */
export async function makeVariableRate(file: string): Promise<void> {
  await ff(['-f', 'lavfi', '-i', 'color=c=#404040:s=270x480:r=30:d=3,noise=alls=20:allf=t', '-vf', "select='not(between(n,30,60))'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast', file]);
}
