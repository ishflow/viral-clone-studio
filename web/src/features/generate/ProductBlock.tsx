'use client';

import { useId, useState, type DragEvent } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { Icon, Input } from '@/shared/ui';
import { INFO_MAX, NAME_MAX } from './schema';

/** Spec §7.1: JPG, PNG or WebP · up to 10 MB each · 1 to 8 images per product. */
export const MAX_IMAGES = 8;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** The types a picked file may have; anything else is refused in the form, before it is sent. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ACCEPT = IMAGE_TYPES.join(',');

/** A picked photo: its local preview, and its upload. `path` is what the server stored, and what the form sends. */
/** `replaced`: the photo this one stands in for until the server keeps it; a refused or removed replacement gives it back. */
export type PickedImage = { id: number; name: string; url: string; file: File | null; state: 'uploading' | 'saved' | 'failed'; path: string | null; replaced?: PickedImage };
/** A photo that was not taken, named in a line of its own. */
export type UploadNote = { id: number; key: 'type' | 'size' | 'quota' | 'unreadable' | 'tooMany'; name: string };
export type ProductDraft = { name: string; description: string; images: PickedImage[]; notes: UploadNote[] };

const WARN = 'flex items-center gap-2 text-13 leading-snug text-warn';
const THUMB_ACTION = 'flex min-h-11 w-full cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-13 font-medium text-text-2 hover:text-text';
const ON_THUMB = 'absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 rounded-b-8 bg-scrim px-1 py-1 text-center text-13 leading-tight text-on-scrim';

