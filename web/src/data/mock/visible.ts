import { engine } from '../engine';
import type { Id, Template } from '../ports';
import { seesSourceFrames, withoutSourceFrames } from '../source-frames';
import { findUser } from './store';

/**
 * A customer sees the published templates and their own private ones, whatever their state of preparation.
 * Waiting and hidden templates are for the admin only.
 */
export function visibleTo(template: Template, viewerId?: Id): boolean {
  return template.status === 'published' || (template.status === 'private' && viewerId !== undefined && template.ownerId === viewerId);
}

/** The template as this viewer is given it: the frames of its source video only for its owner and the admins. */
export function shownTo(template: Template, viewerId?: Id): Template {
  return seesSourceFrames(template.ownerId, viewerId === undefined ? null : findUser(viewerId)) ? template : withoutSourceFrames(template);
}

/** The template, if this viewer may see it. The catalog and the job runner use it. */
export function visibleTemplate(id: Id, viewerId?: Id): Template | undefined {
  const template = engine().template(id);
  return template && visibleTo(template, viewerId) ? shownTo(template, viewerId) : undefined;
}
