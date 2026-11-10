// The working examples `init` writes: each is a folder of viraleditor/examples/ with one edit.json. Its media is not
// kept in the repo: what every file must be (how long a clip, with or without sound) is read off the document itself.
import { readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tailOf, windowPictures } from '../edit/presets.ts';
import type { Edit } from '../edit/types.ts';
import type { PlaceholderNeed } from '../prepare/placeholders.ts';

export const EXAMPLES = {
  'product-beats': 'A product montage without talking, 9 s: four shots with motion and four kinds of transition, a hook, labels, a tag, a product card, music.',
  'talking-captions': 'A talking video, 8 s: two shots with their own sound, captions word by word, a product card while its words are spoken, music that goes down under the voice.',
  'before-after': 'A before / after, 7 s: the talker shrinks into a window while a picture fills the frame, and the picture changes behind the window.',
  minimal: 'The shortest valid document: one clip, 3 s. A start for a document written from nothing.',
} as const;
export type ExampleName = keyof typeof EXAMPLES;
export const EXAMPLE_NAMES = Object.keys(EXAMPLES) as ExampleName[];

const DIR = fileURLToPath(new URL('../../examples/', import.meta.url));
/** The edit.json of an example, as it lies in the repo. */
export const exampleFile = (name: ExampleName): string => join(DIR, name, 'edit.json');
/** The text `init` writes, and the document in it. */
export function readExample(name: ExampleName): { text: string; edit: Edit } {
  const text = readFileSync(exampleFile(name), 'utf8');
  return { text, edit: JSON.parse(text) as Edit };
}

/** A stand-in clip is asked for in whole seconds, 4 at least (what the provider's cheapest tier takes, and so the fake one). */
const CLIP_SECONDS_MIN = 4;

/**
 * What stands in for every media file of a document: a clip as long as its shots need (the frames the next transition
 * holds it included), with sound when a shot plays its sound; a picture that carries its key in letters; a tone as long
 * as the video.
 */
export function mediaNeeds(edit: Edit): PlaceholderNeed[] {
  const fps = edit.canvas.fps;
  const used = new Map<string, number>();      // media key → the most source frames anything shows of it
  const need = (key: string, frames: number) => used.set(key, Math.max(used.get(key) ?? 0, frames));
  edit.shots.forEach((shot, i) => {
    need(shot.media, (shot.from ?? 0) + shot.for + tailOf(edit.shots, i));
    for (const window of shot.windows ?? []) for (const picture of windowPictures(window)) need(picture.behind, picture.for);
  });
  return Object.entries(edit.media).map(([key, entry]): PlaceholderNeed => {
    const file = basename(entry.file);
    if (entry.kind === 'image') return { kind: 'image', file, label: basename(file, extname(file)) };
    if (entry.kind === 'audio') return { kind: 'music', file, seconds: Math.ceil(edit.frames / fps) };
    return { kind: 'clip', file, seconds: Math.max(CLIP_SECONDS_MIN, Math.ceil((used.get(key) ?? 0) / fps)), sound: edit.shots.some((shot) => shot.media === key && shot.sound !== undefined) };
  });
}