/** One product of the template: images (each uploaded as it is picked), name, short description. */
export function ProductBlock({
  index,
  value,
  nameProblem,
  infoBad,
  imagesBad,
  onChange,
  onPick,
  onReplace,
  onRemove,
  onRetry,
  onDismiss,
  onBroken,
  termsId,
}: {
  index: number;
  value: ProductDraft;
  /** Why the name is flagged: nothing typed, or more than the box allows. */
  nameProblem: 'name' | 'name-long' | null;
  /** The description is longer than the box allows. */
  infoBad: boolean;
  imagesBad: boolean;
  onChange: (patch: Partial<Pick<ProductDraft, 'name' | 'description'>>) => void;
  onPick: (files: File[]) => void;
  /** One photo in place of the one with this id. */
  onReplace: (id: number, file: File) => void;
  onRemove: (id: number) => void;
  onRetry: (id: number) => void;
  onDismiss: (id: number) => void;
  /** The browser could not draw the photo `id` that the customer picked from a file. */
  onBroken: (id: number) => void;
  /** The id of the line that states the photo rules once for the whole form. */
  termsId: string;
}) {
  const t = useT();
  const uid = useId();
  const nameError = `${uid}-name-error`;
  const infoError = `${uid}-info-error`;
  const imageError = `${uid}-image-error`;
  const [dragging, setDragging] = useState(false);
  const nameBad = nameProblem !== null;
  const empty = value.images.length === 0;
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    onPick(Array.from(event.dataTransfer.files));
  };
  return (
    <fieldset className="m-0 box-border flex min-w-0 flex-wrap gap-x-4 gap-y-3 rounded-16 border border-line bg-surface p-4">
      <legend className="px-2 text-15 text-text-2">{t('generate.product.legend', { n: index + 1 })}</legend>
      <div className="flex min-w-38 max-w-full flex-col gap-2">
        <div className="flex flex-wrap items-start gap-2">
          {value.images.map((image) => (
            <div key={image.id} className="flex w-18 flex-col items-center">
              <div className="relative h-24 w-18">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL or a stored photo: next/image cannot optimise either */}
                <img src={image.url} alt={t('generate.product.imageAlt')} onError={image.file ? () => onBroken(image.id) : undefined} className="block h-24 w-18 rounded-8 object-cover shadow-[0_0_0_1px_var(--media-edge)]" />
                {image.state === 'uploading' && (
                  <span role="status" className={ON_THUMB}>
                    {t('generate.upload.uploading')}
                  </span>
                )}
                {image.state === 'failed' && (
                  <span className={ON_THUMB}>
                    <Icon name="warning" size={14} />
                    <span className="sr-only">{t('generate.upload.failed')}</span>
                    <button type="button" onClick={() => onRetry(image.id)} className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-13 font-semibold text-on-scrim underline">
                      {t('generate.upload.retry')}
                    </button>
                  </span>
                )}
              </div>
              <label className={`${THUMB_ACTION} focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-accent-text`}>
                {t('generate.product.replace')}
                <span className="sr-only"> {image.name}</span>
                <input
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onReplace(image.id, file);
                    event.target.value = '';
                  }}
                />
              </label>
              <button type="button" aria-label={t('generate.product.removeImage', { name: image.name })} onClick={() => onRemove(image.id)} className={THUMB_ACTION}>
                {t('generate.product.remove')}
              </button>
            </div>
          ))}
          <label
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
            className={`relative flex cursor-pointer items-center justify-center rounded-8 border-[1.5px] border-dashed text-center text-15 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-text ${
              empty ? 'min-h-24 w-full max-w-58 flex-col gap-1 px-3 py-4' : 'h-24 w-18'
            } ${dragging ? 'bg-raised' : 'bg-transparent'} ${imagesBad ? 'border-warn text-warn' : 'border-edge-strong text-accent-text'}`}
          >
            <input
              type="file"
              accept={ACCEPT}
              multiple
              aria-label={t('generate.product.addImage')}
              aria-invalid={imagesBad || undefined}
              aria-describedby={imagesBad ? `${imageError} ${termsId}` : termsId}
              className="sr-only"
              onChange={(event) => {
                onPick(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
            <Icon name="add" size={20} />
            {empty && <span>{t('generate.product.drop')}</span>}
          </label>
        </div>
        {imagesBad && (
          <p id={imageError} className={`m-0 ${WARN}`}>
            <Icon name="warning" size={16} />
            {t('generate.error.images')}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-[1_1_280px] flex-wrap gap-x-4 gap-y-3">
        <div className="flex flex-[1_1_220px] flex-col gap-2 text-13 text-text-3">
          <label htmlFor={`${uid}-name`}>{t('generate.product.name')}</label>
          <Input
            id={`${uid}-name`}
            type="text"
            value={value.name}
            maxLength={NAME_MAX}
            aria-invalid={nameBad || undefined}
            aria-describedby={nameBad ? nameError : undefined}
            onChange={(event) => onChange({ name: event.target.value })}
          />
          {nameBad && (
            <span id={nameError} className={WARN}>
              <Icon name="warning" size={16} />
              {t(nameProblem === 'name-long' ? 'generate.error.nameLong' : 'generate.error.name')}
            </span>
          )}
        </div>
        <div className="flex flex-[1_1_220px] flex-col gap-2 text-13 text-text-3">
          <label htmlFor={`${uid}-info`}>{t('generate.product.info')}</label>
          <Input
            id={`${uid}-info`}
            type="text"
            value={value.description}
            maxLength={INFO_MAX}
            placeholder={t('generate.product.infoPlaceholder')}
            aria-invalid={infoBad || undefined}
            aria-describedby={infoBad ? infoError : undefined}
            onChange={(event) => onChange({ description: event.target.value })}
          />
          {infoBad && (
            <span id={infoError} className={WARN}>
              <Icon name="warning" size={16} />
              {t('generate.error.infoLong')}
            </span>
          )}
        </div>
      </div>
      {value.notes.map((note) => (
        <p key={note.id} role="alert" className={`m-0 basis-full ${WARN}`}>
          <Icon name="warning" size={16} />
          <span className="flex-1">{t(`generate.upload.${note.key}`, { name: note.name })}</span>
          <button type="button" onClick={() => onDismiss(note.id)} className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-13 font-medium text-text-2">
            {t('generate.upload.dismiss')}
          </button>
        </p>
      ))}
    </fieldset>
  );
}
