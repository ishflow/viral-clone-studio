'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import type { Estimate, Format, GenerateInput, Quality } from '@/data/ports';
import { unstable_rethrow, useRouter } from 'next/navigation';
import { Button, Icon, Select } from '@/shared/ui';
import { formatCredits, formatDuration } from '@/shared/lib/format';
import { cx } from '@/shared/lib/cx';
import { dropDraft, readDraft, writeDraft } from '@/shared/lib/session-draft';
import { confirmGeneration, estimateGeneration, findStartedJob, saveFormDraft, uploadProductImage, type GenerateOutcome } from './actions';
import { INFO_MAX, NAME_MAX, parseKeptForm, type FieldProblem } from './schema';
import { ConfirmDialog, type ConfirmChange, type ConfirmPhase } from './ConfirmDialog';
import { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES, ProductBlock, type PickedImage, type ProductDraft, type UploadNote } from './ProductBlock';

export type GenerateTemplate = { id: string; title: string; image: string; products: number; shots: number; seconds: number; format: Format };
/** The answer to a start must come back within this long, else "We could not confirm that your job started" (R6). */
export const START_TIMEOUT_MS = 15_000;
const TIMED_OUT = Symbol('timed-out');
const TERMS_ID = 'generate-photo-terms';

/** What the confirmation window shows: the key of this window, where it is, the estimate on screen, and why it is not the first one. */
type DialogState = { key: string; phase: ConfirmPhase; estimate: Estimate | null; change: ConfirmChange | null };

/** The photo `id` out of the row; a replacement that goes gives its old photo back in its place. */
/** The template's picture frame: the picture and the empty box drawn when the template has no picture share this size. */
const FRAME = 'block w-14 flex-none aspect-[9/16] rounded-8 object-cover nav:w-full nav:rounded-16';
const without = (images: PickedImage[], id: number): PickedImage[] => images.flatMap((x) => (x.id !== id ? [x] : x.replaced ? [x.replaced] : []));
/** Changes the photo `id`, also while it waits under a newer replacement. */
const mapImage = (images: PickedImage[], id: number, update: (image: PickedImage) => PickedImage): PickedImage[] => {
  const one = (x: PickedImage): PickedImage => (x.id === id ? update(x) : x.replaced ? { ...x, replaced: one(x.replaced) } : x);
  return images.map(one);
};

/** A stored photo comes back with its preview from /media; a path the media route does not know (the demo keeps only names) is not shown. */
const storedImages = (product: number, paths: string[]): PickedImage[] =>
  paths.flatMap((path, n) =>
    path.startsWith('uploads/') ? [{ id: -(product * 100 + n + 1), name: path.split('/').pop() ?? path, url: `/media/${path}`, file: null, state: 'saved' as const, path }] : [],
  );

/** What the form holds that is worth keeping: the entries (only photos that are stored), and the choices. */
const keptOf = (products: ProductDraft[], quality: Quality, variants: 1 | 2 | 3, language: string) => ({
  products: products.map((p) => ({ name: p.name, description: p.description, images: p.images.flatMap((image) => (image.path ? [image.path] : [])) })),
  quality,
  variants,
  language,
});

const subscribeNothing = () => () => {};

/** The problem of a product's name box, if the last check found one. */
const nameProblem = (problems: FieldProblem[], product: number) => {
  const found = problems.find((x) => x.product === product && (x.field === 'name' || x.field === 'name-long'));
  return found ? (found.field as 'name' | 'name-long') : null;
};

const ALERT = 'm-0 flex items-start gap-3 rounded-12 border border-warn-edge bg-surface px-4 py-3 text-15 leading-normal text-text';
const CHOICE =
  'box-border cursor-pointer rounded-12 border-[1.5px] bg-surface text-text';

