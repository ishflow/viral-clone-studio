'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { RULES } from '@/data/ports';

const EVERY_MS = 3000;

/**
 * Asks the server again every few seconds while the payment is being confirmed. The server decides when "confirming" turns into "delayed"
 * (it measures the time, so a closed browser does not stretch it); this only refreshes, and stops by itself a little after that limit.
 * A refresh changes nothing: credits are added once, by the provider's answer.
 */
export function PollRefresh() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), EVERY_MS);
    const stop = setTimeout(() => clearInterval(id), (RULES.checkoutWaitSeconds + 10) * 1000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [router]);
  return null;
}
