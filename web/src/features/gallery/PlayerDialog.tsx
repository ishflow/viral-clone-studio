'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import type { Shot } from '@/data/ports';
import { cx } from '@/shared/lib/cx';
import { formatSecondsRange } from '@/shared/lib/format';
import { buttonClass, Icon, MediaImage } from '@/shared/ui';
import type { PlayerData } from './player-data';

/** The number of the shot that holds `time`; after the last shot's end it stays on the last. */
export function currentShot(shots: Shot[], time: number): number {
  const hit = shots.find((s) => time >= s.from && time < s.to);
  return hit ? hit.n : (shots.at(-1)?.n ?? 0);
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

const ROUND = 'flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-current';

/** The sample player (boards A-Oynatici, A-Oynatici-M): video with a control strip, tags, the shot list, Clone it, Open template. */
/** `onTemplatePage`: the dialog sits on the template's own page, where Open template would only lead back to it. */
export function PlayerDialog({ open, onClose, player, onTemplatePage = false }: { open: boolean; onClose: () => void; player: PlayerData; onTemplatePage?: boolean }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const titleId = useId();
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(player.seconds);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof el.showModal === 'function') el.showModal();
    else el.setAttribute('open', '');
    el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      if (typeof el.close === 'function' && el.open) el.close();
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;

  const current = currentShot(player.shots, time);
  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCloseRef.current();
        }
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCloseRef.current();
      }}
      className="m-0 max-nav:h-dvh max-h-none w-full max-w-none overflow-y-auto rounded-none border-0 bg-surface p-0 text-text backdrop:bg-scrim nav:m-auto nav:max-h-[calc(100dvh-48px)] nav:max-w-238 nav:rounded-24 nav:border nav:border-edge"
    >
      <div className="relative flex flex-col nav:flex-row nav:gap-8 nav:p-6">
        <div ref={frame} className="relative w-full shrink-0 overflow-hidden bg-bg shadow-[0_0_0_1px_var(--media-edge)] nav:w-102 nav:self-start nav:rounded-16">
          <div className="relative aspect-9/16 w-full">
            <MediaImage src={player.image} alt="" fill sizes="408px" className="object-cover" />
            {player.video && (
              <video
                ref={video}
                src={player.video}
                poster={player.image}
                muted={muted}
                autoPlay
                playsInline
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                className="absolute inset-0 size-full object-cover"
              />
            )}
          </div>
          <div className="absolute right-4 bottom-4 left-4 flex flex-col gap-1 rounded-12 bg-scrim px-2 pt-3 pb-1 text-on-scrim nav:right-3 nav:bottom-3 nav:left-3">
            <div className="px-2">
              <div role="progressbar" aria-label={t('gallery.player.progress')} aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} className="flex gap-1">
                {player.shots.map((s) => (
                  <span key={s.n} style={{ flex: s.to - s.from }} className={cx('h-1 rounded-full', s.n <= current ? 'bg-accent' : 'bg-on-scrim opacity-50')} />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" aria-label={t(playing ? 'gallery.player.pause' : 'gallery.player.play')} onClick={toggle} className={ROUND}>
                <Icon name={playing ? 'pause' : 'play'} size={22} />
              </button>
              <span className="text-13 font-medium">{`${clock(time)} / ${clock(duration)}`}</span>
              <span className="flex-1" />
              <button type="button" aria-label={t(muted ? 'gallery.player.soundOn' : 'gallery.player.soundOff')} aria-pressed={!muted} onClick={() => setMuted((m) => !m)} className={ROUND}>
                <Icon name={muted ? 'sound off' : 'sound on'} size={22} />
              </button>
              <button type="button" aria-label={t('gallery.player.fullScreen')} onClick={() => void frame.current?.requestFullscreen?.()} className={cx(ROUND, 'hidden nav:flex')}>
                <Icon name="fullscreen" size={22} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-6 px-4 pt-4 pb-8 nav:p-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-2 nav:gap-3">
              <ul className="absolute top-6 right-18 left-4 m-0 flex list-none flex-wrap gap-2 p-0 nav:static nav:right-auto nav:left-auto">
                {player.tags.map((tag) => (
                  <li key={tag} className="rounded-full bg-scrim px-2.5 py-[5px] text-13 font-medium text-on-scrim nav:border nav:border-edge nav:bg-transparent nav:font-normal nav:text-text-2">
                    {tag}
                  </li>
                ))}
              </ul>
              <h1 id={titleId} className="m-0 font-display text-24 leading-[1.2] font-bold tracking-[-0.01em] text-balance nav:text-32 nav:leading-[1.1] nav:font-extrabold nav:tracking-[-0.02em]">
                {player.title}
              </h1>
              {(player.referenceLabel ?? player.views) && <p className="m-0 text-13 leading-snug text-text-3 text-pretty">{player.referenceLabel ?? t('gallery.player.subtitle', { views: player.views })}</p>}
            </div>
            <button
              type="button"
              data-autofocus
              aria-label={t('gallery.player.close')}
              onClick={onClose}
              className="absolute top-4 right-4 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-scrim text-on-scrim nav:static nav:border nav:border-solid nav:border-edge nav:bg-transparent nav:text-text"
            >
              <Icon name="close" size={20} />
            </button>
          </div>

          <section aria-label={t('gallery.player.shotList')} className="order-1 flex flex-col gap-2 nav:order-0">
            <h2 className="m-0 heading-6">{t('gallery.player.shotList')}</h2>
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {player.shots.map((s) => (
                <li key={s.n} aria-current={s.n === current ? 'step' : undefined} className={cx('flex min-h-11 items-center gap-4 rounded-8 px-3', s.n === current && 'bg-raised')}>
                  <span className={cx('w-24 shrink-0 text-13 font-semibold', s.n === current ? 'text-accent-text' : 'text-text-3')}>{formatSecondsRange(s.from, s.to, t)}</span>
                  <span className={cx('text-15', s.n === current ? 'text-text' : 'text-text-2')}>{s.action}</span>
                </li>
              ))}
            </ol>
          </section>

          <div className="mt-auto flex flex-wrap gap-3">
            <Link href={player.cloneHref} className={cx(buttonClass('primary', 'l'), 'flex-[2_1_200px]')}>
              {t('gallery.player.clone')}
            </Link>
            {!onTemplatePage && (
              <Link href={player.detailHref} className={cx(buttonClass('secondary', 'l'), 'flex-[1_1_160px]')}>
                {t('gallery.player.open')}
              </Link>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
