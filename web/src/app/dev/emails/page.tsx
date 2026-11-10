import { notFound } from 'next/navigation';
import Link from 'next/link';
import { data } from '@/data';
import { EMAIL_NAMES, OutboxList } from '@/features/emails';
import { devOnly } from '../dev-only';

export const metadata = { title: 'Emails' };
export const dynamic = 'force-dynamic';

export default async function EmailsPage() {
  devOnly();
  if(process.env.VC_MAIL==='resend')notFound();
  const outbox = await data.mailer.outbox();
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8 px-4 py-12">
      <h1 className="heading-4 m-0">Emails</h1>
      <section className="flex flex-col gap-3">
        <h2 className="heading-6 m-0">Static previews</h2>
        <ul className="m-0 flex list-none flex-wrap gap-4 p-0">
          {EMAIL_NAMES.map((name) => (
            <li key={name}>
              <Link href={`/dev/emails/${name}`} className="inline-flex min-h-11 items-center font-semibold text-accent-text hover:text-text">
                {name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="heading-6 m-0">Outbox (newest first)</h2>
        <OutboxList emails={outbox} />
      </section>
    </div>
  );
}
