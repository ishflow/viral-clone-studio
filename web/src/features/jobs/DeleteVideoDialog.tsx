'use client';

import { useState } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { DeleteVideoDialog as ConfirmDeleteVideo } from '@/shared/ui';
import { deleteJobVideo } from './result-actions';

/** Board A-Video-Sil-Onay, from the result page: the shared window, and what the page does on "Delete video". The credits are not returned. */
export function DeleteVideoDialog({ jobId, variants, onClose }: { jobId: string; variants: number; onClose: () => void }) {
  const [state, setState] = useState<'ask' | 'busy' | 'error'>('ask');
  const remove = async () => {
    setState('busy');
    try {
      await deleteJobVideo(jobId); // on success the action moves to My videos; an answer means nothing was deleted
      setState('error');
    } catch (error) {
      unstable_rethrow(error);
      setState('error');
    }
  };
  return <ConfirmDeleteVideo count={variants} failed={state === 'error'} pending={state === 'busy'} onKeep={onClose} onConfirm={() => void remove()} />;
}
