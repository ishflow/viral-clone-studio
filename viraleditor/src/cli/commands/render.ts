import { rmSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { StageTime } from '../../adapters/renderer.ts';
import { RenderError } from '../../ports.ts';
import { checkOutput } from '../../quality/index.ts';
import type { Context } from '../context.ts';
import type { Command } from '../framework.ts';
import { Stop, issue, sh } from '../issue.ts';
import { examine, isFolder, openProject, pathOf, realOf } from '../project.ts';
import type { Project } from '../project.ts';
import { fromOutput, split } from '../translate.ts';
import { sheetBeside, tilesOf } from './sheet.ts';

const round = (n: number): number => Number(n.toFixed(2));
/** The stage that took longest, of those that are not made of other stages in the list. */
export function slowest(stages: StageTime[]): StageTime | null {
  const leaves = stages.filter((s) => !stages.some((other) => other.stage.startsWith(`${s.stage}.`)));
  return leaves.reduce<StageTime | null>((worst, s) => (worst === null || s.seconds > worst.seconds ? s : worst), null);
}

/** Why a file may not be the video a render writes (it is removed first, then written), or null. Checked before anything is written or removed. */
function refusal(out: string, project: Project | null): string | null {
  if (!/\.mp4$/i.test(out)) return `--out of render is the video to write and must end in .mp4, but it is ${out}`;
  if (isFolder(out)) return `--out of render is a file, but ${out} is a folder`;
  if (isFolder(sheetBeside(out))) return `--out of render has a folder where its contact sheet would go (${sheetBeside(out)}), and the render clears that name`;
  if (project === null) return null;
  const real = realOf(out);
  if (real === realOf(project.file)) return `--out of render is the edit document itself (${out}): the render would replace it`;
  const media = Object.entries(project.edit.media).find(([, entry]) => realOf(join(project.dir, entry.file)) === real);
  if (media) return `--out of render is media.${media[0]} of the document (${out}): the render would replace a source of its own`;
  if (real.startsWith(`${realOf(join(project.dir, 'assets'))}${sep}`)) return `--out of render lies in the assets folder of the project (${out}), where its sources are`;
  return null;
}
const refuse = (why: string | null): void => {
  if (why !== null) throw new Stop([issue('flag-value', { target: '--out' }, `${why}.`, 'Give a new file name that ends in .mp4 outside the assets folder, or leave --out away: the video then goes to <project>/.viraleditor/render.mp4.')]);
};

export const render: Command<Context> = {
  name: 'render',
  summary: 'Renders the document to mp4: check --deep (not repeated when `check --deep` just passed for the same document and media), the render, then the quality check of the result (black or frozen frames, missing text, contrast, loudness). Answers with the file, its facts, the times and every issue. An error of the quality check fails the command; the file is kept and marked as failed. --sheet adds a contact sheet PNG to look at.',
  args: [{ name: 'edit.json', help: 'the edit document, or the project folder that holds it' }],
  flags: [
    { name: 'out', type: 'string', value: '<mp4>', help: 'the video file; default <project>/.viraleditor/render.mp4' },
    { name: 'quality', type: 'choice', choices: ['draft', 'looks'], default: 'looks', help: 'draft: faster, for a first look; looks: the one to deliver' },
    { name: 'sheet', type: 'boolean', help: 'also write a contact sheet (4 × 3 tiles) beside the video, as <name>.sheet.png' },
  ],
  async run(input, context) {
    const quality = input.flags.quality as 'draft' | 'looks';
    const stages: StageTime[] = [];
    const timed = async <T>(stage: string, work: () => Promise<T>): Promise<T> => {
      const from = context.clock.now().getTime();
      try { return await work(); } finally { stages.push({ stage, seconds: round((context.clock.now().getTime() - from) / 1000) }); }
    };

    const out = input.flags.out === undefined ? null : pathOf(context, input.flags.out as string);
    if (out !== null) refuse(refusal(out, null));
    const project = openProject(context, input.args['edit.json']!);
    if (out !== null) refuse(refusal(out, project));
    const examined = await timed('check', () => examine(context, project, 'deep', true));
    const { warnings } = examined;
    if (examined.issues.length > 0 || examined.composition === null || examined.written === null) return { issues: examined.issues, warnings, result: null };
    const { timeline } = examined.composition;
    const file = out ?? join(project.work, 'render.mp4');
    rmSync(sheetBeside(file), { force: true });                      // the sheet of an earlier render shows another video

    let last = 0;
    const progress = ({ frame, frames }: { frame: number; frames: number }) => {      // every tenth of the way, to stderr
      const tenth = Math.floor((frame / frames) * 10);
      if (tenth > last || frame === frames) { last = tenth; context.log(`render: frame ${frame}/${frames}`); }
    };
    let facts;
    try {
      facts = await timed('render', () => context.tools.renderer(quality).render(examined.written!, file, progress));
    } catch (error) {
      if (!(error instanceof RenderError)) throw error;
      return { issues: [issue('render-failed', { target: file }, `The render wrote no video: ${error.message}`, `Run \`viraleditor doctor\`; if everything is ready, run \`viraleditor check ${sh(project.file)} --deep\` and then the render again${quality === 'looks' ? ', or try --quality draft' : ''}.`)], warnings, result: null };
    }
    stages.push(...facts.stages.map((s) => ({ stage: `render.${s.stage}`, seconds: round(s.seconds) })));

    const sources = Object.fromEntries(Object.entries(project.edit.media).map(([key, entry]) => [key, join(project.dir, entry.file)]));
    const again = `viraleditor check ${sh(project.file)} --deep`;
    const found = split((await timed('quality', () => checkOutput(file, timeline, context.tools.measure, sources))).map((q) => fromOutput(q, examined.place, again)));
    const sheetFile = sheetBeside(file);
    const sheet = input.flags.sheet === true
      ? await timed('sheet', async () => ({ file: sheetFile, columns: 4, rows: 3, tiles: tilesOf((await context.tools.media.sheet(file, sheetFile, { columns: 4, rows: 3, labels: true })).seconds, 4, facts.fps) }))
      : null;
    const failed = found.issues.length > 0;
    return {
      issues: found.issues,
      warnings: [...warnings, ...found.warnings],
      result: {
        file, failed,
        width: facts.width, height: facts.height, fps: facts.fps, frames: facts.frames, seconds: round(facts.seconds), sound: facts.audio,
        quality, encode: facts.encode, note: facts.note,
        deepCheck: examined.deepCheck,                                 // 'ran': the check of the renderer ran now; 'stamp': it passed before for exactly this document and these media, and was not repeated
        renderSeconds: stages.find((s) => s.stage === 'render')!.seconds,
        slowest: slowest(stages),
        stages,
        timeline: join(examined.written, 'timeline.json'),
        sheet,
        next: failed ? `The video has ${found.issues.length === 1 ? 'an error' : 'errors'}: do not deliver ${file}. Fix what the issues name in ${project.file} and render again.`
          : sheet ? `Look at ${sheet.file}: tile n shows the second listed under sheet.tiles. Fix what you see or what the warnings name, and render again; otherwise the video is done.`
            : 'Render with --sheet to get a picture of the whole video to look at.',
      },
    };
  },
};
