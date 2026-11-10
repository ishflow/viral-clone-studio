import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Timeline } from '../../edit/timeline.ts';
import { checkOutput, summary } from '../../quality/index.ts';
import type { Context } from '../context.ts';
import type { Command } from '../framework.ts';
import { Stop, issue, sh } from '../issue.ts';
import { openProject, pathOf, readJson } from '../project.ts';
import { fromOutput, placer, split } from '../translate.ts';

const LISTS = ['shots', 'transitions', 'windows', 'texts', 'captions', 'cards', 'audio', 'animations', 'checkAt'] as const;
/** What is missing for the file to be a timeline.json, or null. */
function notTimeline(json: unknown): string | null {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return 'it is not an object';
  const t = json as Record<string, unknown>;
  const numbers = ['fps', 'frames', 'width', 'height'].filter((name) => typeof t[name] !== 'number');
  const lists = LISTS.filter((name) => !Array.isArray(t[name]));
  return numbers.length + lists.length === 0 ? null : `it lacks ${[...numbers, ...lists].join(', ')}`;
}

export const inspect: Command<Context> = {
  name: 'inspect',
  summary: 'The quality check of a finished render against its timeline.json: the size, rate and frame count, black and frozen frames, text that is missing or hard to read, the loudness. What `render` runs by itself at its end. With --edit it reads the sources as `render` does: footage that is black or still by itself is a warning, and every issue names its place in the document.',
  args: [{ name: 'mp4', help: 'the rendered video' }],
  flags: [
    { name: 'timeline', type: 'string', value: '<timeline.json>', required: true, help: 'the timeline.json of the composition it was rendered from: <project>/.viraleditor/composition/timeline.json' },
    { name: 'edit', type: 'string', value: '<edit.json>', help: 'the edit document it was rendered from, or its project folder: the check then reads the source files too' },
  ],
  async run(input, context) {
    const file = pathOf(context, input.args.mp4!);
    if (!existsSync(file)) throw new Stop([issue('file-missing', { target: file }, `The video is not there: ${file}.`, 'Give the path of a rendered mp4: `viraleditor render <edit.json>` names it under result.file.')]);
    const timelineFile = pathOf(context, input.flags.timeline as string);
    const json = readJson(timelineFile, 'The timeline', '`viraleditor check <edit.json> --deep` and `viraleditor render` write it, as <project>/.viraleditor/composition/timeline.json; give that path.');
    const wrong = notTimeline(json);
    if (wrong !== null) throw new Stop([issue('timeline-invalid', { target: timelineFile }, `${timelineFile} is not a timeline.json: ${wrong}.`)]);
    const timeline = json as Timeline;
    const project = input.flags.edit === undefined ? null : openProject(context, input.flags.edit as string);
    const sources = project === null ? undefined : Object.fromEntries(Object.entries(project.edit.media).map(([key, entry]) => [key, join(project.dir, entry.file)]));
    const found = await checkOutput(file, timeline, context.tools.measure, sources);
    const counts = summary(found);
    const place = project === null ? () => undefined : placer(project.edit, timeline);
    const next = counts.errors > 0 ? `The video has ${counts.errors === 1 ? 'an error' : 'errors'}: do not deliver ${file}. Fix what the issues name in the edit document and render again.`
      : counts.warnings > 0 ? 'No error. Read the warnings: each names what a viewer would notice and how to change it.' : 'The render passes the quality check.';
    return {
      ...split(found.map((q) => fromOutput(q, place, project === null ? null : `viraleditor check ${sh(project.file)} --deep`))),
      result: { file, timeline: timelineFile, edit: project?.file ?? null, errors: counts.errors, warnings: counts.warnings, next },
    };
  },
};
