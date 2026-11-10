'use client';

import { useT } from '@/core/i18n/I18nProvider';
import { Button, Dialog } from '@/shared/ui';

/** "Are you sure?" for a destructive admin action: what happens in one sentence, Cancel (wider, secondary) and the confirm button (warn). */
export function ConfirmDialog({
  open, onCancel, onConfirm, title, text, confirmLabel,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  text: string;
  confirmLabel: string;
}) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onCancel} title={title} className="text-left whitespace-normal">
      <p className="m-0 text-15 leading-normal text-text-2">{text}</p>
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-[1.4]" onClick={onCancel}>{t('adminTemplates.confirm.cancel')}</Button>
        <Button variant="warn" className="flex-1 px-3 whitespace-nowrap" onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}
