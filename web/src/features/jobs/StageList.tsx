'use client';

import { useId, type KeyboardEvent } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import type { JobStep, StepStatus } from '@/data/ports';
import { cx } from '@/shared/lib/cx';
import { Icon } from '@/shared/ui';
import { OUTPUT_VIEWS, type OutputView } from './output';
import { inDisplayOrder, sharedImages, stateText, stepText } from './steps';

const MARK: Record<StepStatus, string> = {
  done: 'rounded-full border-accent bg-accent text-on-accent',
  running: 'rounded-full border-accent-text text-accent-text',
  waiting: 'rounded-full border-dashed border-edge-strong text-text-3',
  stopped: 'rounded-8 border-warn text-warn',
};
const STATE: Record<StepStatus, string> = { done: 'text-accent-text', running: 'text-accent-text', waiting: 'text-text-3', stopped: 'text-warn' };

/**
 * What pressing a stage shows beside the list: `open` says which of Images, Clips and Music have something to show (the other stages never
 * do), `selected` is the one the panel shows (null when it shows a stage that has nothing yet), `panel` the id of the panel.
 */
export type StageOutputs = { open: Record<OutputView, boolean>; selected: OutputView | null; onSelect: (view: OutputView) => void; panel: string };

const ROW = 'flex flex-wrap items-center gap-x-4 gap-y-2 py-4';
const isOutput = (key: string): key is OutputView => (OUTPUT_VIEWS as readonly string[]).includes(key);

/** The six stages (`swap`: the three of a person swap, in its own words). Each shows its own status and count, as the runner reports them. With `outputs` the stages that have made something are tabs: pressing one shows it in the panel. */
export function StageList({ steps, outputs, swap = false }: { steps: JobStep[]; outputs?: StageOutputs; swap?: boolean }) {
  const t = useT();
  const base = useId();
  const shared = sharedImages(steps);
  const ordered = inDisplayOrder(steps, swap);
  const pressable = ordered.map((step) => step.key).filter((key): key is OutputView => isOutput(key) && outputs?.open[key] === true);
  const tabId = (key: string) => `${base}-tab-${key}`;
  // Arrow keys and Home / End move between the stages that can be pressed and choose the one they land on; the tab stop is the chosen one.
  const move = (event: KeyboardEvent, key: OutputView) => {
    const at = pressable.indexOf(key);
    const to = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: pressable.length - 1 }[event.key];
    if (to === undefined || !outputs) return;
    event.preventDefault();
    const next = pressable[(to + pressable.length) % pressable.length]!;
    outputs.onSelect(next);
    document.getElementById(tabId(next))?.focus();
  };
  const stop = outputs?.selected && pressable.includes(outputs.selected) ? outputs.selected : pressable[0];
  return (
    <ol
      aria-label={t('jobs.running.stages')}
      {...(pressable.length > 0 ? { role: 'tablist', 'aria-orientation': 'vertical' as const } : {})}
      className="m-0 flex min-w-0 flex-[1_1_420px] list-none flex-col p-0"
    >
      {ordered.map((step, index) => {
        const mark = (
          <span className={cx('box-border flex size-9 flex-none items-center justify-center border-[1.5px] text-15 font-semibold', MARK[step.status])}>
            {step.status === 'done' ? <Icon name="done" size={18} strokeWidth={2.6} /> : index + 1}
          </span>
        );
        const text = (
          <span className="flex min-w-0 flex-[1_1_120px] flex-col gap-1 leading-[1.3]">
            <span id={`${base}-name-${step.key}`} className={cx('text-17 font-semibold', step.status === 'waiting' ? 'text-text-3' : 'text-text')}>{t(`${stepText(step.key, swap)}.name`)}</span>
            <span id={`${base}-note-${step.key}`} className="text-13 text-text-3">{step.key === 'images' && shared > 0 ? t('jobs.step.images.noteShared', { count: shared }) : t(`${stepText(step.key, swap)}.note`)}</span>
          </span>
        );
        const state = <span id={`${base}-state-${step.key}`} className={cx('text-15 font-semibold whitespace-nowrap', STATE[step.status])}>{stateText(step, t)}</span>;
        const bar = step.status === 'running' && (
          <span aria-hidden="true" className="flex h-1.5 basis-full overflow-hidden rounded-full bg-line">
            <span className="rounded-full bg-accent-text" style={{ width: `${Math.round((step.done / step.total) * 100)}%` }} />
          </span>
        );
        if (outputs && isOutput(step.key) && outputs.open[step.key]) {
          const key = step.key;
          const chosen = outputs.selected === key;
          return (
            <li key={key} role="presentation" className="border-t border-line">
              <button
                type="button"
                role="tab"
                id={tabId(key)}
                aria-selected={chosen}
                aria-controls={outputs.panel}
                aria-labelledby={`${base}-name-${key}`}
                aria-describedby={`${base}-note-${key} ${base}-state-${key}`}
                tabIndex={stop === key ? 0 : -1}
                onClick={() => outputs.onSelect(key)}
                onKeyDown={(event) => move(event, key)}
                className={cx(ROW, 'm-0 box-border w-full cursor-pointer rounded-12 border-0 px-3 text-left font-[inherit] text-[inherit]', chosen ? 'bg-raised' : 'bg-transparent hover:bg-raised')}
              >
                {mark}
                {text}
                {state}
                <span className={cx('flex-none', chosen ? 'text-accent-text' : 'text-text-3')}><Icon name="forward" size={18} /></span>
                {bar}
              </button>
            </li>
          );
        }
        return (
          <li key={step.key} role={pressable.length > 0 ? 'presentation' : undefined} className="border-t border-line">
            <div className={cx(ROW, outputs && 'px-3')}>
              {mark}
              {text}
              {state}
              {bar}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
