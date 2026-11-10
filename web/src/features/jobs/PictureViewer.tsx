'use client';

import { useEffect, useRef } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { Icon } from '@/shared/ui';

export type Picture = { id: string; url: string; label: string };

// The two ends use `aria-disabled`, not `disabled`: a disabled button that has the focus hands it to the page, and the arrow keys stop reaching the picture.
const BUTTON = 'flex size-11 cursor-pointer items-center justify-center rounded-full border border-edge-strong bg-surface text-text aria-disabled:cursor-default aria-disabled:opacity-40';

/**
 * A picture of the job, large, over the page: Escape or a press outside closes it and the focus goes back to what opened it; the arrow
 * keys and the two buttons go to the previous and the next picture (no wrapping).
 */
export function PictureViewer({ pictures, index, onIndex, onClose, opener }: {
  pictures: Picture[]; index: number; onIndex: (index: number) => void; onClose: () => void; opener: HTMLElement | null;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef(onClose);
  useEffect(() => { closing.current = onClose; });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof el.showModal === 'function') el.showModal();
    else el.setAttribute('open', '');
    return () => {
      if (typeof el.close === 'function' && el.open) el.close();
      opener?.focus();
    };
  }, [opener]);
  const picture = pictures[index];
  if (!picture) return null;
  const step = (by: number) => { if (pictures[index + by]) onIndex(index + by); };
  return (
    <dialog
      ref={ref}
      aria-label={picture.label}
      onCancel={(event) => { event.preventDefault(); closing.current(); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); closing.current(); }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
        else if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
      }}
      onClick={(event) => { if (event.target === event.currentTarget) closing.current(); }}
      className="m-0 box-border h-full max-h-none w-full max-w-none border-0 bg-transparent p-4 text-text backdrop:bg-scrim"
    >
      <div className="pointer-events-none mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- the picture the site made, served as it is */}
        <img src={picture.url} alt={picture.label} className="pointer-events-auto min-h-0 max-w-full flex-[0_1_auto] rounded-12 object-contain shadow-[0_0_0_1px_var(--media-edge)]" style={{ maxHeight: 'calc(100vh - 8.5rem)' }} />
        <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-surface px-3 py-2 text-15">
          <button type="button" aria-label={t('jobs.viewer.previous')} aria-disabled={index === 0} onClick={() => step(-1)} className={BUTTON}>
            <Icon name="back" />
          </button>
          <span className="min-w-28 text-center">
            <span className="block font-medium">{picture.label}</span>
            <span className="block text-13 text-text-3">{t('jobs.viewer.count', { n: index + 1, total: pictures.length })}</span>
          </span>
          <button type="button" aria-label={t('jobs.viewer.next')} aria-disabled={index === pictures.length - 1} onClick={() => step(1)} className={BUTTON}>
            <Icon name="forward" />
          </button>
          <button type="button" aria-label={t('jobs.viewer.close')} onClick={() => closing.current()} className={BUTTON}>
            <Icon name="close" />
          </button>
        </div>
      </div>
    </dialog>
  );
}
