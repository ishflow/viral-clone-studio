import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db/open.ts';
import { enqueue, claim } from '../db/runs.ts';
import { readSettings, writeSettings } from '../db/settings.ts';
import { FakeClock } from '../adapters/fakes.ts';
import { dueScans, startSchedule } from './schedule.ts';

const mem = () => openDb(join(mkdtempSync(join(tmpdir(), 'vc-sched-')), 'db.sqlite'));
const at = (h: number, m = 0, day = 4) => new Date(2026, 9, day, h, m);   // local time
const scans = (db: ReturnType<typeof mem>) => db.prepare(`SELECT json_extract(input,'$.source') AS source, created_at FROM runs WHERE kind = 'scan' ORDER BY created_at, source`).all() as { source: string; created_at: string }[];

describe('dueScans', () => {
  const s = readSettings(mem());
  it('one slot in the window: every source on, once', () => {
    expect(dueScans(s, at(8, 59), at(9, 0), )).toEqual(['topads', 'shorts']);
    expect(dueScans(s, at(9, 0), at(9, 30))).toEqual([]);
  });
  it('three slots missed: once', () => {
    expect(dueScans(s, at(21, 0, 3), at(22, 0))).toEqual(['topads', 'shorts']);
  });
  it('a source switched off is left out; null last run: nothing; a malformed time is skipped', () => {
    expect(dueScans({ ...s, sources: { topads: true, shorts: false } }, at(8), at(10))).toEqual(['topads']);
    expect(dueScans(s, null, at(10))).toEqual([]);
    expect(dueScans({ ...s, scanTimes: ['bad', '25:00', '09:00'] }, at(8), at(10))).toEqual(['topads', 'shorts']);
    expect(dueScans({ ...s, scanTimes: ['bad'] }, at(8), at(10))).toEqual([]);
  });
  it('a slot across midnight and across a long gap', () => {
    expect(dueScans({ ...s, scanTimes: ['00:30'] }, at(23, 50, 3), at(0, 40))).toEqual(['topads', 'shorts']);
    expect(dueScans(s, new Date(2020, 0, 1), at(10))).toEqual(['topads', 'shorts']);
  });
});

describe('startSchedule', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); });
  afterEach(() => { vi.useRealTimers(); });
  const tickTo = (clock: FakeClock, when: Date) => { clock.set(when); vi.advanceTimersByTime(30_000); };

  it('queues one run per source per slot', () => {
    const db = mem(); const clock = new FakeClock(at(8, 50));
    const sched = startSchedule({ db, clock, everyMs: 30_000 });
    for (const [h, m] of [[8, 59], [9, 0], [9, 1], [9, 30]] as const) tickTo(clock, at(h, m));
    sched.stop();
    expect(scans(db).map((r) => r.source)).toEqual(['shorts', 'topads']);
  });
  it('three slots missed while the worker was off: once', () => {
    const db = mem(); const clock = new FakeClock(at(21, 0, 3));
    enqueue(db, { kind: 'scan', source: 'topads', trigger: 'schedule' }, 'scan-old', null, at(21, 0, 3));
    claim(db, 'w', at(21, 0, 3));
    db.exec(`UPDATE runs SET state = 'done'`);
    clock.set(at(22, 0));
    const sched = startSchedule({ db, clock, everyMs: 30_000 });
    sched.stop();
    expect(scans(db)).toHaveLength(1 + 2);
  });
  it('a source switched off is not scanned; a change of scanTimes takes effect on the next tick', () => {
    const db = mem(); const clock = new FakeClock(at(8, 0));
    writeSettings(db, { ...readSettings(db), sources: { topads: true, shorts: false }, scanTimes: ['23:00'] });
    const sched = startSchedule({ db, clock, everyMs: 30_000 });
    tickTo(clock, at(9, 5));
    expect(scans(db)).toHaveLength(0);
    writeSettings(db, { ...readSettings(db), scanTimes: ['09:00'] });
    tickTo(clock, at(9, 6));
    sched.stop();
    expect(scans(db).map((r) => r.source)).toEqual(['topads']);
  });
  it('a first start at 10:00 on an empty database waits for 15:00', () => {
    const db = mem(); const clock = new FakeClock(at(10, 0));
    const sched = startSchedule({ db, clock, everyMs: 30_000 });
    tickTo(clock, at(12, 0));
    expect(scans(db)).toHaveLength(0);
    tickTo(clock, at(15, 0));
    sched.stop();
    expect(scans(db)).toHaveLength(2);
  });
  it('a restart at 09:05 after a scan queued at 09:00 queues nothing', () => {
    const db = mem();
    enqueue(db, { kind: 'scan', source: 'topads', trigger: 'schedule' }, 'scan-x', null, at(9, 0));
    db.exec(`UPDATE runs SET state = 'done'`);
    const sched = startSchedule({ db, clock: new FakeClock(at(9, 5)), everyMs: 30_000 });
    sched.stop();
    expect(scans(db)).toHaveLength(1);
  });
  it('a source with a queued scan is not queued again, and the slot is not retried later', () => {
    const db = mem(); const clock = new FakeClock(at(8, 50));
    enqueue(db, { kind: 'scan', source: 'topads', trigger: 'manual' }, 'scan-manual', null, at(8, 55));
    const sched = startSchedule({ db, clock, everyMs: 30_000 });
    tickTo(clock, at(9, 0));
    expect(scans(db).filter((r) => r.source === 'topads')).toHaveLength(1);
    db.exec(`UPDATE runs SET state = 'done'`);
    tickTo(clock, at(9, 10));
    sched.stop();
    expect(scans(db).filter((r) => r.source === 'topads')).toHaveLength(1);
    expect(scans(db).filter((r) => r.source === 'shorts')).toHaveLength(1);
  });
  it('a throwing tick is logged and the next one runs; stop() leaves no timer', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = mem(); const clock = new FakeClock(at(8, 50));
    const sched = startSchedule({ db, clock, everyMs: 30_000 });
    db.exec('DROP TABLE settings');
    tickTo(clock, at(9, 0));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    sched.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
