'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { cx } from '@/shared/lib/cx';
import { Button, Icon, buttonClass } from '@/shared/ui';

type Media = { image: string; video: string | null };
type Shot = { n: number; from: number; to: number; action: string };

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const FRAME = 'block aspect-[9/16] w-full rounded-12 object-cover shadow-[0_0_0_1px_var(--media-edge)] nav:rounded-16';
const ROUND = 'flex size-11 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-text disabled:cursor-not-allowed disabled:text-text-3';

/** `A-Karsilastir`: the gallery sample and the job's video side by side, one set of controls for both. */
export function CompareView({ jobId, title, seconds, shots, sample, yours }: { jobId: string; title: string; seconds: number; shots: Shot[]; sample: Media; yours: Media }) {
  const t = useT();
  const sampleRef = useRef<HTMLVideoElement>(null);
  const yoursRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState(0);
  const playable = Boolean(sample.video || yours.video);
  const videos = () => [sampleRef.current, yoursRef.current].filter((v): v is HTMLVideoElement => v !== null);

  const toggle = () => {
    const next = !playing;
    videos().forEach((video) => {
      if (next) void video.play();
      else video.pause();
    });
    setPlaying(next);
  };
  const toggleSound = () => {
    const next = !muted;
    videos().forEach((video) => (video.muted = next));
    setMuted(next);
  };
  const follow = (video: HTMLVideoElement) => setTime(video.currentTime);
  const ended = () => {
    videos().forEach((video) => {
      video.currentTime = 0;
      video.pause();
    });
    setPlaying(false);
    setTime(0);
  };

  const currentIndex = Math.max(0, shots.findLastIndex((shot) => shot.from <= time));
  const current = shots[currentIndex];
  const clip = (media: Media, ref: typeof yoursRef, alt: string, primary: boolean) =>
    media.video ? (
      <video
        ref={ref}
        src={media.video}
        poster={media.image}
        muted={muted}
        playsInline
        preload="metadata"
        onTimeUpdate={primary ? (event) => follow(event.currentTarget) : undefined}
        onEnded={primary ? ended : undefined}
        className={cx(FRAME, 'bg-surface')}
      />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element -- a static sample frame
      <img src={media.image} alt={alt} className={FRAME} />
    );
  // The job's video leads the clock; the sample leads only when the job has no file.
  const sampleLeads = !yours.video;
  // One Download for each layout: the top strip on desktop, the bottom of the page on the phone.
  const download = (size: 'm' | 'l', className: string) =>
    yours.video ? (
      <a href={yours.video} download className={buttonClass('primary', size, false, cx('gap-2', className))}>
        <Icon name="download" size={18} />
        {t('jobs.compare.download')}
      </a>
    ) : (
      <Button size={size} disabled className={cx('gap-2', className)}>
        <Icon name="download" size={18} />
        {t('jobs.compare.download')}
      </Button>
    );

  return (
    <div className="flex flex-col gap-6 nav:gap-8">
      <div className="-mt-4 flex items-center justify-between gap-x-8 border-b border-line py-3 nav:mt-0 nav:py-4">
        <Link href={`/jobs/${jobId}`} className="flex min-h-11 items-center gap-2 text-15 text-text-3 no-underline hover:text-text">
          <Icon name="back" size={18} />
          {t('jobs.compare.back')}
        </Link>
        <span aria-hidden="true" className="heading-5 max-nav:hidden">
          {title}
        </span>
        {download('m', 'max-nav:hidden')}
      </div>
      <h1 className="m-0 heading-5 nav:sr-only">{title}</h1>
      <div className="flex items-start justify-center gap-3 nav:flex-wrap nav:gap-8">
        <figure className="m-0 flex min-w-0 flex-[1_1_0] flex-col gap-3 nav:flex-[0_1_380px]">
          {clip(sample, sampleRef, t('jobs.compare.sampleAlt'), sampleLeads)}
          <figcaption className="flex flex-col gap-1">
            <span className="text-15 font-semibold">{t('jobs.compare.sample')}</span>
            <span className="text-13 leading-snug text-text-3">{t('jobs.compare.sampleSub')}</span>
          </figcaption>
        </figure>
        <figure className="m-0 flex min-w-0 flex-[1_1_0] flex-col gap-3 nav:flex-[0_1_380px]">
          {clip(yours, yoursRef, t('jobs.compare.yoursAlt'), !sampleLeads)}
          <figcaption className="flex flex-col gap-1">
            <span className="text-15 font-semibold">{t('jobs.compare.yours')}</span>
            <span className="text-13 leading-snug text-text-3">{t('jobs.compare.yoursSub')}</span>
          </figcaption>
        </figure>
      </div>

      <div
        role="group"
        aria-label={t('jobs.compare.playback')}
        className="box-border flex w-full flex-col gap-3 self-center rounded-16 border border-line bg-surface p-4 nav:max-w-198"
      >
        <div aria-hidden="true" className="flex gap-1">
          {shots.map((shot) => (
            <span key={shot.n} style={{ flex: shot.to - shot.from }} className={cx('h-1 rounded-full', time >= shot.from ? 'bg-accent-text' : 'bg-text-3 opacity-50')} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" disabled={!playable} aria-label={playing ? t('jobs.compare.pause') : t('jobs.compare.play')} onClick={toggle} className={ROUND}>
            <Icon name={playing ? 'pause' : 'play'} size={22} />
          </button>
          <span className="flex-1 text-15 font-semibold nav:flex-none">{`${clock(time)} / ${clock(seconds)}`}</span>
          {current && (
            <span className="order-1 basis-full text-15 text-text-2 nav:order-none nav:flex-[1_1_200px] nav:basis-auto">
              {t('jobs.compare.shot', { n: currentIndex + 1, total: shots.length, action: current.action })}
            </span>
          )}
          <button type="button" disabled={!playable} aria-label={muted ? t('jobs.compare.soundOn') : t('jobs.compare.soundOff')} onClick={toggleSound} className={ROUND}>
            <Icon name={muted ? 'sound off' : 'sound on'} size={22} />
          </button>
        </div>
      </div>

      {download('l', 'self-center nav:hidden max-nav:w-full')}
    </div>
  );
}
