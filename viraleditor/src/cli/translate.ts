// What the pieces report, as the one kind of issue the command line prints: an issue of the document (edit/, compose/),
// of a media file or a render (quality/), of the renderer's check, and the errors the tools throw.
import { ExecError } from '../adapters/exec.ts';
import { MediaError } from '../adapters/media.ts';
import { WriteError } from '../compose/write.ts';
import type { Timeline } from '../edit/timeline.ts';
import type { Edit, EditIssue } from '../edit/types.ts';
import { RenderError } from '../ports.ts';
import type { CheckIssue } from '../ports.ts';
import type { QualityIssue } from '../quality/index.ts';
import { issue, sh } from './issue.ts';
import type { Issue } from './issue.ts';

export const fromEdit = (found: EditIssue): Issue => ({ code: found.code, path: found.path, message: found.message, fix: found.fix });

/** Errors and warnings apart, in the order they were found. */
export function split(found: { severity: 'error' | 'warning'; issue: Issue }[]): { issues: Issue[]; warnings: Issue[] } {
  return { issues: found.filter((f) => f.severity === 'error').map((f) => f.issue), warnings: found.filter((f) => f.severity === 'warning').map((f) => f.issue) };
}

/**
 * From what an issue names (a shot, text or card id, an element of the composition, a media key) to its place in the
 * document. An id comes before a media key of the same name.
 */
export function placer(edit: Edit, timeline: Timeline | null): (target: string | null) => string | undefined {
  const places = new Map<string, string>();
  const put = (name: string | undefined, path: string) => { if (name !== undefined && !places.has(name)) places.set(name, path); };
  edit.shots.forEach((shot, i) => put(shot.id, `shots[${i}]`));
  (edit.texts ?? []).forEach((text, i) => put(text.id, `texts[${i}]`));
  (edit.cards ?? []).forEach((card, i) => put(card.id, `cards[${i}]`));
  (edit.audio?.sounds ?? []).forEach((sound, i) => put(sound.id, `audio.sounds[${i}]`));
  if (timeline) {
    for (const shot of timeline.shots) put(shot.element, places.get(shot.id)!);
    for (const text of timeline.texts) put(text.element, places.get(text.id)!);
    for (const card of timeline.cards) put(card.element, places.get(card.id)!);
    for (const group of timeline.captions) put(group.element, 'captions');
  }
  for (const key of Object.keys(edit.media)) put(key, `media.${key}`);
  return (target) => (target === null ? undefined : places.get(target));
}

/** The codes of quality/inputs.ts whose cure is a normalised copy of the file. */
const NORMALIZE = new Set(['media-fps', 'media-size', 'media-keyframes', 'media-vfr', 'media-colour']);

/** An issue of a media file of the document (quality/checkInputs): its place is `media.<key>`. */
export function fromInput(found: QualityIssue, edit: Edit, dir: string): { severity: 'error' | 'warning'; issue: Issue } {
  const key = found.target ?? '';
  const entry = edit.media[key];
  let fix = found.fix;
  if (entry && NORMALIZE.has(found.code)) {
    // the exact command, with the paths and the canvas of this document, and the line to change afterwards
    const copy = entry.file.replace(/(\.[A-Za-z0-9]+)?$/, '-norm.mp4');
    fix = `Run \`viraleditor normalize ${sh(`${dir}/${entry.file}`)} ${sh(`${dir}/${copy}`)} --canvas ${edit.canvas.width}x${edit.canvas.height}\` (a copy on the canvas, at ${edit.canvas.fps} fps, with a keyframe every second and BT.709 colour), then set media.${key}.file to "${copy}".`;
  }
  return { severity: found.severity, issue: { code: found.code, ...(entry ? { path: `media.${key}` } : { target: key }), message: found.message, fix, ...(found.at === null ? {} : { at: found.at }) } };
}

