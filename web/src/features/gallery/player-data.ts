import type { Translate } from '@/core/i18n/types';
import type { Shot, Template } from '@/data/ports';
import { formatDuration, formatName, formatReference } from '@/shared/lib/format';

/** What the sample player needs, as plain data (it crosses from server pages into client components). */
export type PlayerData = {
  id: string;
  title: string;
  image: string;
  video: string | null;
  seconds: number;
  tags: string[];
  views: string;
  referenceLabel?: string;
  shots: Shot[];
  cloneHref: string;
  detailHref: string;
};

export function toPlayer(template: Template, t: Translate): PlayerData {
  return {
    id: template.id,
    title: template.title,
    image: template.image,
    video: template.video,
    seconds: template.seconds,
    tags: [template.category, formatName(template.format, t), formatDuration(template.seconds, t)].filter(Boolean),
    views: template.referenceViews,
    referenceLabel: template.referenceMetric ? formatReference(template, t) : undefined,
    shots: template.shots,
    cloneHref: `/templates/${template.id}/generate`,
    detailHref: `/templates/${template.id}`,
  };
}
