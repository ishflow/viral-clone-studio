import type { Context } from '../context.ts';
import { dirname } from 'node:path';
import type { Command } from '../framework.ts';
import { Stop, issue } from '../issue.ts';
import { isFolder, pathOf, realOf } from '../project.ts';
import { videoOf } from './probe.ts';

const FPS = 30;

export const normalize: Command<Context> = {
  name: 'normalize',
  summary: 'Writes a copy of a video that the editor can cut exactly: scaled and cropped to the canvas, 30 frames a second, a keyframe every second, BT.709 colour, its sound kept. The cure for media-fps, media-size, media-keyframes, media-vfr and media-colour.',
  args: [{ name: 'in', help: 'the video to copy' }, { name: 'out', help: 'the copy to write, for example <project>/assets/clip-norm.mp4' }],
  flags: [{ name: 'canvas', type: 'choice', choices: ['720x1280', '1080x1920'], required: true, help: 'the canvas of the document the copy is for' }],
  async run(input, context) {
    const from = pathOf(context, input.args.in!);
    const file = pathOf(context, input.args.out!);
    const [width, height] = (input.flags.canvas as string).split('x').map(Number) as [number, number];
    if (isFolder(from)) throw new Stop([issue('argument-value', { target: '<in>' }, `${from} is a folder; normalize copies one video file.`, 'Give the video file to copy.')]);
    if (!/\.mp4$/i.test(file) || realOf(file) === realOf(from)) {
      throw new Stop([issue('argument-value', { target: '<out>' }, realOf(file) === realOf(from) ? `<out> is the video to copy itself (${file}): the copy would replace its source.` : `<out> is the copy to write and must end in .mp4, but it is ${file}.`,
        'Give a new file name that ends in .mp4, for example <project>/assets/<name>-norm.mp4.')]);
    }
    if (isFolder(file) || !isFolder(dirname(file))) {
      throw new Stop([issue('argument-value', { target: '<out>' }, isFolder(file) ? `${file} is a folder; <out> is the file to write.` : `The folder of <out> is not there: ${dirname(file)}.`,
        'Give a file name in a folder that exists, for example <project>/assets/<name>-norm.mp4.')]);
    }
    const source = await videoOf(context, from);
    const facts = await context.tools.media.normalize(from, file, { width, height, fps: FPS, audio: source.audio });
    return {
      result: {
        file, from, width: facts.width, height: facts.height, fps: facts.fps, frames: facts.frames, seconds: Number(facts.seconds.toFixed(3)), sound: facts.audio,
        next: `Point the media entry of the document at the copy ("file": "assets/<name>" when it lies in the project's assets folder), then run \`viraleditor check\`.`,
      },
    };
  },
};
