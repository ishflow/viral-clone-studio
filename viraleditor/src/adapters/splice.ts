// The ffmpeg work on the finished parts of a person-swap video: a part brought to the shape of its source part (`fit`),
// and the parts joined into the video that is delivered (`join`): one after the other, the source's own sound under
// the whole, the "made by AI" label over every frame and the same words in the file's tags.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { MediaFacts, Splicer } from '../ports.ts';
import { containerFacts } from './encode.ts';
import { ExecError, runProcess } from './exec.ts';
import { MediaError } from './media.ts';

/** What the file says of itself, beside the label on its picture. */
export const AI_COMMENT = 'AI-generated';
/** The label is this wide, and this far from the left and the upper edge, as fractions of the frame's width. */
const LABEL_WIDTH = 0.3;
const LABEL_MARGIN = 0.04;
const TIMEOUT_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 30_000;
/** The delivered picture, and a fitted part (encoded once more by `join`, so nearly lossless). */
const DELIVERY = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p'];
const INTERMEDIATE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv420p'];

export interface Box { left: number; top: number; width: number; height: number }
/** The size, rate and number of frames a part must have: those of its source part. */
export interface PartShape { width: number; height: number; fps: number; frames: number }
export interface PartFitter {
  /** `file` at `to` in this shape, without sound: scaled and cropped to the size, at the rate, its last frame held when it is too short, its end cut when it is too long. */
  fit(file: string, to: string, shape: PartShape): Promise<MediaFacts>;
}

/** Where the label is drawn on a frame: the upper left corner, in the label's own proportions, on even pixels (the picture is 4:2:0). */
export function labelBox(frame: { width: number; height: number }, label: { width: number; height: number }): Box {
  const even = (pixels: number): number => Math.max(2, Math.round(pixels / 2) * 2);
  const width = even(frame.width * LABEL_WIDTH);
  const margin = even(frame.width * LABEL_MARGIN);
  return { left: margin, top: margin, width, height: even(width * label.height / label.width) };
}

export function createSplicer(tools: { ffmpeg: string; ffprobe: string }): Splicer & PartFitter {
  async function facts(file: string): Promise<MediaFacts> {
    if (!existsSync(file)) throw new MediaError('not-found', `${basename(file)} is not there`);
    try { return await containerFacts(tools.ffprobe, file, PROBE_TIMEOUT_MS); } catch (error) {
      throw new MediaError('not-media', `${basename(file)} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  /** ffmpeg writes beside `to` under a name of its own; `to` appears only when the whole file is written. */
  async function write(to: string, args: string[]): Promise<MediaFacts> {
    mkdirSync(dirname(to), { recursive: true });
    const ext = extname(to);
    const tmp = join(dirname(to), `.${basename(to, ext)}.${randomUUID().slice(0, 8)}.tmp${ext}`);
    try {
      let result;
      try { result = await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-nostdin', ...args, tmp], { timeoutMs: TIMEOUT_MS }); } catch (error) {
        if (error instanceof ExecError) throw new MediaError('tool-failed', error.message);
        throw error;
      }
      if (result.code !== 0 || !existsSync(tmp)) throw new MediaError('tool-failed', `ffmpeg could not write ${basename(to)}: ${result.stderr.trim().split('\n').at(-1) ?? `exit ${result.code}`}`);
      renameSync(tmp, to);
    } finally {
      rmSync(tmp, { force: true });
    }
    return facts(to);
  }

  return {
    async fit(file, to, shape) {
      await facts(file);
      const { width, height, fps, frames } = shape;
      const picture = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps},tpad=stop_mode=clone:stop=-1`;
      return write(to, ['-i', file, '-vf', picture, '-frames:v', String(frames), '-an', ...INTERMEDIATE]);
    },

    async join(parts, sound, label, to) {
      if (parts.length === 0) throw new MediaError('not-media', 'a video is joined from at least one part');
      const shapes: MediaFacts[] = [];
      for (const part of parts) shapes.push(await facts(part));
      const first = shapes[0]!;
      const odd = shapes.findIndex((shape) => shape.width !== first.width || shape.height !== first.height || shape.fps !== first.fps);
      if (odd >= 0) {
        const shape = shapes[odd]!;
        throw new MediaError('not-media', `${basename(parts[odd]!)} is ${shape.width}x${shape.height} at ${shape.fps} fps, the first part ${first.width}x${first.height} at ${first.fps}: parts are joined in one shape`);
      }
      const frames = shapes.reduce((sum, shape) => sum + shape.frames, 0);
      const box = labelBox(first, await facts(label));
      const count = parts.length;
      const graph = [
        `${parts.map((_, index) => `[${index}:v]`).join('')}concat=n=${count}:v=1:a=0[joined]`,
        `[${count}:v]scale=${box.width}:${box.height}[label]`,
        `[joined][label]overlay=${box.left}:${box.top}[out]`,
      ].join(';');
      return write(to, [
        ...parts.flatMap((part) => ['-i', part]), '-i', label, ...(sound === null ? [] : ['-i', sound]),
        '-filter_complex', graph, '-map', '[out]', ...(sound === null ? ['-an'] : ['-map', `${count + 1}:a:0`, '-c:a', 'aac', '-ar', '48000', '-b:a', '192k']),
        // the picture decides the length: every frame of every part, and no sound after the last one
        '-r', String(first.fps), '-frames:v', String(frames), '-t', String(frames / first.fps),
        ...DELIVERY, '-metadata', `comment=${AI_COMMENT}`, '-movflags', '+faststart',
      ]);
    },
  };
}
