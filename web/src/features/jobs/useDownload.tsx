'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { downloadName } from '@/shared/lib/download-name';
import { Button, buttonClass } from '@/shared/ui';

/** How long the check of a file may take before the download counts as not started. */
const PROBE_MS = 15_000;

/** Asks for the first byte only: the file is there and the session may read it, or this throws. */
async function probe(url: string): Promise<void> {
  const response = await fetch(url, { headers: { range: 'bytes=0-0' }, credentials: 'same-origin', signal: AbortSignal.timeout(PROBE_MS) });
  void response.body?.cancel();
  if (!response.ok) throw new Error(`download-${response.status}`);
}

/** Hands the files to the browser: one download per file. */
function save(urls: string[], name: string) {
  urls.forEach((url) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
  });
}

/** `A-Sonuc-Durumlar`: a download is idle, being prepared (the files are checked first), or did not start. */
export function useDownload() {
  const [state, setState] = useState<'idle' | 'preparing' | 'failed'>('idle');
  const last = useRef<{ urls: string[]; title: string | undefined; jobId: string }>({ urls: [], title: undefined, jobId: '' });
  /** `title` and `jobId` give the files their name. */
  const run = async (urls: string[], title: string | undefined, jobId: string) => {
    const name = downloadName(title, jobId);
    last.current = { urls, title, jobId };
    setState('preparing');
    try {
      await Promise.all(urls.map(probe));
      save(urls, name);
      setState('idle');
    } catch {
      setState('failed');
    }
  };
  return { state, run, retry: () => run(last.current.urls, last.current.title, last.current.jobId) };
}

/** `The download did not start. Try again.` with `Try again` and `Contact support`. */
export function DownloadFailed({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="box-border flex basis-full flex-col gap-3 rounded-16 border border-warn-edge bg-surface p-4">
      <p className="m-0 text-15 leading-normal text-text-2">{t('jobs.result.downloadFailed')}</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" size="m" onClick={onRetry}>
          {t('jobs.result.downloadRetry')}
        </Button>
        <Link href="/contact" className={buttonClass('secondary', 'm', false)}>
          {t('jobs.stopped.contact')}
        </Link>
      </div>
    </div>
  );
}
