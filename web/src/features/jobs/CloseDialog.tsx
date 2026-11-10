'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { ConfirmDangerDialog } from '@/shared/ui/ConfirmDangerDialog';

/** `A-Is-Kapat-Onay`: "Stop the job here" asks first. Nothing is sent before "Close the job". The safe choice, "Keep it", is the wide one. */
export function CloseDialog({ finished, failed, pending, onKeep, onConfirm }: { finished: { images: number; clips: number }; failed: boolean; pending: boolean; onKeep: () => void; onConfirm: () => void }) {
  const t = useT();
  // Closing deletes the parts made so far (contract §6): say so plainly, and how many of the paid ones there are.
  const parts = [
    finished.images > 0 ? t('jobs.unit.finishedImage', { count: finished.images }) : '',
    finished.clips > 0 ? t('jobs.unit.clipReady', { count: finished.clips }) : '',
  ].filter(Boolean).join(', ');
  return (
    <ConfirmDangerDialog
      title={t('jobs.close.title')}
      body={parts ? t('jobs.close.bodyParts', { parts }) : t('jobs.close.body')}
      keepLabel={t('jobs.close.keep')}
      confirmLabel={t('jobs.close.submit')}
      error={failed ? t('jobs.close.failed') : null}
      pending={pending}
      onKeep={onKeep}
      onConfirm={onConfirm}
    />
  );
}
