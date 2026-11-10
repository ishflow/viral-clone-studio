'use client';
import { PROVIDER_CAP_MESSAGE } from '@/core/provider-cap-message';

import Link from 'next/link';
import { unstable_rethrow, useRouter } from 'next/navigation';
import { startTransition, useActionState, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { RULES, type Template } from '@/data/ports';
import { formatCredits, formatDuration, formatName } from '@/shared/lib/format';
import { cx } from '@/shared/lib/cx';
import { dropDraft, readDraft, writeDraft } from '@/shared/lib/session-draft';
import { Button, buttonClass, Dialog, Icon, Input, LinkButton, MediaImage } from '@/shared/ui';
import { addVideo, removeTemplate, type AddVideoState, type PrepareOffer, type UploadedFile } from './actions';
import { reasonKey } from './reason';
import { formatClock, parseClock, RangeFields, rangeCheck, readVideoSeconds, type RangeValue } from './RangeFields';
import { SOURCE_CODES, type LinkErrorCode } from './schema';
import { uploadVideo, videoRefusal } from './upload';

const IDLE: AddVideoState = { status: 'idle', errors: {} };
const STEPS = ['transcribe', 'frames', 'fit', 'shots', 'edit'] as const;
const NO_RANGE: RangeValue = { from: '', to: '' };
/** A file the check refused for its length or its part keeps its upload: the customer picks (again) and the same file goes to the check. */
const PART_CODES: readonly LinkErrorCode[] = ['length', 'range'];
/**
 * A form that hands its fields to `action` without the form action of React: that one resets the form when it ends, and a controlled
 * box (the part checkbox) would show empty while the state still says ticked.
 */
const submitTo = (action: (form: FormData) => void) => (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  startTransition(() => action(form));
};
/** What the form keeps in the tab (the file is not kept: the browser cannot hand it back). */
type LinkDraft = { link: string; linkPart: boolean; linkRange: RangeValue };
const subscribeNothing = () => () => {};
const LINK_MAX = 2048;
const CLOCK_MAX = 16;
/** A kept value is read field by field: a field of the wrong shape (or a link past the limit) is left out, the others stay. */
const readLinkDraft = (key: string): Partial<LinkDraft> => {
  const kept = readDraft<Record<string, unknown> | null>(key);
  if (typeof kept !== 'object' || kept === null) return {};
  const clock = (value: unknown) => (typeof value === 'string' && value.length <= CLOCK_MAX ? value : '');
  const range = typeof kept.linkRange === 'object' && kept.linkRange !== null ? (kept.linkRange as Record<string, unknown>) : {};
  return {
    ...(typeof kept.link === 'string' && kept.link.length <= LINK_MAX ? { link: kept.link } : {}),
    ...(typeof kept.linkPart === 'boolean' ? { linkPart: kept.linkPart } : {}),
    linkRange: { from: clock(range.from), to: clock(range.to) },
  };
};
const CARD = 'box-border flex flex-col gap-3 rounded-16 border bg-surface p-4';

/** Board A-Video-Ekle: add a link or a video file and follow the viewer's own templates. */
export function AddVideoView({ templates, draftKey }: { templates: Template[]; draftKey?: string }) {
  const t = useT();
  const router = useRouter();
  const [link, setLink] = useState('');
  // The field is controlled: a form action resets the fields of its form when it ends, and the link must still be there after `Cancel`.
  const [submittingFile, setSubmittingFile] = useState(false);
  const [uploadCode, setUploadCode] = useState<LinkErrorCode | null>(null);
  // Several files dropped at once: only the first goes on, and the card says so.
  const [firstOnly, setFirstOnly] = useState(false);
  // A part of the video: optional for a link, needed for a file over a minute. A file waits here (`file` still to upload, or `stored` already uploaded) until the part is picked.
  const [linkPart, setLinkPart] = useState(false);
  const [linkRange, setLinkRange] = useState(NO_RANGE);
  const [fileRange, setFileRange] = useState(NO_RANGE);
  const [longFile, setLongFile] = useState<{ name: string; seconds: number | null; file?: File; stored?: UploadedFile } | null>(null);
  const [state, action, pending] = useActionState(async (previous: AddVideoState, form: FormData) => {
    // A second press of "Prepare template" waits behind the first: once that one added the video, the answer stands and the server is not asked again.
    if (previous.status === 'added' && form.has('key')) return previous;
    setSubmittingFile(form.has('uploadId'));
    if (!form.has('uploadId')) setUploadCode(null);
    const next = await addVideo(previous, form);
    if (next.status === 'added') {
      setLink('');
      setLinkPart(false);
      setLinkRange(NO_RANGE);
    }
    if (form.has('uploadId') && next.errors.link && PART_CODES.includes(next.errors.link)) {
      const stored = { uploadId: String(form.get('uploadId')), name: String(form.get('fileName')), type: String(form.get('fileType')), bytes: Number(form.get('fileBytes')) };
      setFileRange(NO_RANGE);
      setLongFile({ name: stored.name, seconds: null, stored });
    }
    return next;
  }, IDLE);
  // The file travels in two steps: the upload route keeps it (progress here), then the same free check and confirmation as a link.
  const [upload, setUpload] = useState<{ name: string; percent: number } | null>(null);
  const [cancelled, setCancelled] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const checkFile = (stored: UploadedFile, range?: RangeValue) => {
    const form = new FormData();
    form.set('uploadId', stored.uploadId);
    form.set('fileName', stored.name);
    form.set('fileType', stored.type);
    form.set('fileBytes', String(stored.bytes));
    if (range) {
      form.set('rangeFrom', String(parseClock(range.from)));
      form.set('rangeTo', String(parseClock(range.to)));
    }
    startTransition(() => action(form));
  };
  const uploadAndCheck = async (chosen: File, range?: RangeValue) => {
    setUpload({ name: chosen.name, percent: 0 });
    const result = await uploadVideo(chosen, (percent) => setUpload({ name: chosen.name, percent }));
    setUpload(null);
    if (!result.ok) {
      if (result.signedOut) return router.push('/login?reason=expired&next=%2Ftemplates%2Fnew');
      return setUploadCode(result.code);
    }
    checkFile(result.file, range);
  };
  const takeFile = async (chosen: File | undefined) => {
    if (!chosen || upload) return;
    setUploadCode(null);
    setLongFile(null);
    const refused = videoRefusal(chosen);
    if (refused) return setUploadCode(refused);
    // The browser reads the length first: over a minute a part must be picked before anything is uploaded; when it cannot read it, the check decides.
    const seconds = await readVideoSeconds(chosen);
    if (seconds !== null && seconds > RULES.sourceSecondsMax) return setUploadCode('sourceLong');
    if (seconds !== null && seconds > RULES.ownVideoSecondsMax) {
      setFileRange(NO_RANGE);
      return setLongFile({ name: chosen.name, seconds, file: chosen });
    }
    await uploadAndCheck(chosen);
  };
  const usePart = () => {
    if (!longFile) return;
    setLongFile(null);
    if (longFile.stored) checkFile(longFile.stored, fileRange);
    else if (longFile.file) void uploadAndCheck(longFile.file, fileRange);
  };
  const busy = templates.some((x) => x.preparation === 'preparing');

  // The link and its part stay in the tab, so a trip to "Buy credits" and back (or a refresh) does not empty the form. They are read once the page is
  // alive in the browser (the server's first drawing is empty, and the two must match), and nothing is written before that, or the empty form would erase what is kept.
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [draftRead, setDraftRead] = useState(false);
  if (hydrated && !draftRead) {
    setDraftRead(true);
    const kept = draftKey ? readLinkDraft(draftKey) : {};
    if (kept.link !== undefined) setLink(kept.link);
    if (kept.linkPart !== undefined) setLinkPart(kept.linkPart);
    if (kept.linkRange) setLinkRange(kept.linkRange);
  }
  useEffect(() => {
    if (!draftKey || !draftRead) return;
    if (link === '' && !linkPart && linkRange.from === '' && linkRange.to === '') dropDraft(draftKey);
    else writeDraft(draftKey, { link, linkPart, linkRange } satisfies LinkDraft);
  }, [draftKey, draftRead, link, linkPart, linkRange]);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => {
      setTick((n) => n + 1);
      router.refresh();
    }, 2000);
    return () => clearInterval(id);
  }, [busy, router]);

  // A refusal of a file (the upload itself, or the check of the file) belongs to the file card; the link field is only marked for link errors.
  const message = (code: LinkErrorCode | undefined) => (code ? `${t(`gallery.add.error.${code}`)}${SOURCE_CODES.includes(code) ? ` ${t('gallery.add.error.nothingCharged')}` : ''}` : undefined);
  const fileError = state.providerCap ? PROVIDER_CAP_MESSAGE : message(uploadCode ?? (submittingFile ? state.errors.link : undefined));
  const error = state.providerCap ? PROVIDER_CAP_MESSAGE : uploadCode || submittingFile ? undefined : message(state.errors.link);
  const offer = state.status === 'confirm' && state.offer && state.offer.key !== cancelled ? state.offer : null;

  return (
    <div className="flex flex-wrap items-start gap-x-18 gap-y-12">
      <section className="flex min-w-0 flex-[3_1_520px] flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h1 className="m-0 font-display text-[clamp(36px,4.6vw,64px)] leading-[0.95] font-extrabold tracking-[-0.035em] text-balance">
            {t('gallery.add.titleLead')} <span className="text-accent-text">{t('gallery.add.titleAccent')}</span>
          </h1>
          <p className="m-0 max-w-150 text-17 leading-normal text-text-2 text-pretty">{t('gallery.add.lead')}</p>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setFirstOnly(e.dataTransfer.files.length > 1);
            if (e.dataTransfer.files.length > 0) void takeFile(e.dataTransfer.files[0]);
          }}
          data-upload-card
          className="box-border flex flex-col items-center gap-3 rounded-16 border-[1.5px] border-dashed border-edge-strong px-6 py-8 text-center"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-raised text-accent-text">
            <Icon name="upload" size={24} />
          </span>
          <span className="heading-5">
            <span className="hidden nav:inline">{t('gallery.add.dropTitle')}</span>
            <span className="nav:hidden">{t('gallery.add.dropTitlePhone')}</span>
          </span>
          <span className="text-13 text-text-3">{t('gallery.add.dropHint')}</span>
          <span className="text-13 text-text-3">{t('gallery.add.linkHint')}</span>
          <span className="max-w-120 text-13 text-text-3">{t('gallery.add.range.longHint')}</span>
          <input ref={file} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="sr-only" tabIndex={-1} aria-hidden="true" disabled={upload !== null || pending} onChange={(event) => {
            setFirstOnly(false);
            void takeFile(event.target.files?.[0]);
            event.target.value = '';
          }} />
          <button type="button" disabled={upload !== null || pending} onClick={() => file.current?.click()} className={cx(buttonClass('secondary'), 'bg-transparent')}>
            {t('gallery.add.chooseFile')}
          </button>
          {firstOnly && <span role="status" className="max-w-120 text-13 leading-snug text-text-2">{t('gallery.add.firstOnly')}</span>}
          {fileError && (
            <span role="alert" className="flex max-w-120 items-start justify-center gap-1.5 text-13 leading-snug text-warn">
              <Icon name="warning" size={16} className="mt-px flex-none" />
              {fileError}
            </span>
          )}
          {upload && (
            <p role="status" className="m-0 max-w-120 text-13 leading-snug text-text-2">
              {t('gallery.add.uploading', { name: upload.name, percent: upload.percent })}
            </p>
          )}
          {longFile && !upload && (
            <div className="flex w-full max-w-120 flex-col gap-3 border-t border-edge pt-4 text-left">
              <p className="m-0 text-15 leading-normal text-text-2">
                {longFile.seconds === null
                  ? t('gallery.add.range.fileLongUnknown', { name: longFile.name })
                  : t('gallery.add.range.fileLong', { name: longFile.name, length: formatDuration(longFile.seconds, t) })}
              </p>
              <RangeFields value={fileRange} onChange={setFileRange} videoSeconds={longFile.seconds ?? undefined} />
              <Button type="button" disabled={!rangeCheck(fileRange, longFile.seconds ?? undefined).ready} onClick={usePart}>
                {t('gallery.add.range.fileGo')}
              </Button>
            </div>
          )}
        </div>

        {/* The markup reads link, part checkbox, part boxes, Add. On a wide screen Add sits beside the link box (grid placement), on a phone it stays last. */}
        <form onSubmit={submitTo(action)} noValidate className="grid grid-cols-1 gap-2 nav:grid-cols-[minmax(0,1fr)_auto] nav:gap-x-3">
          <label htmlFor="video-link" className="col-span-full text-15 text-text-2 nav:row-start-1">
            {t('gallery.add.linkLabel')}
          </label>
          <Input
            id="video-link"
            name="link"
            type="url"
            inputMode="url"
            autoComplete="off"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder={t('gallery.add.linkPlaceholder')}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'video-link-error' : undefined}
            className="min-w-0 bg-surface nav:col-start-1 nav:row-start-2"
          />
          {error && (
            <span id="video-link-error" className="col-span-full flex items-center gap-1.5 text-13 leading-snug text-warn">
              <Icon name="warning" size={16} />
              {error}
            </span>
          )}
          <label className="col-span-full flex w-fit cursor-pointer items-center gap-2.5 py-1 text-15 text-text-2">
            <input type="checkbox" checked={linkPart} onChange={(event) => setLinkPart(event.target.checked)} className="size-5 accent-accent" />
            {t('gallery.add.range.use')}
          </label>
          {linkPart && <div className="col-span-full"><RangeFields value={linkRange} onChange={setLinkRange} /></div>}
          <Button type="submit" pending={pending} disabled={linkPart && !rangeCheck(linkRange).ready} className="col-span-full px-8 nav:col-span-1 nav:col-start-2 nav:row-start-2">
            {t('gallery.add.submit')}
          </Button>
          <p className="col-span-full m-0 flex items-start gap-2 rounded-12 border border-line bg-surface px-4 py-3 text-13 leading-snug text-text-2">
            <Icon name="info" size={16} className="mt-px flex-none" />
            {t('gallery.add.costNote', { credits: formatCredits(RULES.ownTemplateCredits, t) })}
          </p>
          {pending && !offer && (
            <p role="status" className="col-span-full m-0 text-13 leading-snug text-text-2">
              {t(submittingFile ? 'gallery.add.checkingFile' : 'gallery.add.checking')}
            </p>
          )}
          {state.status === 'added' && !fileError && !error && (
            <p role="status" className="col-span-full m-0 text-13 leading-snug text-accent-text">
              {t('gallery.add.added')}
            </p>
          )}
        </form>

        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-13 leading-normal text-text-3">
          <li>{t('gallery.add.notes.structure')}</li>
          <li>{t('gallery.add.notes.experimental')}</li>
        </ul>
      </section>

      {offer && <PrepareDialog offer={offer} pending={pending} action={action} onCancel={() => setCancelled(offer.key)} />}

      <section id="yours" role="region" aria-label={t('gallery.add.yours')} className="flex min-w-0 flex-[2_1_380px] flex-col gap-4">
        <h2 className="m-0 heading-5">{t('gallery.add.yours')}</h2>
        {templates.length === 0 && <p className="m-0 text-15 text-text-3">{t('gallery.add.yoursEmpty')}</p>}
        {templates.map((template) => (
          <YourTemplate key={template.id} template={template} tick={tick} />
        ))}
      </section>
    </div>
  );
}

