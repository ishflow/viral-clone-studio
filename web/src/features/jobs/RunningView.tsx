'use client';

import { useId, useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import type { Job } from '@/data/ports';
import { formatDuration } from '@/shared/lib/format';
import { StatusLine } from '@/shared/ui';
import { AutoRefresh } from './AutoRefresh';
import { JobNotice } from './JobNotice';
import { OutputPanel, type Box } from './OutputPanel';
import { autoView, viewsOf, type OutputView } from './output';
import { StageList } from './StageList';
import { leadOf, shotOf, shotPhase, stepOf } from './steps';

/** `openable: false`: the customer's page of this template is a 404 (hidden, or no longer visible to them), so nothing links to it. */
export type JobTemplate = { id: string; title: string; image: string; video: string | null; seconds: number; openable?: boolean; shotFrames?: string[] };

/** The template's own frame of shot `index`, when the template has one for each of the job's `total` shots; else nothing (an empty `src` makes the browser fetch the page again). */
function frameOf(template: JobTemplate, index: number, total: number): string | null {
  const frames = template.shotFrames;
  return (frames?.length === total ? frames[index] : null) || null;
}

/** The words above and under the panel, by the stage it shows. */
const TITLE: Record<OutputView, string> = { images: 'shotsTitle', clips: 'titleClips', music: 'titleMusic' };

/** What the note under the boxes explains, by what the boxes show: the made frames (sharp), the template's frames (faded), both, neither. */
function noteOf(boxes: { made: string | null; original: string | null }[]): string {
  const made = boxes.some((box) => box.made);
  const faded = boxes.some((box) => !box.made && box.original);
  return made ? (faded ? 'shotsNoteMadeFaded' : 'shotsNoteMade') : faded ? 'shotsNote' : 'shotsNoteBare';
}

/**
 * `A-Is-Takibi`: stages on the left, what the stage chosen has made on the right. Images, Clips and Music can be pressed once they have made
 * something (the others have nothing to show); until a stage is pressed the panel follows the job: the pictures as they come, then the clips.
 */
export function RunningView({ job, template, minutesLeft, elapsedSeconds }: { job: Job; template: JobTemplate; minutesLeft: number; elapsedSeconds: number }) {
  const t = useT();
  const clips = stepOf(job, 'clips');
  const boxes: Box[] = Array.from({ length: clips.total }, (_, index) => {
    const shot = shotOf(job, index);
    return { made: shot?.image ?? null, original: frameOf(template, index, clips.total), clipUrl: shot?.clipUrl ?? null, phase: shotPhase(job, index) };
  });
  const note = noteOf(boxes);
  const [chosen, setChosen] = useState<OutputView | null>(null);
  const panel = useId();
  const open = viewsOf(job);
  const view = chosen && open[chosen] ? chosen : autoView(job);
  // On a narrow screen the panel wraps under the list: a stage pressed there would seem to do nothing, so the page goes down to the panel.
  // Only the customer's own press does this; the panel following the job on its own never moves the page.
  const select = (next: OutputView) => {
    setChosen(next);
    const element = document.getElementById(panel);
    if (element && element.getBoundingClientRect().top >= window.innerHeight) element.scrollIntoView?.({ block: 'start' });
  };
  const made = job.made ?? { music: [], shared: [] };
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="flex flex-col gap-3">
          <StatusLine kind="running">{t('common.status.running')}</StatusLine>
          <h1 className="m-0 heading-3">{job.templateTitle}</h1>
          <p className="m-0 text-15 text-text-2">
            {leadOf(t, job, template.seconds)}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-13 text-text-3">{t('jobs.running.estimated')}</span>
          {job.delayed ? (
            <strong className="font-display text-24 font-bold text-text nav:text-32">{t('jobs.running.longer')}</strong>
          ) : (
            <p className="m-0 text-15 text-text-2">
              <strong className="font-display text-24 font-bold text-text nav:text-32">{t('jobs.running.left', { minutes: minutesLeft })}</strong>{' '}
              {t('jobs.running.rest', { elapsed: formatDuration(elapsedSeconds, t) })}
            </p>
          )}
        </div>
      </section>

      <AutoRefresh />
      {(job.delayed || job.paused) && (
        <div className="flex flex-col gap-3">
          {job.delayed && (
            <JobNotice tone="info" icon="clock">
              {t('jobs.notice.delayed')}
            </JobNotice>
          )}
          {job.paused && (
            <JobNotice tone="warn" icon="warning">
              {t('jobs.notice.paused')}
            </JobNotice>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-start gap-x-12 gap-y-8">
        <StageList steps={job.steps} swap={Boolean(job.swap)} outputs={{ open, selected: open[view] ? view : null, onSelect: select, panel }} />
        <section id={panel} role={open[view] ? 'tabpanel' : undefined} aria-label={open[view] ? t(`jobs.step.${view}.name`) : t('jobs.running.shots')} className="flex min-w-0 flex-[1_1_480px] flex-col gap-3">
          <h2 className="m-0 text-15 font-medium text-text-2">{t(`jobs.running.${TITLE[view]}`)}</h2>
          <OutputPanel view={view} boxes={boxes} made={made} round={job} onUse={() => setChosen(view)} />
          {view === 'music' ? (
            <p className="m-0 text-13 leading-normal text-text-3">{t('jobs.running.musicNote')}</p>
          ) : (
            <>
              <p className="m-0 text-13 leading-normal text-text-3">{t(`jobs.running.${view === 'images' ? 'hintImages' : 'hintClips'}`)}</p>
              <p className="m-0 text-13 leading-normal text-text-3">{t(`jobs.running.${note}`)}</p>
            </>
          )}
          <p className="m-0 text-13 leading-normal text-text-3">{t('jobs.running.note')}</p>
        </section>
      </div>
    </div>
  );
}
