import { requireUser } from '@/core/session/guards';
import { AddVideoView, loadYourTemplates } from '@/features/gallery';
import { pageTitle } from '@/core/i18n/page-title';

export const generateMetadata = () => pageTitle('addVideo');

export default async function NewTemplatePage() {
  const user = await requireUser('/templates/new');
  return <AddVideoView templates={await loadYourTemplates(user.id)} draftKey={`vc:draft:add-video:${user.id}`} />;
}
