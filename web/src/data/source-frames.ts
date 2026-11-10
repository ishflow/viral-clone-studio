import type { Id, Template, User } from './ports';

// The source video itself (`reference.mp4`, with its first picture `reference.jpg`) and the frames taken from it (one per shot; the poster
// of a customer's own template) show somebody else's face and footage. Only the template's owner and the admins see them; this one rule
// serves the page data (`catalog`) and `/media`. What the site made itself of a catalog template (its sample poster and video) is not
// a source frame and stays public.

/** May this viewer see the source frames of a template that belongs to `ownerId` (null: the catalog's)? */
export const seesSourceFrames = (ownerId: Id | null, viewer: Pick<User, 'id' | 'role'> | null | undefined): boolean =>
  viewer?.role === 'admin' || (viewer != null && ownerId !== null && ownerId === viewer.id);

/** Is this file of a template folder (`poster.jpg`, `shots/<n>.jpg`, `reference.mp4`, …) the source video or a frame of it? A catalog template's poster is its sample's. */
export const isSourceFrame = (name: string, owned: boolean): boolean =>
  /^shots\/[1-9]\d{0,2}\.jpg$/.test(name) || name === 'reference.jpg' || name === 'reference.mp4' || (owned && name === 'poster.jpg');

/** The template as a viewer who may not see its source frames gets it: the shots without their frames, a customer's poster blank (the dashed box), no source video and no first picture of it. */
export function withoutSourceFrames(template: Template): Template {
  return {
    ...template, image: template.ownerId === null ? template.image : '', referenceImage: null, referenceVideo: null,
    shots: template.shots.map(({ image: _frame, ...shot }) => shot),
  };
}
