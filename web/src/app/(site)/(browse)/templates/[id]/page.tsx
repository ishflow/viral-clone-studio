import { notFound } from 'next/navigation';
import { freeOffer } from '@/core/free-offer';
import { getSessionUser } from '@/core/session/session';
import { data } from '@/data';
import { freeApplies, loadTemplate, TemplateDetail } from '@/features/gallery';
import { recordTitle } from '@/core/i18n/page-title';

export const generateMetadata = async ({ params }: { params: Promise<{ id: string }> }) =>
  recordTitle('template', async (viewer) => loadTemplate((await params).id, viewer?.id));

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  const template = await loadTemplate(id, user?.id);
  if (!template) notFound();
  // A talking template says what it costs; the free video never covers it. The rate card is the table the estimator uses.
  const talkingCredits = template.format === 'talking' ? (await data.payments.rates()).perVideo.talking.fast : null;
  // B1: `Free with your first video` only while a free video on this template would start now, as the estimate says. A template
  // that cannot be asked about keeps the line.
  const free = freeApplies(template, await freeOffer(user)) && await data.jobs.freeVideoOpen(template.id).catch(() => true);
  return <TemplateDetail template={template} free={free} talkingCredits={talkingCredits} />;
}
