import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import type { Context } from '../context.ts';
import type { Command } from '../framework.ts';
import { Stop, issue } from '../issue.ts';
import { examine, isFolder, openProject, pathOf, realOf } from '../project.ts';
import type { Project } from '../project.ts';

/** The last lines of a tool's output that say something. */
const tail = (text: string): string => text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').split(/[\r\n]+/).map((line) => line.trim()).filter((line) => line !== '').slice(-6).join(' | ').slice(-600);
/** A still as this command names it. */
const OWN = /^frame-\d{4}\.png$/;
/** A picture as `hyperframes snapshot` names it: `frame-<index>-at-<seconds>s.png`, the index counting the times given from 0 (padded to two digits, so past 99 the names no longer sort in order). */
const THEIRS = /^frame-(\d+)-at-.*\.png$/;

/**
 * The pictures of a snapshot folder in the order of the times asked for, by the number in each name. Null when they
 * are not exactly the indexes 0 … count − 1, each once: then no picture can be trusted to show the frame it is named for.
 */
export function inOrder(names: string[], count: number): string[] | null {
  const byIndex = new Map<number, string>();
  for (const name of names) {
    const index = THEIRS.exec(name)?.[1];
    if (index === undefined) continue;
    if (byIndex.has(Number(index))) return null;
    byIndex.set(Number(index), name);
  }
  if (byIndex.size !== count) return null;
  const ordered = Array.from({ length: count }, (_, i) => byIndex.get(i));
  return ordered.includes(undefined) ? null : (ordered as string[]);
}

/** The list of the stills this command wrote, in the project's work folder: only these are removed by a later run. */
const LEDGER = 'frames-written.json';
const readLedger = (work: string): string[] => {
  try {
    const list: unknown = JSON.parse(readFileSync(join(work, LEDGER), 'utf8'));
    return Array.isArray(list) ? list.filter((f): f is string => typeof f === 'string' && OWN.test(f.slice(f.lastIndexOf(sep) + 1))) : [];
  } catch { return []; }
};

/** Why the folder may not take the stills (the sources of the document live in assets/, and a still must never replace one), or null. */
function folderRefusal(out: string, project: Project): string | null {
  const real = realOf(out);
  const assets = realOf(join(project.dir, 'assets'));
  if (real === assets || real.startsWith(`${assets}${sep}`)) return `--out of frames is the assets folder of the project, or lies in it (${out}), where its sources are`;
  const named = Object.entries(project.edit.media).find(([, entry]) => dirname(realOf(join(project.dir, entry.file))) === real);
  if (named) return `--out of frames is the folder of media.${named[0]} of the document (${out}): a still could replace a source of its own`;
  return null;
}

export const frames: Command<Context> = {
  name: 'frames',
  summary: 'Stills of single frames as PNG, without rendering the video: the way to look at a layout. A few seconds for a handful of frames. `check` names frames worth looking at (result.stills).',
  args: [{ name: 'edit.json', help: 'the edit document, or the project folder that holds it' }],
  flags: [
    { name: 'at', type: 'integers', value: '<frames>', min: 0, required: true, help: 'the frame numbers, counted from 0 at 30 frames a second' },
    { name: 'out', type: 'string', value: '<dir>', help: 'the folder the PNG files go to; default <project>/.viraleditor/frames' },
  ],
  async run(input, context) {
    const wanted = [...new Set(input.flags.at as number[])].sort((a, b) => a - b);
    const out = input.flags.out === undefined ? null : pathOf(context, input.flags.out as string);
    if (out !== null && existsSync(out) && !isFolder(out)) {
      throw new Stop([issue('flag-value', { target: '--out' }, `--out of frames is a folder, but ${out} is a file.`, 'Give a folder (it is made when it is not there), or leave --out away: the stills then go to <project>/.viraleditor/frames.')]);
    }
    const opened = openProject(context, input.args['edit.json']!);
    const why = out === null ? null : folderRefusal(out, opened);
    if (why !== null) throw new Stop([issue('flag-value', { target: '--out' }, `${why}.`, 'Give another folder (it is made when it is not there), or leave --out away: the stills then go to <project>/.viraleditor/frames.')]);
    const examined = await examine(context, opened, 'written');
    const { project: { edit, work }, issues, warnings } = examined;
    const outside = wanted.filter((frame) => frame >= edit.frames);
    if (outside.length > 0) {
      issues.push(issue('frame-range', { target: '--at' }, `Frame ${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} outside the video: the document has ${edit.frames} frames, 0 to ${edit.frames - 1}.`,
        `Use frame numbers from 0 to ${edit.frames - 1} (frame = second × ${edit.canvas.fps}).`));
    }
    if (issues.length > 0 || examined.written === null) return { issues, warnings, result: null };

    const { fps, width, height } = edit.canvas;
    const shots = join(work, 'snapshot');
    rmSync(shots, { recursive: true, force: true });                 // only this run's pictures are in it
    // one browser for all frames; `--describe false` and an environment without keys: nothing leaves this machine
    const run = await context.tools.exec('hyperframes', ['snapshot', examined.written, '--at', wanted.map((frame) => String(frame / fps)).join(','), '--no-end', '--describe', 'false', '--output', shots]);
    const names = run.code === 0 && existsSync(shots) ? readdirSync(shots) : [];
    const made = inOrder(names, wanted.length);
    if (run.code !== 0 || made === null) {
      const why = run.code !== 0 ? `\`hyperframes snapshot\` exited ${run.code}`
        : `\`hyperframes snapshot\` did not write exactly the ${wanted.length} pictures asked for (it wrote: ${names.filter((name) => THEIRS.test(name)).slice(0, 6).join(', ') || 'none'})`;
      return { issues: [issue('stills-failed', { target: 'hyperframes' }, `${why}: ${tail(`${run.stdout}\n${run.stderr}`) || 'it printed nothing'}. No still was kept: none could be trusted to show its frame.`)], warnings, result: null };
    }
    const dir = out ?? join(work, 'frames');
    mkdirSync(dir, { recursive: true });
    const before = readLedger(work);
    const here = realOf(dir);
    for (const file of before) if (dirname(realOf(file)) === here) rmSync(file, { force: true });      // the stills this command wrote in an earlier run: they show another state of the document; no other file is touched
    const written = wanted.map((frame, i) => {
      const file = join(dir, `frame-${String(frame).padStart(4, '0')}.png`);
      copyFileSync(join(shots, made[i]!), file);
      return { frame, second: Number((frame / fps).toFixed(3)), file };
    });
    writeFileSync(join(work, LEDGER), JSON.stringify([...before.filter((file) => dirname(realOf(file)) !== here), ...written.map((w) => w.file)], null, 2));
    return { issues, warnings, result: { dir, width, height, frames: written, next: 'Open each PNG and look at it: is every text readable, inside the picture and where you want it? Then change edit.json, or render.' } };
  },
};
