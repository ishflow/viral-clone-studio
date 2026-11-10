'use client';

import { Button } from './Button';
import { Dialog } from './Dialog';

/**
 * The "A-Hesap-Sil" pattern for a step that cannot be undone and needs no typed word: the safe choice is wide and bordered, the dangerous
 * one narrow with the warn border, no accent fill. Nothing is called before "confirm" is pressed.
 */
export function ConfirmDangerDialog({
  title,
  what,
  body,
  keepLabel,
  confirmLabel,
  error,
  pending,
  onKeep,
  onConfirm,
}: {
  title: string;
  /** What the step is about, in bold above the body (e.g. which video). */
  what?: string;
  body: string;
  keepLabel: string;
  confirmLabel: string;
  /** A failure of the last attempt; shown above the buttons. */
  error?: string | null;
  pending?: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onClose={onKeep} title={title} className="nav:max-w-148">
      <div className="-mt-4 flex flex-col gap-2">
        {what && <p className="m-0 text-15 font-semibold leading-normal text-text wrap-anywhere">{what}</p>}
        <p className="m-0 text-15 leading-normal text-text-2">{body}</p>
      </div>
      {error && (
        <p role="alert" className="m-0 text-15 leading-normal text-warn">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onKeep} className="flex-[2_1_240px]">
          {keepLabel}
        </Button>
        <Button variant="warn" pending={pending} onClick={onConfirm} className="flex-[1_1_160px]">
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
