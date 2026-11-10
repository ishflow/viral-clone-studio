'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { cx } from '@/shared/lib/cx';
import { Icon } from '@/shared/ui';
import type { ShotPhase } from './steps';

const FRAME = 'block aspect-[9/16] w-full rounded-12 object-cover shadow-[0_0_0_1px_var(--media-edge)]';

/** What pressing the box does: open its picture large, or (`play`) play its clip in the box. */
export type ShotPress = { label: string; onPress: (event: MouseEvent<HTMLButtonElement>) => void; play?: boolean };

/**
 * One box of the running job's page: the first frame made for the shot (`made`), else the template's own frame of it, faded since it is
 * not the customer's shot (`original`), else its number. A made frame whose file cannot be loaded (it is gone) is given up: the box shows what it would without it.
 * `onGone` tells the page that frame is lost, so it can leave it out of what it lists.
 * With `press` the box is a button (a frame that is gone cannot be opened, a clip can still be played); with `video` the clip plays in its place.
 * `wide`: the box of a stage that is played, a little wider so the player's own controls fit.
 */
export function ShotBox({ number, phase, made, original, press, video, onGone, wide }: {
  number: number; phase: ShotPhase; made: string | null; original: string | null;
  press?: ShotPress; video?: { src: string; onFail: () => void }; onGone?: () => void; wide?: boolean;
}) {
  const t = useT();
  const [gone, setGone] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  // The clip starts when its box is pressed: the press that made this box a player counts as the page's user action, so the sound is allowed.
  // The button that was pressed is gone, so the focus goes to the player (else it falls to the page body and the keyboard has to start over).
  const playing = video?.src;
  useEffect(() => {
    if (!playing) return;
    player.current?.focus();
    void player.current?.play().catch(() => undefined);
  }, [playing]);
  const own = made !== null && !gone;
  const picture = own ? made : original;
  const cover = picture ? (
    // eslint-disable-next-line @next/next/no-img-element -- small frames of the shot, served as they are
    <img src={picture} alt="" onError={own ? () => { setGone(true); onGone?.(); } : undefined} className={cx(FRAME, !own && 'opacity-60')} />
  ) : (
    <div aria-hidden="true" className={cx(FRAME, 'flex items-center justify-center bg-raised font-display text-24 font-bold text-text-3')}>
      {number}
    </div>
  );
  const action = press && (press.play || own) ? press : null;
  return (
    <figure className={cx('m-0 flex snap-start flex-col gap-1 nav:flex-auto', wide ? 'flex-[0_0_140px]' : 'flex-[0_0_104px]')}>
      {video ? (
        <video ref={player} src={video.src} tabIndex={0} poster={picture ?? undefined} controls autoPlay playsInline preload="auto" onError={video.onFail} className={cx(FRAME, 'bg-raised object-contain')} />
      ) : action ? (
        <button type="button" aria-label={action.label} onClick={action.onPress} className="relative m-0 block cursor-pointer rounded-12 border-0 bg-transparent p-0 text-left">
          {cover}
          {action.play && (
            <span aria-hidden="true" className="absolute inset-0 m-auto flex size-12 items-center justify-center rounded-full bg-scrim text-on-scrim">
              <Icon name="play" size={22} />
            </span>
          )}
        </button>
      ) : (
        cover
      )}
      <figcaption className="flex flex-col text-13">
        <span className="text-text-3">{t('jobs.shot.number', { n: number })}</span>
        <span className={cx('font-medium', phase === 'ready' ? 'text-accent-text' : phase === 'waiting' ? 'text-text-3' : 'text-text')}>{t(`jobs.shot.${phase}`)}</span>
      </figcaption>
    </figure>
  );
}