/** "Upload your products": the form, the estimate dialog and the hand-over to the job page. Validation happens on the server. */
export function GenerateForm({
  template,
  rates,
  free,
  freeHeld,
  paused,
  draft,
  fromJob,
  draftKey,
}: {
  template: GenerateTemplate;
  /** Credits per variant, by quality, for this template's format. */
  rates: Record<Quality, number>;
  /** The user still has the free video. */
  free: boolean;
  /** The user has the free video, but today's share is used up: the line under the price says so. */
  freeHeld: boolean;
  /** The admin paused generation: the note at the top says so and Generate is off. */
  paused: boolean;
  /** The form of the last visit (kept 24 hours), with its stored photos. */
  draft: GenerateInput | null;
  /** `draft` is the entries of an earlier video of the customer, not a form left unfinished. */
  fromJob: boolean;
  /** Where this tab keeps the form while the customer is away from the page; it names the user and the template. */
  draftKey: string;
}) {
  const t = useT();
  const router = useRouter();
  const nextId = useRef(0);
  const keyRef = useRef<string | null>(null); // one idempotency key per dialog; dropped when the dialog closes or the form changes
  const urls = useRef(new Set<string>());
  const [products, setProducts] = useState<ProductDraft[]>(() =>
    Array.from({ length: template.products }, (_, i) => {
      const saved = draft?.products[i];
      return { name: saved?.name ?? '', description: saved?.description ?? '', images: storedImages(i, saved?.images ?? []), notes: [] };
    }),
  );
  const [quality, setQuality] = useState<Quality>(draft?.quality ?? 'fast');
  const [variants, setVariants] = useState<1 | 2 | 3>(draft?.variants ?? 1);
  const [language, setLanguage] = useState(draft?.language ?? 'en');
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const [message, setMessage] = useState<'not-ready' | 'paused' | 'provider-cap' | 'free-video-cap' | 'generic' | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [estimating, setEstimating] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [refused, setRefused] = useState(0); // counts the answers that marked boxes: each one sends the customer to the first marked box

  // What this tab kept is read once the page is alive in the browser, not for the server's first drawing (that one is empty, and the two must match).
  // A draft of the server comes first and is never read over. `kept`: reading is over, so the form may be written; before that the empty form must not drop what is kept.
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [kept, setKept] = useState(draft !== null);
  if (hydrated && !kept) {
    setKept(true);
    const saved = parseKeptForm(readDraft(draftKey), template.products);
    if (saved) {
      setProducts((list) => list.map((p, i) => ({ ...p, name: saved.products[i]?.name ?? '', description: saved.products[i]?.description ?? '', images: storedImages(i, saved.products[i]?.images ?? []) })));
      setQuality(saved.quality);
      setVariants(saved.variants);
      setLanguage(saved.language);
    }
  }
  // From then on the form is kept as it changes, except while a start is asked or unanswered (that answer decides what the tab keeps).
  const holding = dialog?.phase === 'starting' || dialog?.phase === 'unconfirmed';
  useEffect(() => {
    if (!kept || holding) return;
    const value = keptOf(products, quality, variants, language);
    if (value.products.every((p) => p.name === '' && p.description === '' && p.images.length === 0)) dropDraft(draftKey);
    else writeDraft(draftKey, value);
  }, [kept, holding, products, quality, variants, language, draftKey]);

  useEffect(() => {
    const live = urls.current;
    return () => live.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (refused === 0) return;
    const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.focus();
    first?.scrollIntoView?.({ block: 'center' });
  }, [refused]);

  const patch = (index: number, change: Partial<ProductDraft>) => {
    keyRef.current = null;
    setProducts((list) => list.map((p, i) => (i === index ? { ...p, ...change } : p)));
    // What the customer just typed answers the problem the last check found in that box.
    const fixed = (field: FieldProblem['field']) => {
      const name = change.name?.trim();
      const info = change.description?.trim();
      if (field === 'name' || field === 'name-long') return name !== undefined && name !== '' && name.length <= NAME_MAX;
      return field === 'description-long' && info !== undefined && info.length <= INFO_MAX;
    };
    setProblems((list) => list.filter((x) => !(x.product === index && fixed(x.field))));
  };
  const change = (index: number, update: (product: ProductDraft) => ProductDraft) =>
    setProducts((list) => list.map((p, i) => (i === index ? update(p) : p)));
  const note = (name: string, key: UploadNote['key']): UploadNote => ({ id: nextId.current++, key, name });

  /** Sends one photo; the answer replaces its "uploading" state. A refused photo leaves the block with a line that names it, and gives back the photo it stood in for. */
  const send = (index: number, image: PickedImage) => {
    if (!image.file) return;
    const form = new FormData();
    form.set('file', image.file);
    const settle = (update: (product: ProductDraft) => ProductDraft) => change(index, update);
    uploadProductImage(form).then(
      (outcome) => {
        // A photo that is no longer in the row (its picture failed, or it was removed) has said what it had to say.
        if (outcome.status !== 'saved') return settle((p) => (p.images.some((x) => x.id === image.id) ? { ...p, images: without(p.images, image.id), notes: [...p.notes, note(image.name, outcome.code)] } : p));
        settle((p) => ({ ...p, images: mapImage(p.images, image.id, (x) => ({ ...x, state: 'saved', path: outcome.path, replaced: undefined })) }));
        // A stored photo answers the "needs an image" of that product.
        setProblems((list) => list.filter((x) => !(x.product === index && x.field === 'images')));
      },
      (error: unknown) => {
        unstable_rethrow(error);
        settle((p) => ({ ...p, images: mapImage(p.images, image.id, (x) => ({ ...x, state: 'failed' })) }));
      },
    );
  };
  /** `replacing`: the photo that these files take the place of; it is set aside under the new one until the server keeps that. */
  const pick = (index: number, files: File[], replacing?: number) => {
    keyRef.current = null;
    const kept = (products[index]?.images ?? []).filter((image) => image.id !== replacing);
    const room = MAX_IMAGES - kept.length;
    const notes: UploadNote[] = [];
    const added: PickedImage[] = [];
    files.forEach((file, n) => {
      if (n >= room) return;
      if (!IMAGE_TYPES.includes(file.type)) return void notes.push(note(file.name, 'type'));   // refused here: not sent at all
      if (file.size > MAX_IMAGE_BYTES) return void notes.push(note(file.name, 'size'));
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      added.push({ id: nextId.current++, name: file.name, url, file, state: 'uploading', path: null });
    });
    if (files.length > room) notes.push(note('', 'tooMany'));
    change(index, (p) => {
      const old = replacing === undefined ? undefined : p.images.find((image) => image.id === replacing);
      // A replaced photo goes only when its successor was taken, and the successor takes its place in the row.
      const [first] = added;
      if (old && first) return { ...p, images: p.images.map((image) => (image.id === old.id ? { ...first, replaced: old } : image)), notes: [...p.notes, ...notes] };
      return { ...p, images: [...p.images, ...added], notes: [...p.notes, ...notes] };
    });
    added.forEach((image) => send(index, image));
  };
  const retry = (index: number, id: number) => {
    const image = products[index]?.images.find((x) => x.id === id);
    if (!image) return;
    change(index, (p) => ({ ...p, images: mapImage(p.images, id, (x) => ({ ...x, state: 'uploading' })) }));
    send(index, image);
  };
  const remove = (index: number, id: number) => {
    keyRef.current = null;
    change(index, (p) => ({ ...p, images: without(p.images, id) }));
  };
  /** The browser could not draw a photo the customer picked: it leaves the row (its old photo comes back) with a line that names it, and is never sent. */
  const broken = (index: number, id: number) => {
    keyRef.current = null;
    change(index, (p) => {
      const image = p.images.find((x) => x.id === id);
      return image ? { ...p, images: without(p.images, id), notes: [...p.notes, note(image.name, 'unreadable')] } : p;
    });
  };
  const dismiss = (index: number, id: number) => change(index, (p) => ({ ...p, notes: p.notes.filter((x) => x.id !== id) }));
  const uploading = products.some((p) => p.images.some((image) => image.state === 'uploading'));
  const choose = <T,>(set: (value: T) => void) => (value: T) => {
    keyRef.current = null;
    set(value);
  };
  const closeDialog = () => {
    keyRef.current = null;
    setDialog(null);
  };

  // Only photos that are stored: what the upload answered is what the job is made from.
  const raw = () => ({ templateId: template.id, ...keptOf(products, quality, variants, language) });

  /** What an answer of the server does to the form and to the window. `shown`: the estimate on screen when the answer is to a confirmation. */
  const apply = (outcome: GenerateOutcome, shown: Estimate | null) => {
    setProblems(outcome.status === 'invalid' ? outcome.problems : []);
    if (outcome.status === 'invalid') setRefused((n) => n + 1);
    setMessage(outcome.status === 'error' && outcome.code !== 'paused' ? outcome.code : null);
    if (outcome.status === 'ready' || outcome.status === 'changed') {
      // A changed estimate keeps the dialog and its key: no job was made for that key.
      keyRef.current ??= crypto.randomUUID();
      const next = outcome.estimate;
      let change: ConfirmChange | null = null;
      if (outcome.status === 'changed' && shown) {
        if (next.credits !== shown.credits || next.coveredByFreeVideo !== shown.coveredByFreeVideo) change = { kind: 'price', was: shown.coveredByFreeVideo ? 0 : shown.credits };
        else if (next.balance !== shown.balance) change = { kind: 'balance' };
      }
      setDialog({ key: keyRef.current, phase: 'ready', estimate: next, change });
    } else if (outcome.status === 'error' && outcome.code === 'paused') {
      keyRef.current ??= crypto.randomUUID();
      const key = keyRef.current;
      setDialog((current) => ({ key, estimate: null, ...current, phase: 'paused', change: null }));
    } else {
      keyRef.current = null;
      setDialog(null);
    }
  };

  // Plain pending flags (not transitions): the state updates come after an await and must not stay entangled with each other.
  const busy = useRef(false); // two events in the same tick must not both reach the action
  const run = async (set: (busy: boolean) => void, action: () => Promise<GenerateOutcome>, shown: Estimate | null) => {
    if (busy.current) return;
    busy.current = true;
    set(true);
    try {
      apply(await action(), shown);
    } catch (error) {
      unstable_rethrow(error);
      apply({ status: 'error', code: 'generic' }, shown);
    } finally {
      busy.current = false;
      set(false);
    }
  };
  // The window opens at once when the form is complete, with the price still being asked; an incomplete form goes to the server for its problems.
  const complete = products.every((p) => p.name.trim() !== '' && p.images.some((image) => image.path));
  const submit = () => {
    if (complete) {
      keyRef.current ??= crypto.randomUUID();
      setDialog({ key: keyRef.current, phase: 'pricing', estimate: null, change: null });
    }
    void run(setEstimating, () => estimateGeneration(raw()), null);
  };
  const confirm = async () => {
    if (!dialog?.estimate || busy.current) return;
    const shown = dialog.estimate;
    const { key } = dialog;
    busy.current = true;
    dropDraft(draftKey);   // the job is asked for: the form is not kept for a job that may start (an answer that refuses it brings the form back)
    setDialog({ ...dialog, phase: 'starting' });
    try {
      const answer = await Promise.race([
        confirmGeneration(raw(), key, { credits: shown.credits, free: shown.coveredByFreeVideo }),
        new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), START_TIMEOUT_MS)),
      ]);
      if (answer === TIMED_OUT) throw new Error('start-unconfirmed');
      busy.current = false;
      apply(answer, shown);
    } catch (error) {
      unstable_rethrow(error);
      // No answer came back: ask whether a job with this key was made before saying anything (R6).
      const jobId = await findStartedJob(key).catch(() => null);
      busy.current = false;
      if (jobId) router.push(`/jobs/${jobId}`);
      else setDialog((current) => (current ? { ...current, phase: 'unconfirmed' } : current));
    }
  };
  /** "Buy credits": the form is kept (with its stored photos) before the customer leaves for the pricing page. */
  const buy = async () => {
    await saveFormDraft(raw()).catch(() => false);
  };

  const rate = rates[quality] * variants;
  const freeApplies = free && template.format === 'no-talking';
  const freeCovers = freeApplies && quality === 'fast' && variants === 1;
  const resolution = t(`generate.quality.${quality}.sub`);
  const costParts = [freeCovers ? t('generate.cost.free') : formatCredits(rate, t), formatDuration(template.seconds, t), '9:16', resolution];
  if (variants > 1) costParts.push(t('generate.unit.variant', { count: variants }));

  const issues = problems.flatMap((p) => [{ ...p, text: t(`generate.error.item.${p.field}`, { n: p.product + 1 }) }]);
  const summaryKey = issues.length <= 8 ? `generate.error.summary.n${issues.length}` : 'generate.error.summary.other';
  const hasImages = products.some((p) => p.images.length > 0);
  const draftNote = fromJob ? (hasImages ? 'generate.fromJob' : 'generate.fromJobNoImages') : hasImages ? 'generate.draft' : 'generate.draftNoImages';
  const list = [
    t('generate.unit.product', { count: template.products }),
    t('generate.unit.shot', { count: template.shots }),
    formatDuration(template.seconds, t),
    t(template.format === 'talking' ? 'common.format.talking' : 'common.format.noTalking').toLocaleLowerCase(),
  ].join(' · ');
  return (
    <div className="flex flex-col gap-4 nav:gap-8">
      <Link href={`/templates/${template.id}`} className="flex min-h-11 items-center gap-2 self-start text-15 text-text-3 no-underline hover:text-text">
        <Icon name="back" size={18} />
        {template.title}
      </Link>
      <div className="flex flex-wrap items-start gap-6 nav:gap-x-12 nav:gap-y-8">
        <aside
          aria-label={t('generate.aside.label')}
          className="box-border flex flex-[1_1_100%] items-center gap-4 rounded-16 border border-line bg-surface p-3 nav:max-w-75 nav:flex-[1_1_240px] nav:flex-col nav:items-stretch nav:gap-3 nav:border-0 nav:bg-transparent nav:p-0"
        >
          {template.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- the template's sample frame, a small static asset
            <img src={template.image} alt="" className={`${FRAME} shadow-[0_0_0_1px_var(--media-edge)]`} />
          ) : (
            <div aria-hidden="true" className={`${FRAME} bg-raised shadow-[0_0_0_1px_var(--media-edge)]`} />
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-15 font-semibold">{template.title}</span>
            <span className="text-13 text-pretty text-text-3">{t('generate.aside.needs', { list })}</span>
            <span className="hidden text-13 leading-normal text-pretty text-text-3 nav:block">{t('generate.aside.promise')}</span>
          </div>
        </aside>

        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex min-w-0 flex-[3_1_560px] flex-col gap-8"
        >
          <div className="flex flex-col gap-2">
            <h1 className="m-0 heading-3">{t('generate.title')}</h1>
            <p className="m-0 text-17 leading-normal text-text-2">{t('generate.lead')}</p>
          </div>

          <p id={TERMS_ID} className="m-0 -mt-4 text-13 leading-snug text-text-3">
            {t('generate.upload.terms')}
          </p>
          {paused && (
            <p role="status" className={ALERT}>
              <Icon name="warning" size={20} className="flex-none text-warn" />
              <span>{t('generate.pausedNote')}</span>
            </p>
          )}
          {draft && (
            <p role="status" className="m-0 flex items-start gap-3 rounded-12 border border-line bg-surface px-4 py-3 text-15 leading-normal text-text-2">
              <Icon name="info" size={20} className="flex-none" />
              <span>{t(draftNote)}</span>
            </p>
          )}
          <div className="flex flex-col gap-4">
            {products.map((p, i) => (
              <ProductBlock
                key={i}
                index={i}
                value={p}
                nameProblem={nameProblem(problems, i)}
                infoBad={problems.some((x) => x.product === i && x.field === 'description-long')}
                imagesBad={problems.some((x) => x.product === i && x.field === 'images')}
                onChange={(change) => patch(i, change)}
                onPick={(files) => pick(i, files)}
                onReplace={(id, file) => pick(i, [file], id)}
                termsId={TERMS_ID}
                onRemove={(id) => remove(i, id)}
                onRetry={(id) => retry(i, id)}
                onDismiss={(id) => dismiss(i, id)}
                onBroken={(id) => broken(i, id)}
              />
            ))}
          </div>
          {template.format === 'talking' && <p className="m-0 -mt-4 text-13 leading-snug text-text-3">{t('generate.aside.presenterNote')}</p>}

          <div className="flex flex-wrap gap-x-8 gap-y-6">
            <div role="group" aria-label={t('generate.quality.label')} className="flex flex-[2_1_380px] flex-col gap-2">
              <span className="text-15 text-text-2">{t('generate.quality.label')}</span>
              <div className="flex flex-wrap gap-2">
                {(['fast', 'best'] as const).map((q) => (
                  <button
                    key={q}
                    type="button"
                    aria-pressed={quality === q}
                    onClick={() => choose(setQuality)(q)}
                    className={cx(CHOICE, 'flex min-h-18 flex-[1_1_170px] flex-col gap-1 px-4 py-3 text-left', quality === q ? 'border-accent-text' : 'border-edge')}
                  >
                    <span className="text-15 font-semibold">{t(`common.quality.${q}`)}</span>
                    <span className="text-13 text-text-3">{t(`generate.quality.${q}.sub`)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div role="group" aria-label={t('generate.variants.group')} className="flex flex-[1_1_200px] flex-col gap-2">
              <span className="text-15 text-text-2">{t('generate.variants.label')}</span>
              <div className="flex gap-2">
                {([1, 2, 3] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={variants === n}
                    onClick={() => choose(setVariants)(n)}
                    className={cx(CHOICE, 'min-h-18 flex-[1_1_0] text-20 font-semibold nav:w-18 nav:flex-none', variants === n ? 'border-accent-text' : 'border-edge')}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex flex-[1_1_240px] flex-col gap-2 text-15 text-text-2">
              {t('generate.language.label')}
              <Select value={language} onChange={(event) => choose(setLanguage)(event.target.value)} className="bg-surface! px-3!">
                <option value="en">{t('common.language.en')}</option>
                <option value="tr">{t('common.language.tr')}</option>
              </Select>
              <span className="text-13 leading-snug text-text-3">{t('generate.language.hint')}</span>
            </label>
          </div>

          {(issues.length > 0 || message) && (
            <p role="alert" className={ALERT}>
              <Icon name="warning" size={20} className="flex-none text-warn" />
              <span>
                {issues.length > 0 ? (
                  <>
                    <strong className="font-semibold text-warn">{t(summaryKey, { count: issues.length })}</strong> {issues.map((x) => x.text).join(' ')}
                  </>
                ) : (
                  t(message === 'provider-cap' ? 'generate.error.providerCap' : message === 'free-video-cap' ? 'generate.error.freeVideoCap' : message === 'not-ready' ? 'generate.error.notReady' : 'generate.error.generic')
                )}
              </span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-4 border-t border-line pt-6">
            <Button type="submit" size="l" pending={estimating} disabled={uploading || paused} className="w-full nav:w-auto">
              {t('generate.submit')}
            </Button>
            <div className="flex flex-[1_1_280px] flex-col gap-1 text-13 leading-normal text-text-3">
              {uploading ? (
                <p className="m-0">{t('generate.upload.wait')}</p>
              ) : (
                <>
                  <p className="m-0 text-15 font-semibold text-text">{costParts.join(' · ')}</p>
                  {freeCovers && <p className="m-0 text-accent-text">{t('generate.cost.freeNote')}</p>}
                  {freeHeld && <p className="m-0">{t('generate.cost.freeHeld')}</p>}
                  {freeApplies && !freeCovers && <p className="m-0">{t('generate.cost.freeLimit', { credits: formatCredits(rate, t) })}</p>}
                  <p className="m-0">{t('generate.hint')}</p>
                </>
              )}
            </div>
          </div>
        </form>
      </div>

      {dialog && (
        <ConfirmDialog
          phase={dialog.phase}
          estimate={dialog.estimate}
          change={dialog.change}
          templateTitle={template.title}
          quality={quality}
          variants={variants}
          language={language}
          seconds={template.seconds}
          idempotencyKey={dialog.key}
          templateId={template.id}
          onCancel={closeDialog}
          onConfirm={() => void confirm()}
          onBuy={buy}
        />
      )}
    </div>
  );
}
