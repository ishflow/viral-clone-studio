import { getSessionUser } from '@/core/session/session';
import { data } from '@/data';
import { ContactView } from '@/features/marketing/ContactView';
import { pageTitle } from '@/core/i18n/page-title';

type Search = { topic?: string; job?: string };

export const generateMetadata = () => pageTitle('contact');

/** `/contact?topic=refund&job=<id>`: the other pages (account, payment, errors) link here with the topic and the job they are about. */
export default async function ContactPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { topic, job } = await searchParams;
  const user = await getSessionUser();
  const jobs = user ? await data.jobs.listFor(user.id) : [];
  const account = user ? { email: user.email, jobs: jobs.map((j) => ({ id: j.id, title: j.templateTitle, at: j.startedAt })) } : null;
  return <ContactView account={account} topic={topic} jobId={job} />;
}
