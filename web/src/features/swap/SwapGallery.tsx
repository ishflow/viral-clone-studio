'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { formatCredits, formatDuration } from '@/shared/lib/format';
import { EmptyState, VideoCard, VideoGrid } from '@/shared/ui';
import type { SwapCard } from './load';

/** `/swap`: the videos a person can be swapped into. A card names the length, the number of people, the credits the data layer asks and, once it was used, how many times. */
export function SwapGallery({ cards }: { cards: SwapCard[] }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 heading-3">{t('swap.gallery.title')}</h1>
        <p className="m-0 max-w-160 text-17 leading-normal text-text-2">{t('swap.gallery.lead')}</p>
      </div>
      {cards.length === 0 ? (
        <EmptyState title={t('swap.gallery.empty.title')} text={t('swap.gallery.empty.text')} />
      ) : (
      <VideoGrid>
        {cards.map((card) => (
          <div key={card.id} className="min-w-0 [overflow-wrap:anywhere]">
            <VideoCard
              href={`/swap/${card.id}`}
              title={card.title}
              meta={[card.credits === null ? t('swap.gallery.priceUnknown') : formatCredits(card.credits, t), ...(card.uses > 0 ? [t('swap.gallery.uses', { count: card.uses })] : [])].join(' · ')}
              image={card.image}
              video={card.video}
              formatLabel={t('swap.gallery.people', { count: card.people })}
              durationLabel={formatDuration(card.seconds, t)}
            />
          </div>
        ))}
      </VideoGrid>
      )}
    </div>
  );
}
