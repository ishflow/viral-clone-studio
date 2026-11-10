'use client';

import Link from 'next/link';
import { unstable_rethrow, useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { RULES, type Estimate, type Outfit } from '@/data/ports';
import { formatCredits, formatDuration } from '@/shared/lib/format';
import { Button, Icon } from '@/shared/ui';
import { confirmSwap, estimateSwap, findStartedSwap, uploadPersonPhoto, type SwapOutcome } from './actions';
import type { SwapVideo } from './load';
import { measurePicture } from './measure';
import { PHOTO_KINDS, PHOTO_TYPES, fileProblem, pictureProblem, type PhotoKind } from './photo-check';
import { SwapConfirmDialog, type SwapConfirmChange, type SwapConfirmPhase } from './SwapConfirmDialog';

/** A picked photograph: its local preview and its upload. `path` is what the server stored, and what the form sends. */
type Picked = { name: string; url: string; path: string | null };
/** A photograph that was not taken, named in a line under its box. */
type Refusal = { key: 'type' | 'size' | 'small' | 'landscape' | 'quota' | 'unreadable' | 'failed'; name: string };
type Photos = Record<PhotoKind, Picked | null>;
type ErrorCode = Extract<SwapOutcome, { status: 'error' }>['code'];
type DialogState = { key: string; phase: SwapConfirmPhase; estimate: Estimate | null; change: SwapConfirmChange | null };

const CONSENTS = ['ownPerson', 'adults', 'notCelebrity'] as const;
const OUTFITS = ['keep', 'photo'] as const satisfies readonly Outfit[];
const TIPS = ['one', 'light', 'frame', 'clothes'] as const;
const ACCEPT = PHOTO_TYPES.join(',');
const NO_PHOTOS: Record<PhotoKind, null> = { body: null, face: null, side: null };
const ALERT = 'm-0 flex items-start gap-3 rounded-12 border border-warn-edge bg-surface px-4 py-3 text-15 leading-normal text-text';
const WARN = 'm-0 flex items-start gap-2 text-13 leading-snug text-warn';
const FRAME = 'relative w-14 flex-none aspect-[9/16] overflow-hidden rounded-8 shadow-[0_0_0_1px_var(--media-edge)] nav:w-full nav:rounded-16';
const THUMB_ACTION = 'flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-13 font-medium text-text-2 hover:text-text';

/** One photograph of the person: the box to pick it, its preview once picked, and the reason when it was not taken. */
function PhotoField({ kind, value, refusal, rulesId, onPick, onRemove }: { kind: PhotoKind; value: Picked | null; refusal: Refusal | null; rulesId: string; onPick: (file: File) => void; onRemove: () => void }) {
  const t = useT();
  const errorId = useId();
  const input = (label: string) => (
    <input
      type="file"
      accept={ACCEPT}
      aria-label={label}
      aria-invalid={refusal ? true : undefined}
      aria-describedby={refusal ? `${errorId} ${rulesId}` : rulesId}
      className="sr-only"
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) onPick(file);
        event.target.value = '';
      }}
    />
  );
  return (
    <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2">
      <span className="text-15 font-semibold">{t(`swap.form.${kind}.label`)}</span>
      <span className="text-13 leading-snug text-text-3">{t(`swap.form.${kind}.hint`)}</span>
      {value ? (
        <div className="flex items-end gap-3">
          <div className="relative h-32 w-24 flex-none">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL: next/image cannot optimise it */}
            <img src={value.url} alt={t(`swap.form.${kind}.alt`)} className="block h-32 w-24 rounded-8 object-cover shadow-[0_0_0_1px_var(--media-edge)]" />
            {value.path === null && (
              <span role="status" className="absolute inset-x-0 bottom-0 rounded-b-8 bg-scrim px-1 py-1 text-center text-13 leading-tight text-on-scrim">
                {t('swap.form.photo.uploading')}
              </span>
            )}
          </div>
          <div className="flex flex-col">
            <label className={`${THUMB_ACTION} focus-within:outline-2 focus-within:outline-accent-text`}>
              {t('swap.form.photo.replace')}
              <span className="sr-only"> {value.name}</span>
              {input(`${t('swap.form.photo.replace')} ${value.name}`)}
            </label>
            <button type="button" onClick={onRemove} className={THUMB_ACTION}>
              {t('swap.form.photo.remove')}
              <span className="sr-only"> {value.name}</span>
            </button>
          </div>
        </div>
      ) : (
        <label
          className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-8 border-[1.5px] border-dashed px-3 py-4 text-center text-15 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-text ${refusal ? 'border-warn text-warn' : 'border-edge-strong text-accent-text'}`}
        >
          {input(t(`swap.form.${kind}.add`))}
          <Icon name="add" size={20} />
          <span>{t(`swap.form.${kind}.add`)}</span>
        </label>
      )}
      {refusal && (
        <p id={errorId} role="alert" className={WARN}>
          <Icon name="warning" size={16} className="mt-px flex-none" />
          {t(`swap.form.photo.error.${refusal.key}`, { name: refusal.name, min: RULES.swapPhotoShortSideMin })}
        </p>
      )}
    </div>
  );
}

/**
 * `/swap/[id]`: the video, the photographs of the person, the three consents, and the hand-over to the job page. The price is the
 * estimate the page was given and the one the window asks for again; the form works out none. Start is off until the full-body
 * photograph is stored and every consent is given.
 */
export function SwapForm({ template, estimate, paused, consentVersion, reviewed }: { template: SwapVideo; estimate: Estimate | null; paused: boolean; consentVersion: string; reviewed: boolean }) {
  const t = useT();
  const router = useRouter();
  const rulesId = useId();
  const hintId = useId();
  const keyRef = useRef<string | null>(null);   // one idempotency key per window; dropped when the window closes or the form changes
  const urls = useRef(new Set<string>());
  const busy = useRef(false);                     // two events in the same tick must not both reach the action
  const [photos, setPhotos] = useState<Photos>(NO_PHOTOS);
  const [refusals, setRefusals] = useState<Record<PhotoKind, Refusal | null>>(NO_PHOTOS);
  const [consent, setConsent] = useState<Record<(typeof CONSENTS)[number], boolean>>({ ownPerson: false, adults: false, notCelebrity: false });
  const [outfit, setOutfit] = useState<Outfit>('keep');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [message, setMessage] = useState<ErrorCode | null>(null);
  const [estimating, setEstimating] = useState(false);

  useEffect(() => {
    const live = urls.current;
    return () => live.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const refuse = (kind: PhotoKind, key: Refusal['key'], name: string) => setRefusals((all) => ({ ...all, [kind]: { key, name } }));
  /** A picked file is checked here first (type, size, short side, upright), without anything being sent; only a photograph that passes is uploaded. */
  const pick = async (kind: PhotoKind, file: File) => {
    keyRef.current = null;
    setRefusals((all) => ({ ...all, [kind]: null }));
    const size = fileProblem(file) ? null : await measurePicture(file);
    const problem = fileProblem(file) ?? (size ? pictureProblem(kind, size) : 'unreadable');
    if (problem) return refuse(kind, problem, file.name);
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    setPhotos((all) => ({ ...all, [kind]: { name: file.name, url, path: null } }));
    const form = new FormData();
    form.set('file', file);
    /** The answer belongs to the photograph that is still in the box: one that was replaced or removed meanwhile has nothing to say. */
    const settle = (update: (photo: Picked) => Picked | null) => setPhotos((all) => (all[kind]?.url === url ? { ...all, [kind]: update(all[kind]) } : all));
    try {
      const outcome = await uploadPersonPhoto(form);
      settle((photo) => (outcome.status === 'saved' ? { ...photo, path: outcome.path } : null));
      if (outcome.status !== 'saved') refuse(kind, outcome.code, file.name);
    } catch (error) {
      unstable_rethrow(error);
      settle(() => null);
      refuse(kind, 'failed', file.name);
    }
  };
  const remove = (kind: PhotoKind) => {
    keyRef.current = null;
    setPhotos((all) => ({ ...all, [kind]: null }));
  };
  const closeDialog = () => {
    keyRef.current = null;
    setDialog(null);
  };

  const slot = template.persons[0]?.slot ?? 1;
  const raw = () => ({
    templateId: template.id,
    people: photos.body?.path ? [{ slot, body: photos.body.path, face: photos.face?.path ?? null, ...(photos.side?.path ? { side: photos.side.path } : {}) }] : [],
    outfit,
    consent: { ...consent, version: consentVersion },
  });

  /** What an answer of the server does to the form and to the window. `shown`: the estimate on screen when the answer is to a confirmation. */
  const apply = (outcome: SwapOutcome, shown: Estimate | null) => {
    if (outcome.status === 'error') {
      keyRef.current = null;
      setDialog(null);
      if (outcome.code === 'photo') setPhotos(NO_PHOTOS);   // the server deleted the one it refused, and does not say which
      return setMessage(outcome.code);
    }
    setMessage(null);
    // A changed estimate keeps the window and its key: no job was made for that key.
    keyRef.current ??= crypto.randomUUID();
    const next = outcome.estimate;
    let change: SwapConfirmChange | null = null;
    if (outcome.status === 'changed' && shown) change = next.credits !== shown.credits ? { kind: 'price', was: shown.credits } : next.balance !== shown.balance ? { kind: 'balance' } : null;
    setDialog({ key: keyRef.current, phase: 'ready', estimate: next, change });
  };

  const uploading = PHOTO_KINDS.some((kind) => photos[kind] !== null && photos[kind].path === null);
  const hasBody = Boolean(photos.body?.path);
  const consented = CONSENTS.every((box) => consent[box]);
  const canStart = hasBody && consented && !uploading && !paused;

  const submit = async () => {
    if (!canStart || busy.current) return;
    busy.current = true;
    keyRef.current ??= crypto.randomUUID();
    setDialog({ key: keyRef.current, phase: 'pricing', estimate: null, change: null });
    setEstimating(true);
    try {
      apply(await estimateSwap(raw()), null);
    } catch (error) {
      unstable_rethrow(error);
      apply({ status: 'error', code: 'generic' }, null);
    } finally {
      busy.current = false;
      setEstimating(false);
    }
  };
  const confirm = async () => {
    if (!dialog?.estimate || busy.current) return;
    const shown = dialog.estimate;
    const { key } = dialog;
    busy.current = true;
    setDialog({ ...dialog, phase: 'starting' });
    try {
      const answer = await confirmSwap(raw(), key, { credits: shown.credits });
      busy.current = false;
      apply(answer, shown);
    } catch (error) {
      unstable_rethrow(error);
      // No answer came back: ask whether a job with this key was made before saying anything.
      const jobId = await findStartedSwap(key).catch(() => null);
      busy.current = false;
      if (jobId) router.push(`/jobs/${jobId}`);
      else apply({ status: 'error', code: 'generic' }, shown);
    }
  };

  const people = t('swap.gallery.people', { count: template.people });
  const hint = uploading ? t('swap.form.wait') : !hasBody ? t('swap.form.needsPhoto') : !consented ? t('swap.form.consent.missing') : null;
  return (
    <div className="flex flex-col gap-4 nav:gap-8">
      <Link href="/swap" className="flex min-h-11 items-center gap-2 self-start text-15 text-text-3 no-underline hover:text-text">
        <Icon name="back" size={18} />
        {t('swap.form.back')}
      </Link>
      <div className="flex flex-wrap items-start gap-6 nav:gap-x-12 nav:gap-y-8">
        <aside
          aria-label={t('swap.form.aside.label')}
          className="box-border flex flex-[1_1_100%] items-center gap-4 rounded-16 border border-line bg-surface p-3 nav:max-w-75 nav:flex-[1_1_240px] nav:flex-col nav:items-stretch nav:gap-3 nav:border-0 nav:bg-transparent nav:p-0"
        >
          <div className={`${FRAME} bg-raised`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the video's sample frame, a small static asset */}
            {template.image && <img src={template.image} alt="" className="block size-full object-cover" />}
            {template.persons.map(({ slot: n, box }) => (
              <span
                key={n}
                data-box
                className="absolute box-border flex items-start justify-start rounded-8 border-2 border-accent text-[0] nav:text-13"
                style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.right - box.left}%`, height: `${box.bottom - box.top}%` }}
              >
                <span className="hidden rounded-br-8 bg-accent px-2 py-0.5 font-semibold text-on-accent nav:block">{t('swap.form.aside.box', { n })}</span>
              </span>
            ))}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-15 font-semibold">{template.title}</span>
            <span className="text-13 text-text-3">{[formatDuration(template.seconds, t), people].join(' · ')}</span>
            <span className="hidden text-13 leading-normal text-pretty text-text-3 nav:block">{t('swap.form.aside.promise')}</span>
          </div>
        </aside>

        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="flex min-w-0 flex-[3_1_560px] flex-col gap-8"
        >
          <div className="flex flex-col gap-2">
            <h1 className="m-0 heading-3">{t('swap.form.title')}</h1>
            <p className="m-0 text-17 leading-normal text-text-2">{t('swap.form.lead')}</p>
          </div>
          {paused && (
            <p role="status" className={ALERT}>
              <Icon name="warning" size={20} className="flex-none text-warn" />
              <span>{t('swap.form.paused')}</span>
            </p>
          )}

          <fieldset className="m-0 box-border flex min-w-0 flex-col gap-4 rounded-16 border border-line bg-surface p-4">
            <legend className="px-2 text-15 text-text-2">{t('swap.form.person', { n: slot })}</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-4">
              {PHOTO_KINDS.map((kind) => (
                <PhotoField key={kind} kind={kind} value={photos[kind]} refusal={refusals[kind]} rulesId={rulesId} onPick={(file) => void pick(kind, file)} onRemove={() => remove(kind)} />
              ))}
            </div>
            <p id={rulesId} className="m-0 text-13 leading-snug text-text-3">{t('swap.form.photo.rules', { min: RULES.swapPhotoShortSideMin })}</p>
            <div className="flex flex-col gap-1 border-t border-line pt-3 text-13 leading-normal text-text-3">
              <span className="text-text-2">{t('swap.form.tips.title')}</span>
              <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5">
                {TIPS.map((tip) => <li key={tip}>{t(`swap.form.tips.${tip}`)}</li>)}
              </ul>
            </div>
          </fieldset>

          <fieldset role="radiogroup" className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
            <legend className="mb-2 p-0 text-15 text-text-2">{t('swap.form.outfit.legend')}</legend>
            {OUTFITS.map((choice) => (
              <label key={choice} className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-15 leading-snug">
                <input
                  type="radio"
                  name="outfit"
                  checked={outfit === choice}
                  onChange={() => {
                    keyRef.current = null;
                    setOutfit(choice);
                  }}
                  className="mt-0.5 size-5 flex-none accent-[var(--accent)]"
                />
                {t(`swap.form.outfit.${choice}`)}
              </label>
            ))}
          </fieldset>

          <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
            <legend className="mb-2 p-0 text-15 text-text-2">{t('swap.form.consent.legend')}</legend>
            {CONSENTS.map((box) => (
              <label key={box} className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-15 leading-snug">
                <input
                  type="checkbox"
                  checked={consent[box]}
                  onChange={(event) => {
                    keyRef.current = null;
                    setConsent((all) => ({ ...all, [box]: event.target.checked }));
                  }}
                  className="mt-0.5 size-5 flex-none accent-[var(--accent)]"
                />
                {t(`swap.form.consent.${box}`)}
              </label>
            ))}
            <p className="m-0 mt-2 text-13 leading-normal text-text-3">{t('swap.form.consent.kept', { hours: RULES.swapPhotosKeptHours, days: RULES.swapVideosKeptDays })}</p>
            {reviewed && <p className="m-0 mt-1 text-13 leading-normal text-text-3">{t('swap.form.review', { hours: RULES.swapReviewHours })}</p>}
          </fieldset>

          {message && (
            <p role="alert" className={ALERT}>
              <Icon name="warning" size={20} className="flex-none text-warn" />
              <span>{t(`swap.form.error.${message}`, { min: RULES.swapPhotoShortSideMin })}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-4 border-t border-line pt-6">
            <Button type="submit" size="l" pending={estimating} disabled={!canStart} aria-describedby={hintId} className="w-full nav:w-auto">
              {t('swap.form.submit')}
            </Button>
            <div id={hintId} className="flex flex-[1_1_280px] flex-col gap-1 text-13 leading-normal text-text-3">
              {estimate && <p className="m-0 text-15 font-semibold text-text">{[formatCredits(estimate.credits, t), formatDuration(template.seconds, t), '9:16'].join(' · ')}</p>}
              <p className="m-0">{hint ?? t('swap.form.priceNote')}</p>
            </div>
          </div>
        </form>
      </div>

      {dialog && (
        <SwapConfirmDialog
          phase={dialog.phase}
          estimate={dialog.estimate}
          change={dialog.change}
          templateId={template.id}
          templateTitle={template.title}
          seconds={template.seconds}
          onCancel={closeDialog}
          onConfirm={() => void confirm()}
        />
      )}
    </div>
  );
}
