import { freeOffer } from '@/core/free-offer';
import { getSessionUser } from '@/core/session/session';
import { inviteOnly } from '@/core/invite';
import { data } from '@/data';
import { HomeView } from '@/features/marketing/HomeView';
import { shareMetadata } from '@/features/marketing/share';

export const generateMetadata = () => shareMetadata('home');

export default async function HomePage() {
  const [templates, user] = await Promise.all([data.catalog.list({}), getSessionUser()]);
  // A visitor in invite mode cannot sign up: the page asks for an invite instead of offering the free video.
  return <HomeView images={templates.map((tpl) => tpl.image).filter(Boolean)} freeOffer={await freeOffer(user)} invite={user === null && inviteOnly()} />;
}
