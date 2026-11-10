import { notFound, redirect } from 'next/navigation';
import { getI18n } from '@/core/i18n/server';
import { getBalanceLabel } from '@/core/session/balance';
import { data } from '@/data';
import { CompareView } from './CompareView';
import { BalanceNow } from './HeaderBalance';
import { loadJob } from './load';
import { pickVariant } from './steps';

/** `/jobs/[id]/compare`: only a finished job has something to compare. Reading the job can return credits, so the balance is read last (see `BalanceNow`). */
export async function CompareJobView({ id, variant: variantId }: { id: string; variant?: string }) {
  const { user, job, template } = await loadJob(id, `/jobs/${id}/compare`);
  if (job.status !== 'done' || job.variants.length === 0) redirect(`/jobs/${id}`);
  if (!template?.video) redirect(`/jobs/${id}`);   // no sample to compare with: a hidden template, or a template made from the customer's own video
  const variant = pickVariant(job.variants, variantId);
  if (!variant) notFound();
  const { t } = await getI18n();
  return (
    <>
      <CompareView
        jobId={id}
        title={job.templateTitle}
        seconds={template.seconds}
        shots={template.shots.map(({ n, from, to, action }) => ({ n, from, to, action }))}
        sample={{ image: template.image, video: template.video }}
        yours={{ image: variant.image, video: variant.video }}
      />
      <BalanceNow label={await getBalanceLabel((await data.auth.getUser(user.id)) ?? user, t)} />
    </>
  );
}
