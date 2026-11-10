'use client';

import { useActionState, useRef, useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import type { Translate } from '@/core/i18n/types';
import type { Shot, Template } from '@/data/ports';
import { cx } from '@/shared/lib/cx';
import { keepControlledValues } from '@/shared/lib/form';
import { Button, Field, Icon, Input, Select } from '@/shared/ui';
import { hideTemplate, saveTemplate, type SaveState } from './actions';
import { formatName } from '@/shared/lib/format';
import { secLabel } from './labels';
import { ConfirmDialog } from './ConfirmDialog';
import { ShotEditor } from './ShotEditor';

const IDLE: SaveState = { status: 'idle', errors: {} };
type Visibility = 'published' | 'hidden' | '';

function Choice({ on, disabled, onClick, children }: { on: boolean; disabled?: boolean; onClick?: () => void; children: string }) {
  return (
    <button
      type="button" aria-pressed={on} disabled={disabled} onClick={onClick}
      className={cx(
        'box-border flex min-h-13 flex-1 cursor-pointer items-center justify-between gap-2 rounded-12 border bg-bg px-4 text-left text-15 text-text disabled:cursor-default',
        on ? 'border-[1.5px] border-accent-text font-semibold' : 'border-line font-normal text-text-2',
      )}
    >
      {children}
      {on && <span className="text-accent-text"><Icon name="done" size={20} /></span>}
    </button>
  );
}

const shotError = (t: Translate, errors: SaveState['errors']) =>
  errors.shots ? t(`adminTemplates.edit.error.shots.${errors.shots.code}`, { n: errors.shots.n }) : undefined;

/** The confirmation of the last action that worked. The page keeps it: the editor itself restarts when the changed template comes back. */
export type EditNotice = 'saved' | 'hidden' | null;

/** Details + shot list as ONE form with client state. "Discard changes" resets it; "Hide template" is a second form tied to its own button. */
export function TemplateEditor({
  template, categories, notice, onNotice,
}: {
  template: Template;
  categories: string[];
  notice: EditNotice;
  onNotice: (notice: EditNotice) => void;
}) {
  const t = useT();
  const initialVisibility: Visibility = template.status === 'published' || template.status === 'hidden' ? template.status : '';
  const [state, action, pending] = useActionState(async (previous: SaveState, form: FormData) => {
    const result = await saveTemplate(previous, form);
    onNotice(result.status === 'saved' ? 'saved' : null);
    return result;
  }, IDLE);
  const [hideState, hideAction, hiding] = useActionState(async (previous: SaveState, form: FormData) => {
    const result = await hideTemplate(previous, form);
    onNotice(result.status === 'hidden' ? 'hidden' : null);
    return result;
  }, IDLE);
  const [title, setTitle] = useState(template.title);
  const [category, setCategory] = useState(template.category);
  const [products, setProducts] = useState(String(template.products));
  const [visibility, setVisibility] = useState<Visibility>(initialVisibility);
  const [drafts, setDrafts] = useState<Shot[]>(template.shots);
  const reset = () => {
    setTitle(template.title);
    setCategory(template.category);
    setProducts(String(template.products));
    setVisibility(initialVisibility);
    setDrafts(template.shots);
  };
  const shots = drafts;
  const hideForm = useRef<HTMLFormElement>(null);
  const [asking, setAsking] = useState(false);
  const options = categories.includes(category) || category === '' ? categories : [category, ...categories];
  const errors = state.errors;
  const productCount = Math.max(1, Math.min(8, Number(products) || 1));
  const shotMessage = shotError(t, errors);
  const length = secLabel(t, template.seconds);
  // A template whose shots changed after its sample was made cannot be published until a new sample is ready (B11); the server refuses it too.
  const outdated = template.sample === 'outdated';
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <form id="hide-form" ref={hideForm} action={hideAction} className="hidden">
        <input type="hidden" name="id" value={template.id} />
      </form>
      {/* Every field is controlled: without `keepControlledValues` a refused save puts the category select back on the old category. */}
      <form ref={keepControlledValues} action={action} noValidate className="flex min-w-0 flex-col gap-6">
        <input type="hidden" name="id" value={template.id} />
        <input type="hidden" name="visibility" value={visibility} />
        <input type="hidden" name="shots" value={JSON.stringify(shots.map(({ from, to, action: a, text, product }) => ({ from, to, action: a, text, product })))} />
        <section aria-labelledby="h-details" className="flex flex-col gap-4">
          <h2 id="h-details" className="m-0 heading-6">{t('adminTemplates.edit.details')}</h2>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-16 border border-line bg-surface p-6 nav:grid-cols-2">
            <Field label={t('adminTemplates.edit.title')} error={errors.title ? t('adminTemplates.edit.error.title') : undefined}>
              <Input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            </Field>
            <Field label={t('adminTemplates.edit.category')} error={errors.category ? t('adminTemplates.edit.error.category') : undefined}>
              <Select name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
                {category === '' && <option value="">{t('adminTemplates.edit.chooseCategory')}</option>}
                {options.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <div role="group" aria-labelledby="l-format" className="flex flex-col gap-1.5">
              <span id="l-format" className="text-15 text-text-2">{t('adminTemplates.edit.format')}</span>
              <div className="flex gap-3">
                <Choice on={template.format === 'no-talking'} disabled>{formatName('no-talking', t)}</Choice>
                <Choice on={template.format === 'talking'} disabled>{formatName('talking', t)}</Choice>
              </div>
            </div>
            <div role="group" aria-labelledby="l-visibility" className="flex flex-col gap-1.5">
              <span id="l-visibility" className="text-15 text-text-2">{t('adminTemplates.edit.visibility')}</span>
              {template.status === 'private' ? (
                <p className="m-0 text-15 leading-snug text-text-2">{t('adminTemplates.edit.privateNote')}</p>
              ) : (
                <div className="flex gap-3">
                  <Choice on={visibility === 'published'} disabled={outdated} onClick={() => setVisibility('published')}>{t('adminTemplates.status.published')}</Choice>
                  <Choice on={visibility === 'hidden'} onClick={() => setVisibility('hidden')}>{t('adminTemplates.status.hidden')}</Choice>
                </div>
              )}
            </div>
            <Field label={t('adminTemplates.edit.length')} hint={t('adminTemplates.edit.lengthNote')}>
              <Input value={length} readOnly className="border-dashed border-line bg-transparent text-text-2" />
            </Field>
            <Field label={t('adminTemplates.edit.products')} hint={t('adminTemplates.edit.productsNote')} error={errors.products ? t('adminTemplates.edit.error.products') : undefined}>
              <Input name="products" type="number" min={1} max={8} step={1} inputMode="numeric" value={products} onChange={(e) => setProducts(e.target.value)} />
            </Field>
          </div>
        </section>
        <section aria-labelledby="h-shots" className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="h-shots" className="m-0 heading-6">{t('adminTemplates.edit.shotList')}</h2>
            <span className="text-13 text-text-3">{t('adminTemplates.edit.shotCount', { count: drafts.length, length })}</span>
          </div>
          {shotMessage && <p role="alert" className="m-0 flex items-center gap-2 text-15 text-warn"><Icon name="warning" size={18} />{shotMessage}</p>}
          <ShotEditor drafts={drafts} onChange={setDrafts} seconds={template.seconds} products={productCount} errorRow={errors.shots?.n || undefined} />
        </section>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line pt-6 max-nav:flex-col max-nav:items-stretch">
          {outdated ? (
            <>
              <Button disabled className="max-nav:w-full">{t('adminTemplates.edit.publish')}</Button>
              <Button type="submit" variant="secondary" pending={pending} className="max-nav:w-full">{t('adminTemplates.edit.save')}</Button>
              <p className="m-0 min-w-0 flex-1 basis-60 text-13 leading-snug text-text-3 max-nav:flex-none max-nav:basis-auto">{t('adminTemplates.edit.publishNote')}</p>
            </>
          ) : (
            <>
              <Button type="submit" pending={pending} className="max-nav:w-full">{t('adminTemplates.edit.save')}</Button>
              <Button variant="secondary" className="max-nav:w-full" onClick={reset}>{t('adminTemplates.edit.discard')}</Button>
              <p className="m-0 min-w-0 flex-1 basis-60 text-13 leading-snug text-text-3 max-nav:flex-none max-nav:basis-auto">{t('adminTemplates.edit.applyNote')}</p>
              <Button variant="warn" pending={hiding} onClick={() => setAsking(true)} disabled={template.status === 'hidden' || template.status === 'private'} className="max-nav:w-full">{t('adminTemplates.edit.hide')}</Button>
            </>
          )}
        </div>
        <p role="status" className="m-0 text-15 text-accent-text empty:hidden">
          {notice === 'saved' ? t('adminTemplates.edit.saved') : notice === 'hidden' ? t('adminTemplates.edit.hidden') : ''}
        </p>
        {(errors.form || hideState.errors.form) && (
          <p role="alert" className="m-0 text-15 text-warn">
            {t(errors.form === 'transition' || hideState.errors.form === 'transition' ? 'adminTemplates.edit.error.transition' : 'adminTemplates.edit.error.failed')}
          </p>
        )}
      </form>
      <ConfirmDialog
        open={asking} title={t('adminTemplates.confirm.hide.title')} text={t('adminTemplates.confirm.hide.text')} confirmLabel={t('adminTemplates.edit.hide')}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          hideForm.current?.requestSubmit();
        }}
      />
    </div>
  );
}
