'use client';

import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { MediaImage } from './MediaImage';
import { Tag } from './Tag';

export type VideoCardProps = {
  href: string;
  title: string;
  meta: string;
  image: string;
  video?: string | null;
  formatLabel: string;
  durationLabel: string;
  /** The `Free` label under the format label (a template the free video covers); none when absent. */
  freeLabel?: string;
};

/** Gallery card (9:16). The one link is named by the title; the clip, when there is one, plays muted on hover or keyboard focus. */
export function VideoCard({ href, title, meta, image, video, formatLabel, durationLabel, freeLabel }: VideoCardProps) {
  const titleId = useId();
  const metaId = useId();
  const player = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const start = () => {
    if (!video || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setPlaying(true);
    player.current?.play()?.catch(() => setPlaying(false));
  };
  const stop = () => {
    setPlaying(false);
    const el = player.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
  };

  return (
    <article className="flex min-w-0 flex-col gap-3">
      <Link
        href={href}
        aria-labelledby={titleId}
        aria-describedby={metaId}
        onMouseEnter={start}
        onMouseLeave={stop}
        onFocus={start}
        onBlur={stop}
        className="relative block aspect-9/16 overflow-hidden rounded-16 bg-surface shadow-[0_0_0_1px_var(--media-edge)]"
      >
        <MediaImage src={image} alt="" fill sizes="(min-width: 900px) 25vw, 50vw" className="object-cover" />
        {video && (
          <video
            ref={player}
            src={video}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden="true"
            tabIndex={-1}
            className={`absolute inset-0 size-full object-cover transition-opacity ${playing ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
        <Tag className="absolute top-2.5 left-2.5">{formatLabel}</Tag>
        {freeLabel && (
          <Tag accent className="absolute top-11 left-2.5">
            {freeLabel}
          </Tag>
        )}
        {/* Under 360 px the card is narrow: the length goes to the bottom corner so it never meets the format label. */}
        <Tag className="absolute top-2.5 right-2.5 max-[359px]:top-auto max-[359px]:bottom-2.5">{durationLabel}</Tag>
      </Link>
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="m-0 text-15 leading-snug font-semibold text-text text-pretty">
          {title}
        </h2>
        <p id={metaId} className="m-0 text-13 leading-snug text-text-3">
          {meta}
        </p>
      </div>
    </article>
  );
}
