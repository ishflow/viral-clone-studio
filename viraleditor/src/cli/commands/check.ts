import type { Context } from '../context.ts';
import type { Command } from '../framework.ts';
import { sh } from '../issue.ts';
import { examine, openProject, stillsOf } from '../project.ts';

const round = (n: number): number => Number(n.toFixed(3));

export const check: Command<Context> = {
  name: 'check',
  summary: 'Checks an edit document and its media without rendering: the shape, the rules, the files, the text that must fit. Every issue has a code, a place in the document, a message and a fix. --deep also writes the composition and runs the check of the renderer in a browser.',
  args: [{ name: 'edit.json', help: 'the edit document, or the project folder that holds it' }],
  flags: [{ name: 'deep', type: 'boolean', help: 'also write the composition and run the check of the renderer (starts a browser; `render` does this by itself)' }],
  async run(input, context) {
    const deep = input.flags.deep === true;
    const examined = await examine(context, openProject(context, input.args['edit.json']!), deep ? 'deep' : 'document');
    const { project: { file, edit }, issues, warnings } = examined;
    const timeline = examined.composition?.timeline;
    const stills = stillsOf(examined);
    const media = Object.fromEntries(Object.entries(edit.media).map(([key, entry]) => {
      const s = examined.streams[key];
      const facts = s === undefined ? { readable: false }                                   // missing or damaged: an issue says which
        : entry.kind === 'audio' ? { seconds: round(s.seconds) }
          : entry.kind === 'image' ? { width: s.width, height: s.height }
            : { width: s.width, height: s.height, frames: s.frames, seconds: round(s.seconds), sound: s.audio };
      return [key, { file: entry.file, kind: entry.kind, ...facts }];
    }));
    return {
      issues, warnings,
      result: {
        document: file,
        canvas: `${edit.canvas.width}x${edit.canvas.height}`, fps: edit.canvas.fps, frames: edit.frames, seconds: round(edit.frames / edit.canvas.fps),
        media,
        elements: timeline ? { shots: timeline.shots.length, texts: (edit.texts ?? []).length, cards: timeline.cards.length, captionGroups: timeline.captions.length, sounds: timeline.audio.length } : null,
        deep,
        deepCheck: examined.deepCheck,                                          // 'ran' when the check of the renderer ran; `render` will not repeat one that passed
        composition: examined.written,
        stills,
        next: issues.length > 0 ? `Fix the ${issues.length === 1 ? 'issue' : `${issues.length} issues`} (each names its place and its fix), then run \`viraleditor check ${sh(file)}\` again.`
          : `Look at the layout: \`viraleditor frames ${sh(file)} --at ${stills.join(',')}\` (frames on which every text and card stands still). Then \`viraleditor render ${sh(file)} --sheet\`.`,
      },
    };
  },
};