function YourTemplate({ template, tick }: { template: Template; tick: number }) {
  const t = useT();
  if (template.preparation === 'preparing') {
    // The step ticks are illustrative progress, not real status: the port reports no step, so the list advances one step per refresh and never finishes before the template is ready.
    const active = Math.min(tick, STEPS.length - 1);
    return (
      <article className={cx(CARD, 'border-line')}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="m-0 min-w-0 text-15 font-semibold [overflow-wrap:anywhere]">{template.title}</h3>
          <span className="shrink-0 text-15 font-semibold text-accent-text">{t('gallery.add.preparing')}</span>
        </div>
        <ol className="m-0 flex list-none flex-col gap-2 p-0 text-15">
          {STEPS.map((step, i) => {
            const state = i < active ? 'done' : i === active ? 'running' : 'waiting';
            return (
              <li key={step} className={cx('flex items-center gap-2', state === 'done' ? 'text-text' : state === 'running' ? 'text-accent-text' : 'text-text-3')}>
                <span
                  aria-hidden="true"
                  className={cx('size-2.5 shrink-0 rounded-full border-[1.5px]', state === 'waiting' ? 'border-edge-strong' : 'border-accent-text', state === 'done' && 'bg-accent-text')}
                />
                <span className="flex-1">{t(`gallery.add.step.${step}`)}</span>
                <span>{t(`gallery.add.step.${state}`)}</span>
              </li>
            );
          })}
        </ol>
      </article>
    );
  }
  if (template.preparation === 'failed') return <FailedTemplate template={template} />;
  const poster = template.image || template.referenceImage;
  return (
    <article className={cx(CARD, 'flex-row flex-wrap items-center gap-x-4 gap-y-3 border-line')}>
      <div className="flex min-w-0 flex-[1_1_200px] items-center gap-4">
        {poster ? (
          <MediaImage src={poster} alt="" width={44} height={78} className="h-19.5 w-11 shrink-0 rounded-8 object-cover shadow-[0_0_0_1px_var(--media-edge)]" />
        ) : (
          <span aria-hidden="true" className="box-border h-19.5 w-11 shrink-0 rounded-8 border-[1.5px] border-dashed border-edge-strong" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 min-w-0 text-15 font-semibold [overflow-wrap:anywhere]">
              <Link href={`/templates/${template.id}`} className="text-text no-underline hover:underline">
                {template.title}
              </Link>
            </h3>
            <span className="rounded-full border border-dashed border-edge-strong px-3 py-1.5 text-13 text-text-2">{t('gallery.add.experimental')}</span>
          </div>
          <p className="m-0 text-13 text-text-3">{t('gallery.add.ready')}</p>
        </div>
      </div>
      <Link href={`/templates/${template.id}/generate`} className={buttonClass('secondary')}>
        {t('gallery.add.clone')}
      </Link>
    </article>
  );
}

/** Board A-Video-Ekle-Durumlar, "Confirm before preparing": the price, what the check found, the balance. Nothing is charged until the button. */
function PrepareDialog({ offer, pending, action, onCancel }: { offer: PrepareOffer; pending: boolean; action: (form: FormData) => void; onCancel: () => void }) {
  const t = useT();
  const enough = offer.balance >= offer.credits;
  const rows: [string, string][] = [];
  if (offer.file) rows.push([t('gallery.add.confirm.file'), offer.file.name]);
  if (offer.seconds !== null) rows.push([t('gallery.add.confirm.length'), formatDuration(offer.seconds, t)]);
  if (offer.range) rows.push([t('gallery.add.confirm.part'), `${formatClock(offer.range.from)} – ${formatClock(offer.range.to)} (${formatDuration(offer.range.to - offer.range.from, t)})`]);
  if (offer.shots !== null) rows.push([t('gallery.add.confirm.shots'), String(offer.shots)]);
  if (offer.format !== null) rows.push([t('gallery.add.confirm.format'), formatName(offer.format, t)]);
  rows.push([t('gallery.add.confirm.balance'), formatCredits(offer.balance, t)]);
  if (enough) rows.push([t('gallery.add.confirm.after'), formatCredits(offer.balance - offer.credits, t)]);
  return (
    <Dialog open onClose={onCancel} dismissible={!pending} title={t('gallery.add.confirm.title')}>
      <p className="m-0 -mt-2 text-15 text-text-2">{t('gallery.add.confirm.lead', { credits: formatCredits(offer.credits, t) })}</p>
      <dl className="m-0 flex flex-col">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-t border-edge py-3 text-15 last:border-b">
            <dt className="text-text-2">{label}</dt>
            <dd className={cx('m-0 font-semibold', !enough && label === t('gallery.add.confirm.balance') && 'text-warn')}>{value}</dd>
          </div>
        ))}
      </dl>
      {!enough && (
        <p role="alert" className="m-0 flex items-start gap-2 text-15 leading-normal text-text-2">
          <Icon name="warning" size={20} className="flex-none text-warn" />
          <span>
            <strong className="font-semibold text-text">{t('gallery.add.confirm.needs', { credits: formatCredits(offer.credits, t) })}</strong> {t('gallery.add.confirm.nothingCharged')}
          </span>
        </p>
      )}
      <p className="m-0 text-13 leading-normal text-text-3">{t('gallery.add.confirm.note')}</p>
      <form onSubmit={submitTo(action)} className="flex flex-wrap-reverse gap-3">
        {offer.file ? (
          <>
            <input type="hidden" name="uploadId" value={offer.file.uploadId} />
            <input type="hidden" name="fileName" value={offer.file.name} />
            <input type="hidden" name="fileType" value={offer.file.type} />
            <input type="hidden" name="fileBytes" value={offer.file.bytes} />
          </>
        ) : (
          <input type="hidden" name="link" value={offer.link} />
        )}
        {offer.range && (
          <>
            <input type="hidden" name="rangeFrom" value={offer.range.from} />
            <input type="hidden" name="rangeTo" value={offer.range.to} />
          </>
        )}
        <input type="hidden" name="key" value={offer.key} />
        <input type="hidden" name="confirmed" value={offer.credits} />
        <Button variant="secondary" className="flex-[1_1_140px]" disabled={pending} onClick={onCancel}>
          {t('gallery.add.confirm.cancel')}
        </Button>
        {enough ? (
          <Button type="submit" pending={pending} className="flex-[2_1_200px]">
            {t('gallery.add.confirm.submit')}
          </Button>
        ) : (
          <LinkButton href={`/pricing?returnTo=${encodeURIComponent('/templates/new')}`} className="flex-[2_1_200px]">
            {t('gallery.add.confirm.buy')}
          </LinkButton>
        )}
      </form>
    </Dialog>
  );
}