/** An issue of a finished render (quality/checkOutput). `place`: from a shot or element to its place in the document, when the document is known. `again`: the command that checks the composition. */
export function fromOutput(found: QualityIssue, place: (target: string | null) => string | undefined, again: string | null): { severity: 'error' | 'warning'; issue: Issue } {
  const path = place(found.target);
  // quality/ names the check with a stand-in for the document; here the document is known, so the fix names the exact command
  const fix = again === null ? found.fix : found.fix.replaceAll('`viraleditor check <edit.json> --deep`', `\`${again}\``);
  return { severity: found.severity, issue: { code: found.code, ...(path !== undefined ? { path } : { target: found.target ?? 'render' }), message: found.message, fix, ...(found.at === null ? {} : { at: found.at }) } };
}

/**
 * A finding of the renderer's check (lint, runtime, layout at the rest frames). A layout finding is about the document:
 * something leaves its box on a frame where it stands still. Any other one means the composition itself is wrong, which
 * no change of the document is sure to cure.
 */
export function fromRendererCheck(found: CheckIssue, place: (target: string | null) => string | undefined, fps: number, composition: string): Issue {
  const path = place(found.target);
  const where = path !== undefined ? { path } : { target: found.target ?? 'composition' };
  const at = found.second === null ? {} : { at: Math.round(found.second * fps) };
  const said = `[${found.code}] ${found.message}`.trim();
  if (found.second !== null || /overflow|clipped/i.test(found.code)) {
    const named = path ?? (found.target === null ? 'the element' : `the element "${found.target}"`);
    // what to change depends on what it is: a text has a copy and a size, a card or a window has only its box
    const cure = path === undefined || /^(texts\[|captions)/.test(path) ? `Shorten the copy of ${named}, enlarge its box, or lower the size of its style`
      : path.startsWith('cards[') ? `Move the box of ${named} inside the canvas or make it smaller (left, top, right, bottom in percent of the canvas); a "motion" on a card enlarges it past its box`
        : `Change the window of ${named} (its corner or width) so that it stays inside the canvas`;
    return { ...issue('layout-overflow', where, `In the browser, ${named} leaves its box or the canvas${found.second === null ? '' : ` on frame ${Math.round(found.second * fps)}`}: ${said}`,
      `${cure}; then run the check again. \`viraleditor frames\` with that frame shows it.`), ...at };
  }
  return issue('composition-fault', where, `The check of the renderer refuses the composition written from this document: ${said}`,
    `This is a fault of the editor, not of the document. To get on, remove or simplify ${path ?? 'the element named'} and check again; report the issue with the folder ${composition}.`);
}

/** The errors the tools throw, as issues. Null: not one of them (the framework then reports `internal`). */
export function explain(error: unknown): Issue | null {
  if (error instanceof MediaError) {
    if (error.code === 'not-found') return issue('file-missing', { target: error.message.replace(/^no such file: /, '') }, `The file is not there: ${error.message}.`);
    if (error.code === 'not-media') return issue('media-unreadable', { target: error.message.replace(/^(not a media file: |no video stream in )/, '') }, `${error.message}.`);
    return issue('tool-failed', { target: 'ffmpeg' }, `ffmpeg or ffprobe failed: ${error.message}`);
  }
  if (error instanceof RenderError) return issue('tool-failed', { target: 'hyperframes' }, `The HyperFrames CLI failed: ${error.message}`);
  if (error instanceof ExecError) return issue('tool-failed', { target: 'tool' }, `A tool did not run: ${error.message}`);
  if (error instanceof WriteError) {
    if (error.code === 'font-missing') return issue('tool-missing', { target: error.file }, `A font file of the editor is not installed: ${error.message}.`, 'Run `pnpm install` in the viraleditor folder (the fonts come with it), then `viraleditor doctor`.');
    return issue('file-missing', { target: error.file }, `A media file of the document is not there: ${error.message}.`, 'Put the file into the project\'s assets folder, or point media.<key>.file at a file that exists; `viraleditor check` names the key.');
  }
  return null;
}
