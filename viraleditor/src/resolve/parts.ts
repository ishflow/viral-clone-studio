// What beats and speech build the same way: media keys, a text, the music.
import type { Audio, Edit, EditText, MediaKey } from '../edit/types.ts';
import type { FillJson, TemplateJson } from '../template/schema.ts';
import { placeholdersIn } from '../template/values.ts';
import { own, ResolveError } from './error.ts';
import type { ResolveMedia } from './index.ts';
import { pictureGiven } from './pictures.ts';

export type MediaTable = Edit['media'];
export interface Placed { at: number; for: number }

// Keys of Edit.media. Each kind has its own prefix, so an id of the template can never collide with another kind's key.
export const MUSIC_KEY: MediaKey = 'music';
const clipKey = (shotId: string): MediaKey => `clip-${shotId}`;
const imageKey = (ref: string): MediaKey => ref.replace(/[:.]/g, '-');          // 'product:1.2' → 'product-1-2', 'still:proof' → 'still-proof'

/** The fields that were given: a copied optional field never becomes a key holding `undefined`. */
export function given<T extends object>(fields: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

/** What every edit document of a template starts from. */
export function documentBase(template: TemplateJson, fill: FillJson): Pick<Edit, 'version' | 'language' | 'canvas' | 'safe' | 'styles'> {
  return { version: 1, language: fill.language, canvas: template.canvas, ...given({ safe: template.safe }), styles: template.styles };
}

/** The clip of a shot: registers it and gives its key and its length. */
export function clipOf(shotId: string, media: ResolveMedia, table: MediaTable): { key: MediaKey; frames: number } {
  const clip = own(media.clips, shotId);
  if (clip === undefined) throw new ResolveError('media-missing', `media.clips has no clip for shot "${shotId}"`);
  if (!Number.isInteger(clip.frames) || clip.frames < 1) throw new ResolveError('media-missing', `the clip of shot "${shotId}" has no frame count`);
  table[clipKey(shotId)] = { file: clip.file, kind: 'video' };
  return { key: clipKey(shotId), frames: clip.frames };
}

export interface Picture { key: MediaKey; file: string }

/**
 * The picture a card or a window names, for this customer. null when the customer did not give that product or that
 * photograph of it: the element is then left out (checkFill has said so in a note before anything was paid).
 * A picture the customer gave, or a still, that the run did not hand over is `media-missing`.
 */
export function pictureOf(ref: string, fill: FillJson, media: ResolveMedia): Picture | null {
  if (!pictureGiven(ref, fill)) return null;
  const file = own(media.images, ref);
  if (file === undefined) throw new ResolveError('media-missing', `media.images has no "${ref}"`);
  return { key: imageKey(ref), file };
}

/** Lists a picture that the document shows. */
export function listed(picture: Picture, table: MediaTable): MediaKey {
  table[picture.key] = { file: picture.file, kind: 'image' };
  return picture.key;
}

/** A text of the template with the fill's copy. Only the fill's copy is used: never the template's pattern or the reference's text. */
export function textOf(text: TemplateJson['texts'][number], fill: FillJson, placed: Placed): EditText {
  const copy = own(fill.texts, text.id);
  if (copy === undefined) throw new ResolveError('fill-missing', `the fill has no texts.${text.id}`);
  const [left] = placeholdersIn(copy);
  if (left !== undefined) throw new ResolveError(`unfilled:${left}`, `texts.${text.id} still holds the placeholder {${left}}`);
  return { id: text.id, at: placed.at, for: placed.for, box: text.box, style: text.style, copy, ...given({ lines: text.lines, enter: text.enter, exit: text.exit }) };
}

/** Under a voice the music is at most this loud unless the template says otherwise (the level the motion spike ducked to; the lashly production ran at 0.1). */
const MUSIC_UNDER_VOICE = 0.15;

/** The music bed, when there is a file for it. In a speech video it goes down under the talking clips (design §8) unless the template gives its own ducking. */
export function audioOf(template: TemplateJson, media: ResolveMedia, table: MediaTable): { audio?: Audio } {
  if (media.music === null) return {};
  table[MUSIC_KEY] = { file: media.music.file, kind: 'audio' };
  const { gain, fadeOut } = template.audio.music;
  const duck = template.audio.music.duck ?? (template.mode === 'speech' ? { to: Math.min(gain, MUSIC_UNDER_VOICE), under: 'sound' as const } : undefined);
  return { audio: { music: { media: MUSIC_KEY, gain, ...given({ duck, fadeOut }) } } };
}