/** A video that did not fit: why, and a way off the list (it cannot be opened, so it would otherwise stay there for good). */
function FailedTemplate({ template }: { template: Template }) {
  const t = useT();
  const [removing, setRemoving] = useState<'busy' | 'in-use' | 'failed' | null>(null);
  const remove = async () => {
    setRemoving('busy');
    // On success the action reloads this board; an answer means nothing was removed.
    try {
      setRemoving((await removeTemplate(template.id)).code);
    } catch (error) {
      unstable_rethrow(error);
      setRemoving('failed');
    }
  };
  return (
    <article className={cx(CARD, 'gap-2 border-warn-edge')}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 min-w-0 text-15 font-semibold [overflow-wrap:anywhere]">{template.title}</h3>
        <span className="shrink-0 text-15 font-semibold text-warn">{t('gallery.add.failed')}</span>
      </div>
      <p className="m-0 text-15 leading-normal text-text-2">{t(reasonKey(template.preparationNote))}</p>
      <button
        type="button"
        disabled={removing === 'busy'}
        onClick={remove}
        className="flex min-h-11 cursor-pointer items-center self-start border-0 bg-transparent p-0 text-15 font-semibold text-warn disabled:cursor-not-allowed disabled:text-text-3"
      >
        {t('gallery.add.remove')}
      </button>
      {(removing === 'in-use' || removing === 'failed') && (
        <p role="alert" className="m-0 text-13 leading-snug text-warn">
          {t(removing === 'in-use' ? 'gallery.detail.deleteInUse' : 'gallery.detail.deleteFailed')}
        </p>
      )}
    </article>
  );
}
