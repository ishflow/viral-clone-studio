'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { Email } from '@/shared/ui/Email';
import { ContactForm, type ContactAccount } from './ContactForm';

export function ContactView({ account = null, topic, jobId }: { account?: ContactAccount | null; topic?: string; jobId?: string }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-8 nav:gap-12">
      <section className="flex flex-col gap-3">
        <h1 className="heading-2">{t('marketing.contact.title')}</h1>
        <p className="max-w-155 text-17 leading-normal text-text-2 text-pretty">{t('marketing.contact.lead')}</p>
      </section>
      <div className="flex flex-wrap items-start gap-x-18 gap-y-8">
        <ContactForm account={account} topic={topic} jobId={jobId} />
        <aside aria-labelledby="h-quick" className="flex max-w-140 min-w-0 flex-[1_1_380px] flex-col gap-4">
          <h2 id="h-quick" className="heading-5">
            {t('marketing.contact.quickTitle')}
          </h2>
          <dl className="m-0 flex flex-col border-b border-line">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex flex-col gap-1 border-t border-line py-4">
                <dt className="text-17 leading-snug font-semibold">{t(`marketing.contact.quick.${n}.q`)}</dt>
                <dd className="m-0 text-15 leading-normal text-text-2 text-pretty">{t(`marketing.contact.quick.${n}.a`)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-15 leading-normal text-text-2">
            {t('marketing.contact.emailLead')}{' '}
            <Email address={t('marketing.contact.emailAddress')} link className="py-3 font-semibold no-underline" />
            .
          </p>
        </aside>
      </div>
    </div>
  );
}
