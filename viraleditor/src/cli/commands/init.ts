import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GeneratorError } from '../../ports.ts';
import type { Context } from '../context.ts';
import { EXAMPLES, EXAMPLE_NAMES, mediaNeeds, readExample } from '../examples.ts';
import type { ExampleName } from '../examples.ts';
import type { Command } from '../framework.ts';
import { Stop, issue, sh } from '../issue.ts';
import { isFolder, pathOf } from '../project.ts';

export const init: Command<Context> = {
  name: 'init',
  summary: 'Writes a working project into a folder: the edit.json of an example and its media in assets/ (clips that carry their frame number as two white bars, pictures that carry their name in letters, a tone as music), made on this machine. A project to check, render and then change. --list names the examples.',
  args: [{ name: 'dir', help: 'the folder to write the project into; it is made when it is not there', optional: true }],
  flags: [
    { name: 'example', type: 'choice', choices: EXAMPLE_NAMES, default: EXAMPLE_NAMES[0], help: 'which example to write' },
    { name: 'list', type: 'boolean', help: 'name the examples and write nothing' },
  ],
  async run(input, context) {
    if (input.flags.list === true) {
      return {
        result: {
          examples: Object.entries(EXAMPLES).map(([name, about]) => ({ name, about })),
          next: 'Write one: `viraleditor init <dir> --example <name>`.',
        },
      };
    }
    if (input.args.dir === undefined) {
      throw new Stop([issue('argument-missing', { target: '<dir>' }, '`viraleditor init` needs <dir>: the folder to write the project into.', 'Write it after the command: viraleditor init <dir> [--example <name>]; `viraleditor init --list` names the examples.')]);
    }
    const dir = pathOf(context, input.args.dir);
    const name = input.flags.example as ExampleName;
    if (existsSync(dir) && !isFolder(dir)) throw new Stop([issue('argument-value', { target: '<dir>' }, `${dir} is a file; init writes a project into a folder.`, 'Give a folder: one that is empty, or a name that is free.')]);
    const taken = ['edit.json', 'assets'].filter((entry) => existsSync(join(dir, entry)));
    if (taken.length > 0) throw new Stop([issue('folder-in-use', { target: dir }, `${dir} already holds ${taken.join(' and ')}; init never overwrites a project.`, `Give another folder, for example \`viraleditor init ${sh(`${dir}-2`)} --example ${name}\`.`)]);

    const { text, edit } = readExample(name);
    const needs = mediaNeeds(edit);
    const raw = join(dir, '.viraleditor', 'init');           // the stand-ins as they are made; the clips go from here into assets/ as normalised copies
    const assets = join(dir, 'assets');
    const fresh = !existsSync(dir);
    mkdirSync(assets, { recursive: true });
    context.log(`init: making ${needs.length} media files`);
    try {
      await context.tools.placeholders.make(needs, raw, edit.canvas);
      for (const need of needs) {
        // a clip gets what `normalize` gives every clip: a keyframe every second and BT.709 colour, so the project checks without a warning
        if (need.kind === 'clip') await context.tools.media.normalize(join(raw, need.file), join(assets, need.file), { ...edit.canvas, audio: need.sound });
        else copyFileSync(join(raw, need.file), join(assets, need.file));
      }
    } catch (error) {
      // half a project is none: what this run made is taken away again, so the same command can be run once more
      for (const made of fresh ? [dir] : [assets, raw]) rmSync(made, { recursive: true, force: true });
      if (error instanceof GeneratorError) throw new Stop([issue('tool-failed', { target: 'ffmpeg' }, `The media of the example could not be made: ${error.message}. Nothing was written.`)]);
      throw error;
    }
    rmSync(raw, { recursive: true, force: true });
    const file = join(dir, 'edit.json');
    writeFileSync(file, text);
    return {
      result: {
        project: dir, example: name, about: EXAMPLES[name], document: file,
        canvas: `${edit.canvas.width}x${edit.canvas.height}`, frames: edit.frames, seconds: Number((edit.frames / edit.canvas.fps).toFixed(3)),
        media: Object.values(edit.media).map((entry) => entry.file),                    // `check` gives the facts of each
        next: `Check it: \`viraleditor check ${sh(file)}\`. Then change edit.json, or put your own files into ${sh(assets)} and point "media" at them.`,
      },
    };
  },
};
