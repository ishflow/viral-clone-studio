import { freeOffer } from '@/core/free-offer';
import { getI18n } from '@/core/i18n/server';
import { requireUser } from '@/core/session/guards';
import { data } from '@/data';
import { WelcomeView } from './WelcomeView';

const CARDS = 5;

/**
 * `/welcome` (A-Karsilama): the first screen after the email is verified, with a row of templates the free video fits (no talking).
 * Signed out → login and back here; email not verified → /verify-email.
 */
export async function WelcomeScreen() {
  const user = await requireUser('/welcome');
  const { t } = await getI18n();
  const templates = (await data.catalog.list({ format: 'no-talking' })).slice(0, CARDS);
  const cards = templates.map((template) => ({
    id: template.id,
    title: template.title,
    image: template.image,
    video: template.video,
    seconds: template.seconds,
    meta: t('auth.welcome.meta', { category: template.category, views: template.referenceViews }),
  }));
  return <WelcomeView cards={cards} freeOffer={await freeOffer(user)} />;
}
