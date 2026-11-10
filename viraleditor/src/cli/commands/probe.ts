import { existsSync } from 'node:fs';
import { MediaError } from '../../adapters/media.ts';
import type { StreamFacts } from '../../ports.ts';
import type { Context } from '../context.ts';
import type { Command } from '../framework.ts';
import { Stop, issue } from '../issue.ts';
import { isFolder, pathOf } from '../project.ts';

const LISTED = 100;
const finite = (n: number): number | null => (Number.isFinite(n) ? Number(n.toFixed(2)) : null);

/** The facts of a file through `measure.streams`; stops with `file-missing` or `media-unreadable`. */
export async function streamsOf(context: Context, file: string): Promise<StreamFacts> {
  if (!existsSync(file)) throw new Stop([issue('file-missing', { target: file }, `The file is not there: ${file}.`)]);
  try {
    return await context.tools.measure.streams(file);
  } catch (error) {
    if (error instanceof MediaError && error.code === 'not-media') throw new Stop([issue('media-unreadable', { target: file }, `${file} is not a video, image or sound file that ffprobe can read.`)]);
    throw error;
  }
}

/** The same for a command that needs a picture that moves: a sound file stops with `media-unreadable`. */
export async function videoOf(context: Context, file: string): Promise<StreamFacts> {
  const facts = await streamsOf(context, file);
  if (facts.width === 0) throw new Stop([issue('media-unreadable', { target: file }, `${file} holds sound only; this command needs a video.`, 'Give a video file (mp4, mov, webm).')]);
  return facts;
}

export const probe: Command<Context> = {
  name: 'probe',
  summary: 'The facts of a media file: what kind it is, its size, rate, frame count and length, the colour tags, the keyframes, the sound and its loudness. What `check` reads of every file of a document.',
  args: [{ name: 'file', help: 'a video, image or sound file' }],
  flags: [],
  async run(input, context) {
    const file = pathOf(context, input.args.file!);
    if (isFolder(file)) throw new Stop([issue('argument-value', { target: '<file>' }, `${file} is a folder; probe reads one media file.`, 'Give one video, image or sound file, for example a file of the assets folder of the project.')]);
    const s = await streamsOf(context, file);
    const loud = s.sound ? await context.tools.measure.loudness(file) : null;
    const marks = [...s.keyframes, s.frames];
    return {
      result: {
        file,
        kind: s.width === 0 ? 'audio' : s.frames <= 1 ? 'image' : 'video',                 // what `media.<key>.kind` it can be
        width: s.width, height: s.height, fps: s.fps, frames: s.frames, seconds: Number(s.seconds.toFixed(3)), constantRate: s.constantRate,
        codec: s.codec, pixelFormat: s.pixelFormat, colour: s.colour,
        keyframes: { count: s.keyframes.length, largestGap: s.keyframes.length === 0 ? 0 : Math.max(...marks.map((k, i) => (i === 0 ? k : k - marks[i - 1]!))), frames: s.keyframes.slice(0, LISTED) },
        sound: s.sound,
        loudness: loud === null ? null : { integrated: finite(loud.integrated), truePeak: finite(loud.truePeak), range: finite(loud.range) },   // LUFS, dBTP, LU; null: silence
      },
    };
  },
};
