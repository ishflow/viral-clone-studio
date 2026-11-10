import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Context } from '../context.ts';
import type { Command } from '../framework.ts';
import { Stop, issue } from '../issue.ts';
import { isFolder, pathOf, realOf } from '../project.ts';
import { videoOf } from './probe.ts';

/** `<name>.sheet.png` beside the video. */
export const sheetBeside = (video: string): string => video.replace(/\.[A-Za-z0-9]+$/, '') + '.sheet.png';

/** Where each tile sits (read like text: row by row, from the left) and the second and frame of the video it shows. */
export function tilesOf(seconds: number[], columns: number, fps: number): { tile: number; row: number; column: number; second: number; frame: number }[] {
  return seconds.map((second, i) => ({ tile: i + 1, row: Math.floor(i / columns) + 1, column: (i % columns) + 1, second: Number(second.toFixed(3)), frame: Math.round(second * fps) }));
}

export const sheet: Command<Context> = {
  name: 'sheet',
  summary: 'A contact sheet of a finished video: one PNG with a grid of frames spread evenly over its length, each with its second written in its corner. The way to look at a whole video at once.',
  args: [{ name: 'mp4', help: 'the video file' }],
  flags: [
    { name: 'columns', type: 'integer', value: '<n>', min: 1, max: 8, default: 4, help: 'tiles in a row' },
    { name: 'rows', type: 'integer', value: '<n>', min: 1, max: 8, default: 3, help: 'rows of tiles' },
    { name: 'out', type: 'string', value: '<png>', help: 'the picture file; default <name>.sheet.png beside the video' },
  ],
  async run(input, context) {
    const video = pathOf(context, input.args.mp4!);
    const columns = input.flags.columns as number;
    const rows = input.flags.rows as number;
    const file = input.flags.out === undefined ? sheetBeside(video) : pathOf(context, input.flags.out as string);
    if (!/\.png$/i.test(file) || realOf(file) === realOf(video)) {
      throw new Stop([issue('flag-value', { target: '--out' }, realOf(file) === realOf(video) ? `--out of sheet is the video itself (${file}): the sheet would replace it.` : `--out of sheet is a PNG file, but ${file} does not end in .png.`,
        'Give a file name that ends in .png, or leave --out away: the sheet then goes beside the video as <name>.sheet.png.')]);
    }
    const folder = dirname(realOf(file));
    if (input.flags.out !== undefined && basename(folder) === 'assets' && existsSync(join(dirname(folder), 'edit.json'))) {
      throw new Stop([issue('flag-value', { target: '--out' }, `--out of sheet lies in the assets folder of a project (${file}), where its sources are.`,
        'Give a new file name that ends in .png outside the assets folder, or leave --out away: the sheet then goes beside the video as <name>.sheet.png.')]);
    }
    if (input.flags.out !== undefined && (isFolder(file) || !isFolder(dirname(file)))) {
      throw new Stop([issue('flag-value', { target: '--out' }, isFolder(file) ? `--out of sheet is a file, but ${file} is a folder.` : `--out of sheet is in a folder that is not there: ${dirname(file)}.`,
        'Give a new file name that ends in .png in a folder that exists, or leave --out away: the sheet then goes beside the video as <name>.sheet.png.')]);
    }
    const facts = await videoOf(context, video);
    const { seconds } = await context.tools.media.sheet(video, file, { columns, rows, labels: true });
    return { result: { file, video, columns, rows, tiles: tilesOf(seconds, columns, facts.fps), next: `Open ${file} and look at it: the tiles are in reading order, tile 1 at the top left, each with its second in its corner.` } };
  },
};
