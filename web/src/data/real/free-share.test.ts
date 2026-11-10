// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '..';
import { getStore, resetStore } from '../mock/store';
import { addDemoCustomers, generateInput } from '../mock/test-helpers';
import { closeSqliteEngines } from './sqlite-engine';
import { makeDataDir, putTemplate } from './testing';

// One job of template `t1` reserves 26 provider units (5 images, 20 clip seconds, 1 music track): a quarter of a daily cap of 104.
let db: DatabaseSync;
const input = () => ({ ...generateInput('t1'), products: [] });
const start = async (userId: string) => data.jobs.start(userId, input(), `key-${userId}`, await data.jobs.estimate(userId, input()));
/** One more verified account that still has its free video. */
function freeUser(id: string): string {
  const base = getStore().users.find((user) => user.id === 'usr-demo');
  if (!base) throw new Error('no usr-demo');
  getStore().users.push({ ...structuredClone(base), id, email: `${id}@example.com`, emailVerified: true, freeVideoAvailable: true });
  return id;
}
/** A table the site has not made yet (it makes them when the engine opens) has no rows. */
const sum = (sql: string, table: string): number =>
  (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) ? (db.prepare(sql).get() as { n: number }).n : 0);
const count = (table: string) => sum(`SELECT COUNT(*) AS n FROM ${table}`, table);
const reserved = () => sum('SELECT COALESCE(SUM(reserved), 0) AS n FROM provider_budget', 'provider_budget');
/** What a refused start must leave as it was: the site's records and the engine's. */
const written = () => structuredClone({
  ledger: getStore().ledger, jobs: getStore().jobs, free: getStore().users.map((user) => [user.id, user.freeVideoAvailable]),
  runs: count('runs'), reserved: reserved(), budget: count('provider_budget'), marks: count('free_budget'),
});

beforeEach(() => {
  const world = makeDataDir(); db = world.db;
  for (const [key, value] of Object.entries({
    VC_ENGINE: 'sqlite', VC_DATA_DIR: world.dir, VC_ADMIN_PASSWORD: 'test-only-password-123', VC_PROVIDER: 'magnific',
    VC_PROVIDER_DAILY_CAP: '104', VC_PROVIDER_JOB_CAP: '26',
  })) vi.stubEnv(key, value);
  resetStore(); addDemoCustomers(); closeSqliteEngines(); putTemplate(db, { id: 't1', state: 'published' });
});
afterEach(() => { vi.useRealTimers(); closeSqliteEngines(); db.close(); vi.unstubAllEnvs(); resetStore(); });

