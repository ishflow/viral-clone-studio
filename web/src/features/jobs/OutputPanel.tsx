'use client';

import { useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import type { JobMade } from '@/data/ports';
import { cx } from '@/shared/lib/cx';
import type { OutputView } from './output';
import { PictureViewer, type Picture } from './PictureViewer';
import { ShotBox } from './ShotBox';
import type { ShotPhase } from './steps';

/** One box of the panel: the shot's own file (`made`, `clipUrl`), the template's frame of it, and where the shot is. */
export type Box = { made: string | null; original: string | null; clipUrl: string | null; phase: ShotPhase };

const GRID = 'flex snap-x snap-mandatory gap-2 overflow-x-auto nav:overflow-visible nav:pr-0 -mr-4 pr-4 nav:mr-0 nav:grid';
const COLUMNS = { images: 'nav:grid-cols-[repeat(auto-fit,minmax(min(104px,100%),1fr))]', clips: 'nav:grid-cols-[repeat(auto-fit,minmax(min(140px,100%),1fr))]' };

/** The pictures of the Images stage: the boxes (a shot's own frame, in the order of the shots), then those every shot shares. */
function ImagesPanel({ boxes, shared, onUse }: { boxes: Box[]; shared: JobMade['shared']; onUse: () => void }) {
  const t = useT();
  // The picture that is open is held by its own id (a shot's box, or the shared picture's variant and address), never by its place in the list: the list grows as frames arrive.
  const [open, setOpen] = useState<{ id: string; opener: HTMLElement } | null>(null);
  // A frame whose file cannot be loaded is no picture to look at: it is left out of the large view's order.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const lose = (url: string) => setGone((now) => new Set(now).add(url));
  const shots = boxes.flatMap((box, index) => (box.made && !gone.has(box.made) ? [{ id: `shot:${index}`, url: box.made, label: t('jobs.shot.number', { n: index + 1 }) }] : []));
  const sharedPictures = shared.filter((file) => !gone.has(file.url)).map((file) => ({ id: `shared:${file.variant}:${file.url}`, url: file.url, label: t('jobs.shot.sharedPicture') }));
  const pictures: Picture[] = [...shots, ...sharedPictures];
  const press = (id: string) => (event: { currentTarget: HTMLElement }) => { onUse(); setOpen({ id, opener: event.currentTarget }); };
  const at = open === null ? -1 : pictures.findIndex((picture) => picture.id === open.id);
  return (
    <>
      <div className={cx(GRID, COLUMNS.images)}>
        {boxes.map((box, index) => (
          <ShotBox key={index} number={index + 1} phase={box.phase} made={box.made} original={box.original} onGone={box.made ? () => lose(box.made!) : undefined}
            press={box.made ? { label: t('jobs.shot.openPicture', { n: index + 1 }), onPress: press(`shot:${index}`) } : undefined} />
        ))}
      </div>
      {sharedPictures.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-13 font-medium text-text-3">{t('jobs.running.sharedLabel')}</h3>
          <div className="flex flex-wrap gap-2">
            {sharedPictures.map((picture) => (
              <button key={picture.id} type="button" aria-label={t('jobs.shot.openShared')} onClick={press(picture.id)} className="m-0 cursor-pointer rounded-12 border-0 bg-transparent p-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- a picture the site made, served as it is */}
                <img src={picture.url} alt="" onError={() => lose(picture.url)} className="block aspect-[9/16] w-[104px] rounded-12 object-cover shadow-[0_0_0_1px_var(--media-edge)]" />
              </button>
            ))}
          </div>
        </div>
      )}
      {open !== null && at >= 0 && <PictureViewer pictures={pictures} index={at} onIndex={(index) => setOpen({ ...open, id: pictures[index]!.id })} onClose={() => setOpen(null)} opener={open.opener} />}
    </>
  );
}

/** The clips of the Clips stage: a ready one is pressed to play, in its own box; one plays at a time, and nothing plays by itself. */
function ClipsPanel({ boxes, onUse, round }: { boxes: Box[]; onUse: () => void; round: object }) {
  const t = useT();
  const [playing, setPlaying] = useState<number | null>(null);
  // A clip that could not be loaded is not offered until the next refresh of the page (`round` is the job as that refresh gave it), when it may be tried again.
  const [lost, setLost] = useState<{ round: object; boxes: ReadonlySet<number> }>({ round, boxes: new Set() });
  const failed = lost.round === round ? lost.boxes : new Set<number>();
  return (
    <div className={cx(GRID, COLUMNS.clips)}>
      {boxes.map((box, index) => {
        const ready = box.clipUrl !== null && !failed.has(index);
        return (
          <ShotBox key={index} number={index + 1} phase={box.phase} made={box.made} original={box.original} wide
            press={ready ? { label: t('jobs.shot.playClip', { n: index + 1 }), onPress: () => { onUse(); setPlaying(index); }, play: true } : undefined}
            video={ready && playing === index ? { src: box.clipUrl!, onFail: () => { setLost({ round, boxes: new Set(failed).add(index) }); setPlaying(null); } } : undefined} />
        );
      })}
    </div>
  );
}

/** The music of the Music stage: the browser's own audio player for each track (one for each variant). */
function MusicPanel({ music }: { music: JobMade['music'] }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      {music.map((file) => (
        <div key={file.url} className="flex flex-col gap-2">
          {music.length > 1 && <span className="text-13 text-text-3">{t('jobs.running.musicVariant', { n: file.variant })}</span>}
          <audio src={file.url} controls preload="metadata" className="w-full max-w-md" />
        </div>
      ))}
    </div>
  );
}

/** What the right side of the page shows for the stage chosen (or followed). `round`: the job as the last refresh of the page gave it. `onUse`: the customer opened a picture or played a clip, which counts as choosing this stage (the panel stops following the job). */
export function OutputPanel({ view, boxes, made, round, onUse }: { view: OutputView; boxes: Box[]; made: JobMade; round: object; onUse: () => void }) {
  return view === 'music' ? <MusicPanel music={made.music} /> : view === 'clips' ? <ClipsPanel boxes={boxes} onUse={onUse} round={round} /> : <ImagesPanel boxes={boxes} shared={made.shared} onUse={onUse} />;
}
