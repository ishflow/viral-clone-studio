import type { Id, User } from './ports';

// What the site makes of a job (the first frame of a shot, its clip, the music, a picture every shot shares) is made of the customer's own
// photographs. Only the job's owner and the admins see it, and only while the job's pictures are kept; this one rule serves the job's data
// (`sqlite-engine`) and `/media`. A file is the job's to show when the job's own `operations` row names it as a finished output of those
// kinds: its name has no say. The spoken voice, and any file no such row names (an intermediate copy, a provider's answer), is not served.

/** The kinds of finished request whose file is shown to the job's owner. */
export const SERVED_KINDS = ['image', 'clip', 'music'] as const;

/** Is this path under the data directory a plain file of the run's own `paid/v<k>/` folder (`jobs/<runId>/paid/v2/<file>`)? Where an output is looked up, not what it is called. */
export const isJobFile = (runId: string, file: unknown): file is string =>
  typeof file === 'string' && file.startsWith(`jobs/${runId}/`) && /^paid\/v[1-9]\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(file.slice(`jobs/${runId}/`.length));

/** May this viewer see the files made for a job that belongs to `ownerId`? */
export const seesJobFrames = (ownerId: Id, viewer: Pick<User, 'id' | 'role'> | null | undefined): boolean =>
  viewer?.role === 'admin' || (viewer != null && viewer.id === ownerId);
