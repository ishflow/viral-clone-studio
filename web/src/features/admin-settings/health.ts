import { data } from '@/data';
import type { EngineHealth } from '@/data/ports';
import { providerOutOfCredits } from '../admin-common/credits';

/** `health()` as the settings page shows it: `lastSeenText` is written on the server, in server time like the scan times. */
export type HealthView = EngineHealth & { lastSeenText: string | null };

const pad = (n: number) => String(n).padStart(2, '0');

/** Call on the server only: the local clock of this process is the "server time" the page names. Out of credits: the jobs say so, or the worker's health does. */
export function toHealthView(health: EngineHealth, outOfCredits = false): HealthView {
  const at = health.lastSeen ? new Date(health.lastSeen) : null;
  const lastSeenText = at && !Number.isNaN(at.getTime())
    ? `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
    : null;
  return { ...health, lastSeenText, outOfCredits: outOfCredits || health.outOfCredits === true };
}

/** The health as of now, with the out-of-credits flag read from the jobs too (a jobs list that cannot be read counts as "no warning" from the jobs). */
export async function currentHealthView(): Promise<HealthView> {
  const [health, outOfCredits] = await Promise.all([data.admin.health(), data.admin.jobs({}).then(providerOutOfCredits).catch(() => false)]);
  return toHealthView(health, outOfCredits);
}
