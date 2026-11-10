// The scan schedule: at each time of `settings.scanTimes` (local) every switched-on source gets one scan run.
import type { DatabaseSync } from 'node:sqlite';
import type { Settings } from '../contracts.ts';
import type { Clock } from '../ports.ts';
import { enqueue } from '../db/runs.ts';
import { readSettings } from '../db/settings.ts';

type Source = 'topads' | 'shorts';
const SOURCES: Source[] = ['topads', 'shorts'];
const DAY_MS = 86_400_000;

function parseTime(text: string): { h: number; m: number } | null {
  const hit = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text);
  return hit ? { h: Number(hit[1]), m: Number(hit[2]) } : null;
}

/** True when a slot of `settings.scanTimes` lies in (lastRun, now]. Malformed times are skipped. */
function slotBetween(times: string[], lastRun: Date, now: Date): boolean {
  if (lastRun.getTime() >= now.getTime()) return false;
  const slots = times.map(parseTime).filter((t) => t !== null);
  if (slots.length === 0) return false;
  // a slot older than two days back cannot be the only one: every time of day recurs
  const from = new Date(Math.max(lastRun.getTime(), now.getTime() - 2 * DAY_MS));
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (; day.getTime() <= now.getTime(); day.setDate(day.getDate() + 1)) {
    for (const { h, m } of slots) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
      if (at > lastRun.getTime() && at <= now.getTime()) return true;
    }
  }
  return false;
}

/** The sources to scan now: every source switched on, once, when at least one slot lies in (lastRun, now]. */
export function dueScans(settings: Settings, lastRun: Date | null, now: Date): Source[] {
  if (lastRun === null || !slotBetween(settings.scanTimes, lastRun, now)) return [];
  return SOURCES.filter((s) => settings.sources[s]);
}

function newestScheduledScan(db: DatabaseSync): Date | null {
  const r = db.prepare(`SELECT MAX(created_at) AS t FROM runs WHERE kind = 'scan' AND json_extract(input, '$.trigger') = 'schedule'`).get() as { t: string | null } | undefined;
  return r?.t ? new Date(r.t) : null;
}

function busy(db: DatabaseSync, source: Source): boolean {
  return db.prepare(`SELECT 1 FROM runs WHERE kind = 'scan' AND state IN ('queued', 'running') AND json_extract(input, '$.source') = ?`).get(source) !== undefined;
}

export function startSchedule(deps: { db: DatabaseSync; clock: Clock; everyMs: number }): { stop(): void } {
  const { db, clock } = deps;
  const startedAt = clock.now();
  let handled: Date | null = null;   // the last moment up to which the slots are dealt with, also when nothing could be queued

  const tick = () => {
    try {
      const now = clock.now();
      const settings = readSettings(db);
      const stored = newestScheduledScan(db);
      const lastRun = [stored ?? startedAt, handled].filter((d): d is Date => d !== null).reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
      const slotHit = dueScans({ ...settings, sources: { topads: true, shorts: true } }, lastRun, now).length > 0;
      if (!slotHit) return;
      handled = now;
      for (const source of dueScans(settings, lastRun, now)) {
        if (busy(db, source)) continue;
        enqueue(db, { kind: 'scan', source, trigger: 'schedule' }, `scan-${source}-${now.toISOString()}`, null, now);
      }
    } catch (e) {
      console.error(`schedule tick failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  tick();
  const timer = setInterval(tick, deps.everyMs);
  return { stop() { clearInterval(timer); } };
}
