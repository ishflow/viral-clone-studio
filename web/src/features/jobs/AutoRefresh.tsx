'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import { JobNotice } from './JobNotice';

/** After this many answers in a row that did not come, the page says it is reconnecting (one miss is a hiccup). */
const MISSES_BEFORE_NOTICE = 2;
const DEFAULT_EVERY_MS = 2000;

/**
 * While a job waits or runs, asks the server for a fresh page every 2 seconds (`everyMs` sets another pace, the video list asks more slowly). Quiet while the tab is hidden; one refresh when it comes
 * back. Each tick first asks for a small static file: after two misses in a row the page shows "Reconnecting…", and the first answer that
 * comes back takes it away and refreshes the page again. The job itself is not affected.
 */
export function AutoRefresh({ everyMs = DEFAULT_EVERY_MS }: { everyMs?: number }) {
  const router = useRouter();
  const t = useT();
  const [reconnecting, setReconnecting] = useState(false);
  const misses = useRef(0);
  useEffect(() => {
    let alive = true;
    // Asks for the small file and keeps count. True when the answer came.
    const probe = async (): Promise<boolean> => {
      let ok = false;
      try {
        ok = typeof navigator === 'undefined' || navigator.onLine !== false ? (await fetch('/favicon.ico', { method: 'HEAD', cache: 'no-store' })).ok : false;
      } catch {
        ok = false;
      }
      if (!alive) return false;
      misses.current = ok ? 0 : misses.current + 1;
      setReconnecting(misses.current >= MISSES_BEFORE_NOTICE);
      return ok;
    };
    // The page is refreshed only when the answer came: a refresh that cannot reach the server makes the router leave for the browser's own
    // "no connection" page, and the customer loses the job page. So while the connection is gone the page stays and says "Reconnecting…".
    const tick = () => {
      void probe().then((ok) => {
        if (ok) router.refresh();
      });
    };
    const timer = setInterval(() => {
      if (!document.hidden) tick();
    }, everyMs);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router, everyMs]);
  return reconnecting ? (
    <JobNotice tone="info" icon="generating" spin>
      {t('jobs.notice.reconnecting')}
    </JobNotice>
  ) : null;
}
