'use client';

import { useActionState, useRef, useState, type PointerEvent } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import type { Template } from '@/data/ports';
import { RULES } from '@/data/ports';
import { cx } from '@/shared/lib/cx';
import { Button, Field, Icon, Input, MediaImage } from '@/shared/ui';
import { PublishBar, type PublishBlock } from './PublishBar';
import { saveSwapPeople, type SwapPeopleState } from './swap-actions';
import { boxBetween, boxOf, draftsOf, payloadOf, pointIn, SECOND_PERSON, type PersonDraft } from './swap-people';

const IDLE: SwapPeopleState = { status: 'idle' };
const SIDES = ['left', 'top', 'right', 'bottom'] as const;

/** The picture of the video with a box on it for each person; a drag on the picture draws the box of the chosen person. */
function Frame({ template, drafts, active, onDraw }: { template: Template; drafts: PersonDraft[]; active: number; onDraw: (box: ReturnType<typeof boxBetween>) => void }) {
  const t = useT();
  const start = useRef<{ x: number; y: number } | null>(null);
  const move = (event: PointerEvent<HTMLDivElement>, end: boolean) => {
    const from = start.current;
    const to = pointIn(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
    if (end) start.current = null;
    if (from && to) onDraw(boxBetween(from, to));
  };
  const src = template.image || template.referenceImage;
  return (
    <div
      data-testid="frame" role="group" aria-label={t('adminTemplates.swap.edit.frame')}
      onPointerDown={(event) => {
        start.current = pointIn(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => move(event, false)}
      onPointerUp={(event) => move(event, true)}
      onPointerCancel={() => { start.current = null; }}
      className="relative aspect-[9/16] w-full max-w-75 cursor-crosshair touch-none overflow-hidden rounded-16 bg-raised select-none"
    >
      {template.image ? <MediaImage src={template.image} alt={t('adminTemplates.swap.edit.frameAlt')} fill sizes="300px" draggable={false} className="pointer-events-none object-cover" />
        : src ? <img src={src} alt={t('adminTemplates.swap.edit.frameAlt')} draggable={false} className="pointer-events-none size-full object-cover" />
        : <span className="flex size-full items-center justify-center p-3 text-center text-13 text-text-3">{t('adminTemplates.swap.edit.noFrame')}</span>}
      {drafts.map((draft, index) => {
        const box = boxOf(draft);
        return box && (
          <span
            key={index} data-testid={`box-${index + 1}`}
            style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.right - box.left}%`, height: `${box.bottom - box.top}%` }}
            className={cx('pointer-events-none absolute box-border border-accent-text', index === active ? 'border-[3px]' : 'border', 'bg-accent-text/10')}
          >
            <span className="absolute top-0 left-0 bg-accent-text px-1.5 text-13 font-semibold text-bg">{index + 1}</span>
          </span>
        );
      })}
    </div>
  );
}

/** The people of a person-swap video: the picture with their boxes, the box and the words of each, and "Save people". */
export function PeopleEditor({ template }: { template: Template }) {
  const t = useT();
  const [drafts, setDrafts] = useState<PersonDraft[]>(() => draftsOf(template));
  const [kept, setKept] = useState(() => JSON.stringify(payloadOf(drafts)));
  const [state, action, pending] = useActionState(async (previous: SwapPeopleState, form: FormData) => {
    const result = await saveSwapPeople(previous, form);
    if (result.status === 'saved') setKept(String(form.get('persons')));
    return result;
  }, IDLE);
  const [active, setActive] = useState(0);
  const patch = (index: number, change: Partial<PersonDraft>) => setDrafts((all) => all.map((draft, i) => (i === index ? { ...draft, ...change } : draft)));
  const limit = { max: RULES.swapHintMax };
  const written = state.status === 'saved' ? (state.pending ? 'pending' : 'saved') : template.swapPeople === 'pending' ? 'pending' : null;
  const second = drafts.length < RULES.swapPeopleMax;
  // What the page says is not yet in the video: fields that were changed after the last save, or people the worker has not written.
  const saved = state.status === 'saved';
  const blocked: PublishBlock = JSON.stringify(payloadOf(drafts)) !== kept ? 'dirty'
    : saved ? (state.pending ? 'pending' : null) : template.swapPeople ?? null;
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-8 nav:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <Frame template={template} drafts={drafts} active={active} onDraw={(box) => box && patch(active, box)} />
        <p className="m-0 text-13 leading-snug text-text-3">{t('adminTemplates.swap.edit.frameHint')}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <form action={action} noValidate className="flex min-w-0 flex-col gap-6">
          <input type="hidden" name="id" value={template.id} />
          <input type="hidden" name="persons" value={JSON.stringify(payloadOf(drafts))} />
          <h2 className="m-0 heading-6">{t('adminTemplates.swap.edit.people')}</h2>
          {template.swapPeople === 'unset' && state.status !== 'saved' && (
            <p role="status" className="m-0 flex items-start gap-2 text-15 leading-normal text-text">
              <span className="mt-0.5 text-warn"><Icon name="warning" size={18} /></span>
              {t('adminTemplates.swap.edit.unset')}
            </p>
          )}
          {drafts.length > 1 && (
            <div role="radiogroup" aria-label={t('adminTemplates.swap.edit.drawFor')} className="flex flex-wrap items-center gap-4 text-15 text-text-2">
              {t('adminTemplates.swap.edit.drawFor')}
              {drafts.map((_, index) => (
                <label key={index} className="flex min-h-11 cursor-pointer items-center gap-2">
                  <input type="radio" name="draw-for" checked={active === index} onChange={() => setActive(index)} />
                  {t('adminTemplates.swap.edit.person', { n: index + 1 })}
                </label>
              ))}
            </div>
          )}
          {drafts.map((draft, index) => (
            <fieldset key={index} className="m-0 flex min-w-0 flex-col gap-4 rounded-16 border border-line bg-surface p-6">
              <legend className="px-2 text-15 font-semibold text-text">{t('adminTemplates.swap.edit.person', { n: index + 1 })}</legend>
              <div className="grid grid-cols-2 gap-4 nav:grid-cols-4">
                {SIDES.map((side) => (
                  <Field key={side} label={t(`adminTemplates.swap.edit.${side}`)}>
                    <Input type="number" min={0} max={100} step={0.1} inputMode="decimal" value={draft[side]} onChange={(event) => patch(index, { [side]: event.target.value })} />
                  </Field>
                ))}
              </div>
              <p className="m-0 -mt-2 text-13 text-text-3">{t('adminTemplates.swap.edit.boxNote')}</p>
              <Field label={t('adminTemplates.swap.edit.hint')} hint={t('adminTemplates.swap.edit.hintNote', limit)}>
                <Input value={draft.hint} maxLength={RULES.swapHintMax} placeholder={t('adminTemplates.swap.edit.hintPlaceholder')} onChange={(event) => patch(index, { hint: event.target.value })} />
              </Field>
            </fieldset>
          ))}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 max-nav:flex-col max-nav:items-stretch">
            <Button type="submit" pending={pending} className="max-nav:w-full">{t('adminTemplates.swap.edit.save')}</Button>
            {second && <Button variant="secondary" className="gap-2 max-nav:w-full" onClick={() => setDrafts((all) => [...all, SECOND_PERSON])}><Icon name="add" size={20} />{t('adminTemplates.swap.edit.addPerson')}</Button>}
            {!second && <Button variant="secondary" className="max-nav:w-full" onClick={() => { setDrafts((all) => all.slice(0, 1)); setActive(0); }}>{t('adminTemplates.swap.edit.removePerson')}</Button>}
          </div>
          <p role="status" className="m-0 text-15 leading-normal text-accent-text empty:hidden">{written ? t(`adminTemplates.swap.edit.${written}`) : ''}</p>
          {state.status === 'error' && <p role="alert" className="m-0 text-15 text-warn">{t(`adminTemplates.swap.edit.error.${state.error}`, limit)}</p>}
        </form>
        <PublishBar template={template} blocked={blocked} />
      </div>
    </div>
  );
}
