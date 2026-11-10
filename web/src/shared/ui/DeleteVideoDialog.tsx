'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { ConfirmDangerDialog } from './ConfirmDangerDialog';

/**
 * `A-Video-Sil-Onay`: nothing is deleted before "Delete video". `count` is the number of videos the job delivered: a job with several
 * variants asks "Delete these 3 videos?". My videos and the result page open the same window with the same texts.
 */
export function DeleteVideoDialog({
  count,
  what,
  failed,
  pending,
  onKeep,
  onConfirm,
}: {
  count: number;
  /** Which video this is (template, products, day), shown above the body; the result page, which is the video itself, leaves it out. */
  what?: string;
  failed: boolean;
  pending: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <ConfirmDangerDialog
      title={t('common.deleteVideo.title', { count })}
      what={what}
      body={t('common.deleteVideo.body')}
      keepLabel={t('common.deleteVideo.keep')}
      confirmLabel={t('common.deleteVideo.submit')}
      error={failed ? t('common.deleteVideo.failed') : null}
      pending={pending}
      onKeep={onKeep}
      onConfirm={onConfirm}
    />
  );
}
