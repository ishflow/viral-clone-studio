'use client';

import Link from 'next/link';
import { useT } from '@/core/i18n/I18nProvider';
import { Icon, LinkButton } from '@/shared/ui';
import type { GenerateTemplate } from './GenerateForm';

/** Shown instead of the form while the customer's own template is being prepared, or when it did not fit (`failed`: it never will be ready). */
export function GenerateNotReady({ template, failed }: { template: Pick<GenerateTemplate, 'id' | 'title'>; failed: boolean }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/templates/${template.id}`} className="flex min-h-11 items-center gap-2 self-start text-15 text-text-3 no-underline hover:text-text">
        <Icon name="back" size={18} />
        {template.title}
      </Link>
      <p role="alert" className="m-0 text-17 text-text-2">
        {t(failed ? 'generate.error.failed' : 'generate.error.notReady')}
      </p>
      {failed && (
        <LinkButton href="/templates/new" className="self-start">
          {t('generate.error.addAnother')}
        </LinkButton>
      )}
    </div>
  );
}
