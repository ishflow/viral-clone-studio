import type { ReactNode } from 'react';

/** Page title block: h1 + lead on the left, actions (button, period Segmented) on the right. Below 900 px the actions take the full row under the title and stack full width. */
export function PageHead({ title, lead, actions }: { title: string; lead?: string; actions?: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 nav:flex-row nav:flex-wrap nav:items-end nav:justify-between nav:gap-x-12 nav:gap-y-6">
      <div className="flex min-w-0 nav:flex-[1_1_420px] flex-col gap-2">
        <h1 className="m-0 heading-3">{title}</h1>
        {lead && <p className="m-0 max-w-180 text-15 leading-normal text-text-2 text-pretty">{lead}</p>}
      </div>
      {actions && <div className="flex w-full min-w-0 flex-col gap-3 *:w-full *:min-w-0 nav:w-auto nav:flex-row nav:flex-wrap nav:items-center nav:*:w-auto">{actions}</div>}
    </section>
  );
}
