import { freeOffer } from '@/core/free-offer';
import { inviteOnly } from '@/core/invite';
import { getSessionUser } from '@/core/session/session';
import { GalleryView, loadGallery } from '@/features/gallery';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('gallery');

export default async function GalleryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, getSessionUser()]);
  // A visitor in invite mode cannot sign up: the cards do not say Free.
  const offer = (await freeOffer(user)) && !(user === null && inviteOnly());
  return <GalleryView data={await loadGallery(params, user, offer)} />;
}