describe('the share of the provider\'s daily cap the free videos may reserve (K2: a quarter)', () => {
  it('a free job within the quarter starts; the next free job is refused before anything is written, in the site or the engine', async () => {
    expect(await start('usr-new')).toMatchObject({ freeVideo: true, credits: 0, status: 'running' });
    expect(reserved()).toBe(26);
    const late = freeUser('usr-late');
    const before = written();
    await expect(start(late)).rejects.toThrow(/^free-video-cap$/);
    expect(written()).toEqual(before);
    expect((await data.auth.getUser(late))?.freeVideoAvailable).toBe(true);
  });

  it('exactly a quarter is allowed, one unit over is not', async () => {
    vi.stubEnv('VC_PROVIDER_DAILY_CAP', '103');
    const before = written();
    await expect(start('usr-new')).rejects.toThrow(/^free-video-cap$/);
    expect(written()).toEqual(before);
    vi.stubEnv('VC_PROVIDER_DAILY_CAP', '104');
    expect((await start('usr-new')).freeVideo).toBe(true);
  });

  it('a paid job is not held to the share: it starts while the free videos have used theirs, and reserves as before', async () => {
    await start('usr-new');
    await expect(start(freeUser('usr-late'))).rejects.toThrow(/^free-video-cap$/);
    const balance = await data.ledger.balance('usr-demo');
    expect(await start('usr-demo')).toMatchObject({ freeVideo: false, credits: 2 });
    expect(await data.ledger.balance('usr-demo')).toBe(balance - 2);
    expect(reserved()).toBe(52);
    expect(count('free_budget')).toBe(1); // only the free job is marked
  });

  it('B1: an account with credits and its free video is shown the price and pays while the free videos have used their share; its free video stays', async () => {
    await start('usr-new');
    const owner = getStore().users.find((user) => user.id === 'usr-demo');
    if (owner) owner.freeVideoAvailable = true;
    const balance = await data.ledger.balance('usr-demo');
    expect(await data.jobs.estimate('usr-demo', input())).toMatchObject({ credits: 2, coveredByFreeVideo: false, enough: true });
    expect(await start('usr-demo')).toMatchObject({ freeVideo: false, credits: 2, status: 'running' });
    expect(await data.ledger.balance('usr-demo')).toBe(balance - 2);
    expect((await data.auth.getUser('usr-demo'))?.freeVideoAvailable).toBe(true);
    expect(reserved()).toBe(52);
    expect(count('free_budget')).toBe(1); // only the free job is marked
  });

  it('B1: the estimate only reads: nothing is written or reserved, and a free job that is done counts for what it consumed', async () => {
    await start('usr-new');
    const late = freeUser('usr-late');
    const full = written();
    expect(await data.jobs.estimate(late, input())).toMatchObject({ credits: 2, coveredByFreeVideo: false, enough: false });
    expect(await data.jobs.freeVideoOpen('t1')).toBe(false); // what a gallery card asks
    expect(written()).toEqual(full);
    db.prepare("UPDATE runs SET state = 'done'").run(); // nothing consumed: its 26 units are not held any more
    const done = written();
    expect(await data.jobs.estimate(late, input())).toMatchObject({ credits: 0, coveredByFreeVideo: true });
    expect(await data.jobs.freeVideoOpen('t1')).toBe(true);
    expect(written()).toEqual(done);
    expect(reserved()).toBe(26); // the estimate did not give the reservation back: the next start does
  });

  it('a paid job alone may use the whole daily cap, as before', async () => {
    vi.stubEnv('VC_PROVIDER_DAILY_CAP', '26');
    expect(await start('usr-demo')).toMatchObject({ freeVideo: false, credits: 2 });
    expect(reserved()).toBe(26);
    expect(count('free_budget')).toBe(0);
  });

  it('a free job that waits in the queue is held to the share when it is queued, and not a second time when it leaves the queue', async () => {
    getStore().limits.jobsAtOnce = 0;
    const queued = await start('usr-new');
    expect(queued).toMatchObject({ status: 'queued', freeVideo: true });
    expect(reserved()).toBe(26);
    const late = freeUser('usr-late');
    const before = written();
    await expect(start(late)).rejects.toThrow(/^free-video-cap$/);
    expect(written()).toEqual(before);
    getStore().limits.jobsAtOnce = 1;
    expect((await data.jobs.listFor('usr-new')).find((job) => job.id === queued.id)?.status).toBe('running');
    expect(count('runs')).toBe(1);
    expect(reserved()).toBe(26);
  });

  it('the share is of the UTC day of the cap: what the free videos reserved yesterday does not count today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T23:59:59Z'));
    await start('usr-new');
    await expect(start(freeUser('usr-late'))).rejects.toThrow(/^free-video-cap$/);
    vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
    expect((await start('usr-late')).freeVideo).toBe(true);
  });

  it('a free job that is done counts for what it consumed, as in the daily cap', async () => {
    await start('usr-new');
    db.prepare("UPDATE runs SET state = 'done'").run(); // nothing consumed: its reservation is given back
    expect((await start(freeUser('usr-late'))).freeVideo).toBe(true);
    expect(reserved()).toBe(26);
  });

  it('a stopped free job that goes on is not refused by the share (Ruling), and what it reserves again counts in the share', async () => {
    vi.stubEnv('VC_PROVIDER_DAILY_CAP', '208'); vi.stubEnv('VC_PROVIDER_JOB_CAP', '52'); // a quarter is 52: two free jobs of 26
    const job = await start('usr-new');
    db.prepare(`UPDATE runs SET state = 'stopped', reason = 'clips-failed', missing = ?`).run(JSON.stringify({ images: 0, clips: 5, clipSeconds: 20, music: 0, voice: 0 }));
    expect((await data.jobs.get(job.id, 'usr-new'))?.status).toBe('stopped');
    expect((await data.jobs.resume(job.id, 'usr-new', await data.jobs.resumeCost(job.id, 'usr-new'))).status).toBe('running');
    expect(reserved()).toBe(46); // 26 at the start, 20 for what was missing
    await expect(start(freeUser('usr-late'))).rejects.toThrow(/^free-video-cap$/); // 46 + 26 is over the quarter
  });

  describe('Ö2: a free job that goes on as a paid job', () => {
    /** usr-demo (19 credits) starts job A on a free video, A stops, the free video that came back starts job B: going on with A costs credits. */
    async function stoppedFreeJobWhoseFreeVideoWentElsewhere() {
      const owner = getStore().users.find((user) => user.id === 'usr-demo');
      if (owner) owner.freeVideoAvailable = true;
      const a = await start('usr-demo');
      expect(a).toMatchObject({ freeVideo: true, credits: 0 });
      db.prepare(`UPDATE runs SET state = 'stopped', reason = 'clips-failed', missing = ?`).run(JSON.stringify({ images: 0, clips: 5, clipSeconds: 20, music: 0, voice: 0 }));
      expect((await data.jobs.get(a.id, 'usr-demo'))?.status).toBe('stopped');
      expect(await data.jobs.start('usr-demo', input(), 'key-b', await data.jobs.estimate('usr-demo', input()))).toMatchObject({ freeVideo: true, credits: 0 });
      return a;
    }

    it('leaves the free share: what it reserved is not counted, and a new free job that fits starts', async () => {
      vi.stubEnv('VC_PROVIDER_DAILY_CAP', '208'); vi.stubEnv('VC_PROVIDER_JOB_CAP', '52'); // a quarter is 52: two free jobs of 26
      const a = await stoppedFreeJobWhoseFreeVideoWentElsewhere();
      const balance = await data.ledger.balance('usr-demo');
      expect(await data.jobs.resume(a.id, 'usr-demo', await data.jobs.resumeCost(a.id, 'usr-demo'))).toMatchObject({ status: 'running', freeVideo: false, credits: 2 });
      expect(await data.ledger.balance('usr-demo')).toBe(balance - 2);
      expect(reserved()).toBe(72); // A: 26 and 20 for what was missing, B: 26
      expect(count('free_budget')).toBe(1); // B only
      expect((await start('usr-new')).freeVideo).toBe(true); // the free jobs hold 26 (B): 26 more is the quarter, not over it
    });

    it('stays a free job, marked and not charged, when the engine refuses to go on', async () => {
      vi.stubEnv('VC_PROVIDER_DAILY_CAP', '208'); // the job cap is 26: the 20 units to go on with do not fit
      const a = await stoppedFreeJobWhoseFreeVideoWentElsewhere();
      const before = written();
      await expect(data.jobs.resume(a.id, 'usr-demo', await data.jobs.resumeCost(a.id, 'usr-demo'))).rejects.toThrow(/^provider-cap$/);
      expect(written()).toEqual(before);
      expect(before.marks).toBe(2);
      expect(await data.jobs.get(a.id, 'usr-demo')).toMatchObject({ status: 'stopped', freeVideo: true });
    });
  });

  it('without the caps a free start is refused as before (provider-cap), and with the fake provider there is no share', async () => {
    vi.stubEnv('VC_PROVIDER_DAILY_CAP', ''); vi.stubEnv('VC_PROVIDER_JOB_CAP', '');
    const before = written();
    await expect(start('usr-new')).rejects.toThrow(/^provider-cap$/);
    expect(written()).toEqual(before);
    vi.stubEnv('VC_PROVIDER', 'fake');
    expect((await start('usr-new')).freeVideo).toBe(true);
    expect((await start(freeUser('usr-late'))).freeVideo).toBe(true);
    expect(count('provider_budget')).toBe(0);
  });

  it('the daily number of free videos (K1) is refused before the engine: no run, no reservation', async () => {
    getStore().limits.freeVideosPerDay = 0;
    const before = written();
    await expect(start('usr-new')).rejects.toThrow(/^free-video-cap$/);
    expect(written()).toEqual(before);
    expect(before).toMatchObject({ runs: 0, budget: 0, marks: 0 });
  });
});
