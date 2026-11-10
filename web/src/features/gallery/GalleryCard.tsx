'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useT } from '@/core/i18n/I18nProvider';
import type { Template } from '@/data/ports';
import { formatDuration, formatName, formatReference } from '@/shared/lib/format';
import { Icon, VideoCard } from '@/shared/ui';
import { PlayerDialog } from './PlayerDialog';
import { toPlayer } from './player-data';

/**
 * Where there is hover (`@media (hover: hover)`) the overlay is inert and invisible until the card is hovered or focused within (the
 * board `Main`; Tab shows it). Where there is no hover (`@media (hover: none)`, touch) it is always shown and live, so "Clone it" (and the
 * play button) can be reached without a hover; a tap on the rest of the card still opens the template.
 */
export const OVERLAY =
  'pointer-events-none absolute inset-x-2 top-0 hidden aspect-9/16 flex-col items-center justify-between pt-14 pb-2 opacity-0 transition-opacity motion-reduce:transition-none group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:flex [@media(hover:none)]:flex [@media(hover:none)]:opacity-100';
export const LIVE = 'group-focus-within:pointer-events-auto group-hover:pointer-events-auto [@media(hover:none)]:pointer-events-auto';

/** Shared VideoCard plus the hover affordances of the board: "Clone it" and, when there is a sample, a play button that opens the player. */
export function GalleryCard({ template, free = false }: { template: Template; free?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const cloneHref = `/templates/${template.id}/generate`;
  return (
    <div className="group relative min-w-0 [overflow-wrap:anywhere]">
      <VideoCard
        href={`/templates/${template.id}`}
        title={template.title}
        meta={[template.category, formatReference(template, t) && `${t('common.reference.label')} ${formatReference(template, t)}`].filter(Boolean).join(' · ')}
        image={template.image || template.referenceImage || ''}
        video={template.video}
        formatLabel={formatName(template.format, t)}
        durationLabel={formatDuration(template.seconds, t)}
        freeLabel={free && template.format === 'no-talking' ? t('gallery.card.free') : undefined}
      />
      <div className={OVERLAY}>
        {template.video ? (
          <button
            type="button"
            aria-label={t('gallery.card.play', { title: template.title })}
            onClick={() => setOpen(true)}
            className={`${LIVE} flex size-11 cursor-pointer items-center justify-center rounded-full border-0 bg-scrim text-on-scrim`}
          >
            <Icon name="play" size={20} />
          </button>
        ) : (
          <span />
        )}
        <Link
          href={cloneHref}
          className={`${LIVE} flex min-h-11 w-full items-center justify-center rounded-8 bg-accent text-15 font-semibold text-on-accent no-underline hover:bg-accent-hover`}
        >
          {t('gallery.card.clone')}
        </Link>
      </div>
      {template.video && <PlayerDialog open={open} onClose={() => setOpen(false)} player={toPlayer(template, t)} />}
    </div>
  );
}
