'use client';

import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import type { Template } from '@/data/ports';
import { formatCredits, formatDate, formatReference, formatDuration, formatName, formatSecondsRange } from '@/shared/lib/format';
import { buttonClass, Icon, MediaImage } from '@/shared/ui';
import { removeTemplate } from './actions';
import { PlayerDialog } from './PlayerDialog';
import { toPlayer } from './player-data';
import { reasonKey } from './reason';
import { tagName } from './tag-name';

/** The engine writes "none" for a shot with no words on screen; that is no text to show. */
const hasText = (text: string) => text.trim() !== '' && text.trim().toLowerCase() !== 'none';

const TAG = 'flex items-center gap-1 rounded-full border border-edge px-3 py-1.5 text-13 text-text-2';

/** Boards A-Detay (catalog template) and A-Detay-Ozel (the viewer's own private template). */
export function TemplateDetail({ template, free = false, talkingCredits = null }: {
  template: Template;
  /** The free video covers this template for the viewer (see `freeApplies`): the line `Free with your first video`. */
  free?: boolean;
  /** What a talking template costs at Fast quality; null for a template without talking. */
  talkingCredits?: number | null;
}) {
  const t = useT();
  const locale = useLocale();
  const [playing, setPlaying] = useState(false);
  const [deleting, setDeleting] = useState<'ask' | 'busy' | 'in-use' | 'failed' | null>(null);
  const own = template.status === 'private';
  const ready = template.preparation !== 'preparing' && template.preparation !== 'failed' && (!own || template.preparation === 'ready');
  const cloneHref = `/templates/${template.id}/generate`;
  const totalShots = template.shots.length;
  // A template that is not prepared has no shots and no length yet: its page does not state what it does not know.
  const read = totalShots > 0;
  const hasLength = template.seconds > 0;
  const shownChips = [formatName(template.format, t), ...(hasLength ? [formatDuration(template.seconds, t)] : []), ...(!own && template.category ? [template.category] : [])];
  const tagNames = [...new Set(template.tags.map((tag) => tagName(tag, t)))].filter((name) => !shownChips.includes(name));

  return (
    <div className="flex flex-col gap-8 max-nav:-mt-6 max-nav:gap-2">
      <Link href={own ? '/templates/new#yours' : '/gallery'} className="flex min-h-11 items-center gap-2 self-start text-15 text-text-3 no-underline hover:text-text">
        <Icon name="back" size={18} />
        {t(own ? 'gallery.add.yours' : 'gallery.detail.back')}
      </Link>

      <div className="flex flex-wrap items-start gap-x-18 gap-y-6">
        <figure className={`m-0 flex max-w-100 flex-[1_1_300px] flex-col gap-3 max-nav:max-w-none max-nav:flex-[1_1_100%] ${own ? '' : 'max-nav:box-border max-nav:items-center max-nav:rounded-16 max-nav:border max-nav:border-line max-nav:bg-surface max-nav:p-4'}`}>
          {template.referenceVideo && (own || !template.video) ? <video controls preload="none" src={template.referenceVideo} poster={template.referenceImage ?? undefined} className="aspect-9/16 w-full rounded-16 object-cover" aria-label={t('gallery.detail.yourReference')} /> : own ? (
            <div className="box-border flex w-full flex-col items-center justify-center gap-2 rounded-16 border-[1.5px] border-dashed border-edge-strong p-6 text-center nav:aspect-9/16 max-nav:px-6 max-nav:py-8">
              <span className="text-15 text-text-2">{t('gallery.detail.yourReference')}</span>
              <span className="text-13 leading-snug text-text-3">{t('gallery.detail.noSample')}</span>
            </div>
          ) : !(template.image || template.referenceImage) ? (
            <div className="box-border flex w-full items-center justify-center rounded-16 border-[1.5px] border-dashed border-edge-strong p-6 text-center nav:aspect-9/16 max-nav:px-6 max-nav:py-8">
              <span className="text-15 text-text-2">{t('gallery.detail.noSample')}</span>
            </div>
          ) : (
            <div className="relative w-full overflow-hidden bg-surface shadow-[0_0_0_1px_var(--media-edge)] nav:rounded-16 max-nav:w-3/5 max-nav:rounded-12">
              <MediaImage src={template.image || template.referenceImage || ''} alt={t('gallery.detail.frameAlt', { title: template.title })} width={400} height={711} sizes="400px" priority className="block aspect-9/16 w-full object-cover" />
              {template.video && (
                <button
                  type="button"
                  aria-label={t('gallery.detail.play')}
                  onClick={() => setPlaying(true)}
                  className="absolute top-1/2 left-1/2 flex max-nav:size-15 nav:size-18 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-scrim text-on-scrim"
                >
                  <Icon name="play" size={26} />
                </button>
              )}
              <div aria-hidden="true" className="absolute right-3 bottom-3 left-3 flex gap-1 rounded-full bg-scrim px-3 py-2">
                {template.shots.map((s, i) => (
                  <span key={s.n} style={{ flex: s.to - s.from }} className={`h-1 rounded-full ${i === 0 ? 'bg-accent' : 'bg-on-scrim opacity-50'}`} />
                ))}
              </div>
            </div>
          )}
          {(own || template.video) && (
            <figcaption className={`text-13 leading-snug text-text-3 ${own ? '' : 'max-nav:text-center'}`}>
              {t(own ? (template.preparation === 'failed' ? 'gallery.detail.privateCaptionFailed' : 'gallery.detail.privateCaption') : 'gallery.detail.caption')}
            </figcaption>
          )}
        </figure>

        <div className="flex min-w-0 flex-[2_1_480px] flex-col gap-6 nav:gap-8">
          <div className="contents nav:order-0 nav:flex nav:flex-col nav:gap-4">
            <ul className="order-1 m-0 -mb-2 flex list-none flex-wrap gap-2 p-0 nav:mb-0">
              {own && (
                <li className={TAG}>
                  <Icon name="private" size={14} />
                  {t('gallery.detail.onlyYou')}
                </li>
              )}
              {own && <li className="rounded-full border border-dashed border-edge-strong px-3 py-1.5 text-13 text-text-2">{t('gallery.detail.experimental')}</li>}
              {!own && template.category && <li className={TAG}>{template.category}</li>}
              <li className={TAG}>{formatName(template.format, t)}</li>
              {hasLength && <li className={TAG}>{formatDuration(template.seconds, t)}</li>}
              {tagNames.map((name) => (
                <li key={name} className={TAG}>
                  {name}
                </li>
              ))}
            </ul>
            <h1 className="order-2 m-0 heading-2 text-balance [overflow-wrap:anywhere]">{template.title}</h1>
            {!own && template.description && <p className="order-4 m-0 max-w-155 text-17 leading-normal text-text-2 text-pretty">{template.description}</p>}
            {own && read && <p className="order-4 m-0 max-w-155 text-17 leading-normal text-text-2 text-pretty">{t('gallery.detail.privateLead')}</p>}
          </div>

          <div className="order-3 flex flex-wrap items-center gap-x-8 gap-y-4">
            {ready && (
              <Link href={cloneHref} className={`${buttonClass('primary', 'l')} w-full flex-[1_1_100%] nav:w-auto nav:flex-none`}>
                {t('gallery.detail.clone')}
              </Link>
            )}
            {ready && free && (
              <p className="m-0 flex basis-full items-center gap-2 text-15 font-medium text-accent-text">
                <Icon name="done" size={18} />
                {t('gallery.detail.free')}
              </p>
            )}
            {ready && !free && talkingCredits !== null && <p className="m-0 basis-full text-15 font-medium text-text-2">{t('gallery.detail.needsCredits', { credits: formatCredits(talkingCredits, t) })}</p>}
            {ready && own && <p className="m-0 basis-full text-13 leading-snug text-text-3">{t('gallery.detail.rights')}</p>}
            <dl className="m-0 flex flex-wrap gap-x-6 gap-y-2 text-15">
              {read && <Fact label={t('gallery.detail.need')} value={t('gallery.detail.products', { count: template.products })} />}
              {totalShots > 0 && <Fact label={t('gallery.detail.shots')} value={String(totalShots)} />}
              {hasLength && <Fact label={t('gallery.detail.length')} value={t('gallery.detail.finalVideo', { duration: formatDuration(template.seconds, t) })} sub={read ? t('gallery.detail.madeFrom', { count: totalShots }) : undefined} />}
              {own ? (
                <Fact label={t('gallery.detail.added')} value={formatDate(template.editedAt, locale)} />
              ) : (
                <Fact label={t('gallery.detail.reference')} value={template.referenceMetric ? formatReference(template, t) : template.referenceLikes ? t('gallery.detail.referenceValueLikes', { views: template.referenceViews, likes: template.referenceLikes }) : t('gallery.detail.referenceValue', { views: template.referenceViews })} />
              )}
            </dl>
          </div>

          {own && template.preparation === 'preparing' && <Note>{t('gallery.detail.preparing')}</Note>}
          {own && template.preparation === 'failed' && <Note>{t(reasonKey(template.preparationNote))}</Note>}
          <Note>{t('gallery.detail.promise')}</Note>
          {own && ready && (
            <p className="order-5 m-0 flex items-start gap-3 rounded-12 border border-line bg-surface px-4 py-3 text-15 leading-normal text-text-2 text-pretty">
              <Icon name="warning" size={20} className="shrink-0 text-text-3" />
              <span>{t('gallery.detail.untested')}</span>
            </p>
          )}

          {totalShots > 0 && <section aria-label={t('gallery.detail.shotList')} className="order-6 flex flex-col gap-1">
            <h2 className="m-0 mb-2 heading-5">{t('gallery.detail.shotList')}</h2>
            {template.shots.map((s) => (
              <div key={s.n} className="flex items-center gap-4 border-t border-line py-3">
                {!s.image && (own || !(template.image || template.referenceImage)) ? (
                  <span aria-hidden="true" className="box-border h-19.5 w-11 shrink-0 rounded-8 border-[1.5px] border-dashed border-edge-strong" />
                ) : (
                  <MediaImage src={s.image || template.image || template.referenceImage || ''} alt="" width={44} height={78} className="h-19.5 w-11 shrink-0 rounded-8 object-cover shadow-[0_0_0_1px_var(--media-edge)]" />
                )}
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1 nav:items-center">
                  <span className="w-24 shrink-0 text-15 font-semibold text-accent-text">{formatSecondsRange(s.from, s.to, t)}</span>
                  <span className="min-w-40 flex-[3_1_160px] text-15">{s.action}</span>
                  {hasText(s.text) && <span className="min-w-60 flex-[2_1_240px] text-13 text-text-3">{t('gallery.detail.onScreen', { text: s.text })}</span>}
                </div>
              </div>
            ))}
          </section>}

          {own && (
            <div className="order-7 flex flex-col items-start gap-2">
              {deleting === null || deleting === 'in-use' || deleting === 'failed' ? (
                <button type="button" onClick={() => setDeleting('ask')} className="flex min-h-11 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-15 font-medium text-warn">
                  {t('gallery.detail.delete')}
                </button>
              ) : (
                <div role="group" aria-label={t('gallery.detail.delete')} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-15 text-text-2">{t('gallery.detail.deleteConfirm')}</span>
                  <button
                    type="button"
                    disabled={deleting === 'busy'}
                    onClick={async () => {
                      setDeleting('busy');
                      // On success the action moves to the user's templates; an answer means it did not delete.
                      try {
                        setDeleting((await removeTemplate(template.id)).code);
                      } catch (error) {
                        unstable_rethrow(error);
                        setDeleting('failed');
                      }
                    }}
                    className="flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-15 font-semibold text-warn disabled:cursor-not-allowed disabled:text-text-3"
                  >
                    {t('gallery.detail.deleteYes')}
                  </button>
                  <button type="button" disabled={deleting === 'busy'} onClick={() => setDeleting(null)} className="flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-15 text-text-2">
                    {t('gallery.detail.deleteCancel')}
                  </button>
                </div>
              )}
              {(deleting === 'in-use' || deleting === 'failed') && (
                <p role="alert" className="m-0 text-13 leading-snug text-warn">
                  {t(deleting === 'in-use' ? 'gallery.detail.deleteInUse' : 'gallery.detail.deleteFailed')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      {template.video && !own && <PlayerDialog open={playing} onClose={() => setPlaying(false)} player={toPlayer(template, t)} onTemplatePage />}
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-text-3">{label}</dt>
      <dd className="m-0 font-semibold">{value}</dd>
      {sub && <dd className="m-0 text-13 text-text-3">{sub}</dd>}
    </div>
  );
}

function Note({ children }: { children: string }) {
  return <p className="order-5 m-0 rounded-12 border border-line bg-surface px-4 py-3 text-15 leading-normal text-text-2 text-pretty">{children}</p>;
}
