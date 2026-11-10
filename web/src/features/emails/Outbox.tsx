import Link from 'next/link';
import type { SentEmail } from '@/data/ports';
import { emailNameOf } from './build';

// Developer page: its own chrome is English only. Email cards themselves use messages.
export function OutboxList({ emails }: { emails: SentEmail[] }) {
  if (emails.length === 0) return <p className="m-0 text-15 text-text-2">Nothing sent yet.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {emails.map((email) => (
        <li key={email.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-12 border border-line bg-surface px-4 py-3 text-15">
          <span className="font-semibold">{email.kind}</span>
          <span className="min-w-0 [overflow-wrap:anywhere] text-text-2">{email.to}</span>
          <time dateTime={email.at} className="text-13 text-text-3">{email.at}</time>
          <Link href={`/dev/emails/${emailNameOf(email)}?id=${email.id}`} className="inline-flex min-h-11 items-center font-semibold text-accent-text hover:text-text">
            Preview
          </Link>
        </li>
      ))}
    </ul>
  );
}
