'use server';

import { parsePeriod } from '@/core/period';
import { requireAdmin } from '@/core/session/guards';
import { data } from '@/data';
import type { BarDay } from '@/shared/ui';
import { toBarDays } from './series';

/** The days of the chart for a period, for the card's "Try again". null when it cannot be read: the card shows its error. */
export async function loadDailySeries(period: string): Promise<BarDay[] | null> {
  await requireAdmin();
  try {
    return toBarDays(await data.admin.dailySeries(parsePeriod(period)));
  } catch {
    return null;
  }
}
