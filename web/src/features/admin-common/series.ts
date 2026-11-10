import type { DayValue } from '@/data/ports';
import type { BarDay } from '@/shared/ui';

/** The data layer's days as the chart draws them. */
export const toBarDays = (days: DayValue[]): BarDay[] => days.map((d) => ({ date: d.date, revenueCents: d.revenueCents, costCents: d.generationCostCents }));

/** The series of a period, or null when it cannot be read (the card then shows its own error and "Try again"). */
export async function readSeries(read: () => Promise<DayValue[]>): Promise<BarDay[] | null> {
  try {
    return toBarDays(await read());
  } catch {
    return null;
  }
}
