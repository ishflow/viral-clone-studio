import type { Metadata } from 'next';
import { getSessionUser } from '@/core/session/session';
import type { User } from '@/data/ports';
import { getI18n } from './server';

/** The tab title of a page, in the visitor's language: `export const generateMetadata = () => pageTitle('pricing')`. */
export async function pageTitle(key: string): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t(`titles.${key}`) };
}

/**
 * The title of a page about one record (`/jobs/<id>`): the page's own while the record is there, "Page not found" when `find` says it
 * is not (the page answers 404 and the tab must agree). `find` gets the signed-in viewer (null signed out; the page sends that
 * visitor to log in, so there is nothing to look up) and returns what the page itself would read. A lookup that fails keeps the
 * page's title: the page reads the record again and gives its own answer.
 */
export async function recordTitle(key: string, find: (viewer: User | null) => Promise<unknown>): Promise<Metadata> {
  const found = await getSessionUser().then(find).catch(() => true);
  return pageTitle(found ? key : 'notFound');
}
