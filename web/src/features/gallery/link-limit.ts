import type { Id, SourceRange, Template } from '@/data/ports';

/** Security review I1: a user may not queue unlimited downloads. These are the numbers (named, so a change is one line). */
export const MAX_PREPARING_LINKS = 3;
export const MAX_PRIVATE_TEMPLATES = 20;

export type LinkRefusal = 'duplicate' | 'too-many-preparing' | 'limit';

/**
 * One name for one video: `www.` / `m.` and the query noise of a share link are dropped, a YouTube video has one form whatever
 * the link style (`youtu.be/ID`, `watch?v=ID`, `shorts/ID`). The input is a link `parseVideoLink` accepted.
 */
export function normalizeLink(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return link.trim().toLowerCase();
  }
  const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
  const path = url.pathname.replace(/\/+$/, '');
  if (host === 'youtu.be') return `youtube:${path.slice(1)}`;
  if (host === 'youtube.com') {
    const shorts = /^\/(?:shorts|embed|live)\/([^/]+)$/.exec(path);
    const id = shorts ? shorts[1] : path === '/watch' ? url.searchParams.get('v') : null;
    if (id) return `youtube:${id}`;
  }
  return `${host}${path}`;
}

/**
 * The links a user added in this process, by template id. A `Template` carries no source link (finding in the report), so this is
 * what tells "the same video again" once the template has its real title; a restart forgets it, and the title of a template that is
 * still preparing (the link itself in the real engine) covers that case. Entries of a template that is gone are ignored.
 */
const globals = globalThis as typeof globalThis & { __vcAddedLinks?: Map<Id, Map<Id, string>> };   // survives a dev hot reload, like the fake store
const added = (globals.__vcAddedLinks ??= new Map<Id, Map<Id, string>>());

/** The name of one video as the customer added it: the link, and the part picked of it (another part is another video). */
const identityOf = (link: string, range?: SourceRange): string => (range ? `${normalizeLink(link)}@${range.from}-${range.to}` : normalizeLink(link));

export function rememberLink(userId: Id, templateId: Id, link: string, range?: SourceRange): void {
  const own = added.get(userId) ?? new Map<Id, string>();
  own.set(templateId, identityOf(link, range));
  added.set(userId, own);
}

/**
 * The refusal for adding `link`, or null. `list` is the user's own private templates. `parts` is the part of its video each template
 * was prepared with, as far as the engine keeps it (`catalog.sourceParts`): it is what tells two parts of one link apart after a restart.
 */
export function linkRefusal(userId: Id, link: string, list: readonly Template[], range?: SourceRange, parts?: ReadonlyMap<Id, SourceRange | null>): LinkRefusal | null {
  const mine = list.filter((template) => template.status === 'private' && template.ownerId === userId);
  const live = mine.filter((template) => template.preparation !== 'failed');   // a failed one was refunded: it does not block the same link
  const wanted = identityOf(link, range);
  const known = added.get(userId);
  // A preparing template known only by its title (after a restart) is named by its title and the part the engine says it was given;
  // when the engine does not say, its part is unknown and it blocks the link only when no part is picked.
  const sameAfterRestart = (template: Template): boolean => {
    if (known?.has(template.id) || template.preparation !== 'preparing') return false;
    const part = parts?.get(template.id);
    return part === undefined ? !range && normalizeLink(template.title) === wanted : identityOf(template.title, part ?? undefined) === wanted;
  };
  const same = live.some((template) => known?.get(template.id) === wanted || sameAfterRestart(template));
  if (same) return 'duplicate';
  if (mine.filter((template) => template.preparation === 'preparing').length >= MAX_PREPARING_LINKS) return 'too-many-preparing';
  if (mine.length >= MAX_PRIVATE_TEMPLATES) return 'limit';
  return null;
}

const chains = new Map<Id, Promise<unknown>>();

/** Runs `task` after the earlier tasks of the same user: the check and the add of two parallel calls cannot interleave. */
export function serialPerUser<T>(userId: Id, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(userId) ?? Promise.resolve();
  const result = previous.then(task, task);
  const tail = result.catch(() => undefined);
  chains.set(userId, tail);
  void tail.then(() => {
    if (chains.get(userId) === tail) chains.delete(userId);
  });
  return result;
}

/** For tests: forget the remembered links. */
export function resetLinkLimit(): void {
  added.clear();
  chains.clear();
}
