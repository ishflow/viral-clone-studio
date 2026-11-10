// What the emitters share while a composition is written: the document, the frame table being filled, the track indexes.
import type { Timeline } from '../edit/timeline.ts';
import type { ComposeFacts, Edit, Frame, TextStyle } from '../edit/types.ts';
import type { Row } from './animation.ts';
import { seconds } from './time.ts';
import type { Tracks } from './tracks.ts';

export interface Build {
  edit: Edit;
  facts: Record<string, ComposeFacts>;
  styles: Record<string, TextStyle>;
  fps: number;
  canvas: { width: number; height: number };
  tracks: Tracks;
  timeline: Timeline;
  files: Set<string>;                 // every assets/… the HTML names
}

/** Copy and caption words are the only free text in a composition (design §5.9). */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** The file of a media key, noted as used. */
export function fileOf(b: Build, key: string): string {
  const file = b.edit.media[key]!.file;
  b.files.add(file);
  return file;
}

/** `data-start` and `data-duration` of a timed element (R1). */
export function timing(b: Build, at: Frame, length: number): string {
  return `data-start="${seconds(at, b.fps)}" data-duration="${seconds(length, b.fps)}"`;
}

/** The rows of the frame table for one element. */
export function note(b: Build, element: string, rows: Row[]): void {
  for (const row of rows) b.timeline.animations.push({ element, ...row });
}

/** Text of an attribute list or a class list without its empty parts. */
export function words(...parts: (string | false | undefined)[]): string {
  return parts.filter((part) => part).join(' ');
}

/** A fill as timeline.json writes a colour: '#rrggbb', lower case, without alpha. */
export function rgb(colour: string): string {
  const hex = colour.slice(1).toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex.slice(0, 6)}`;
}
