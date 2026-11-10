// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { fakeEngine } from '../engine/fake';
import type { Engine } from '../engine/port';
import { data } from '../index';
import { PriceChangedError } from '../ports';
import type { Template } from '../ports';
import { getStore, resetStore } from './store';
import { START, addDemoCustomers, generateInput as input, startConfirmed } from './test-helpers';

// The real engine is not built yet. This one stands in for it: one template, three clips, and a job stops when the test says so.
// `commits` has one number per `committed()` that worked: how many jobs `site.json` held at that moment (-1: a test took the file away).
// `failCommit` makes `committed()` throw; `down` makes the engine itself unavailable, as the stub of today is.
const engineState = vi.hoisted(() => ({ stopJobs: false, commits: [] as number[], commitCalls: 0, failCommit: false, down: false }));
const TEMPLATE: Template = {
  id: 'tpl-real', title: 'A template of the real engine', category: 'Hair', format: 'no-talking', seconds: 12, referenceViews: '1.2M',
  image: '/samples/x.jpg', video: null, products: 1, shots: [], status: 'published', ownerId: null, timesGenerated: 0,
  editedAt: '2026-10-01T00:00:00.000Z', source: 'topads', description: '', tags: [], preparation: null, preparationNote: null, sample: 'none',
};
const unlessDown = (engine: Partial<Engine>): Partial<Engine> => {
  if (engineState.down) throw new Error('engine-not-built');
  return engine;
};
vi.mock('../real/sqlite-engine', () => ({
  sqliteEngine: (): Partial<Engine> => unlessDown({
    templates: () => [structuredClone(TEMPLATE)],
    template: (id) => (id === TEMPLATE.id ? structuredClone(TEMPLATE) : null),
    paid: () => ({ images: 3, clips: 3, clipSeconds: 12, music: 1, voice: 0 }),
    minutes: () => 5,
    start: (job) => {
      job.steps = [{ key: 'clips', status: 'waiting', done: 0, total: 3 }];
    },
    committed: () => {
      engineState.commitCalls += 1;
      if (engineState.failCommit) throw new Error('engine-db-locked');
      engineState.commits.push(existsSync(file()) ? onDisk().jobs.length : -1);
    },
    refresh: (job) => {
      if (engineState.stopJobs && job.status === 'running') {
        Object.assign(job, { status: 'stopped', stoppedReason: 'clips-failed', steps: [{ key: 'clips', status: 'stopped', done: 1, total: 3 }] });
      }
      return job;
    },
    missing: () => ({ images: 0, clips: 2, clipSeconds: 8, music: 0, voice: 0 }),
  }),
}));

const ADMIN_PASSWORD = 'the-admin-password-12';
let dir: string;
/** What the data layer wrote to `console.error`: nothing, unless a test says otherwise. */
let logged: MockInstance<typeof console.error>;
const file = () => join(dir, 'site.json');
const onDisk = () => JSON.parse(readFileSync(file(), 'utf8'));
/** What a new process would do: forget the store in memory, so the next use builds it again. */
const restart = () => resetStore();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  dir = mkdtempSync(join(tmpdir(), 'vc-site-'));
  vi.stubEnv('VC_DATA_DIR', dir);
  vi.stubEnv('VC_ENGINE', 'sqlite');
  vi.stubEnv('VC_ADMIN_PASSWORD', ADMIN_PASSWORD); // the real engine does not make its first store without the admin's password
  Object.assign(engineState, { stopJobs: false, commitCalls: 0, failCommit: false, down: false });
  engineState.commits.length = 0;
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetStore();
  addDemoCustomers(); // the real engine's store seeds the administrator only; these tests need customers with balances
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetStore();
  rmSync(dir, { recursive: true, force: true });
});

describe('the passwords of the real engine (SEC1)', () => {
  it('the first store is not made without VC_ADMIN_PASSWORD, and nothing is written', async () => {
    vi.stubEnv('VC_ADMIN_PASSWORD', '');
    resetStore();
    await expect(data.auth.getUser('usr-admin')).rejects.toThrow('admin-password-required');
    expect(existsSync(file())).toBe(false);
  });

  it('site.json holds salted hashes, no password, and only the owner can read it', async () => {
    await data.auth.signUp('someone@example.com', 'someone-password-1');
    const text = readFileSync(file(), 'utf8');
    expect(text).not.toContain('someone-password-1');
    expect(text).not.toContain(ADMIN_PASSWORD);
    expect(onDisk().credentials.map((credential: { userId: string }) => credential.userId)).toContain('usr-admin');
    expect(statSync(file()).mode & 0o777).toBe(0o600);
  });

  it('the admin can log in with the password, after a restart too; the demo accounts have no password', async () => {
    expect(await data.auth.logIn('admin@viralclone.app', ADMIN_PASSWORD)).toMatchObject({ ok: true, user: { role: 'admin' } });
    expect(await data.auth.logIn('admin@viralclone.app', 'demo-password')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await data.auth.logIn('demo@viralclone.app', 'demo-password')).toMatchObject({ ok: false, reason: 'invalid' });
    const user = await data.auth.signUp('someone@example.com', 'someone-password-1');
    restart();
    expect(await data.auth.logIn('admin@viralclone.app', ADMIN_PASSWORD)).toMatchObject({ ok: true });
    expect(await data.auth.logIn('someone@example.com', 'someone-password-1')).toMatchObject({ ok: true, user: { id: user.id } });
    expect(await data.auth.logIn('someone@example.com', 'wrong')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('a site.json made before passwords existed gets the admin\'s password from VC_ADMIN_PASSWORD, and warns when that is not set', async () => {
    await data.auth.signUp('someone@example.com', 'someone-password-1');
    const old = onDisk();
    delete old.credentials;
    writeFileSync(file(), JSON.stringify(old));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('VC_ADMIN_PASSWORD', '');
    restart();
    expect(await data.auth.logIn('admin@viralclone.app', ADMIN_PASSWORD)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('VC_ADMIN_PASSWORD'));
    vi.stubEnv('VC_ADMIN_PASSWORD', ADMIN_PASSWORD);
    restart();
    expect(await data.auth.logIn('admin@viralclone.app', ADMIN_PASSWORD)).toMatchObject({ ok: true });
    expect(await data.auth.logIn('someone@example.com', 'someone-password-1')).toMatchObject({ ok: false, reason: 'invalid' }); // no password was ever kept for it
  });
});

describe('fake mode', () => {
  beforeEach(() => {
    vi.stubEnv('VC_ENGINE', '');
    resetStore();
  });

  it('writes no file, whatever changes', async () => {
    await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    await data.auth.signUp('someone@example.com', 'secret');
    await data.admin.saveSettings({ threshold: 80 });
    expect(await data.ledger.balance('usr-demo')).toBe(17);
    expect(readdirSync(dir)).toEqual(['site.lock']);
  });

  it('never tells the engine that something is on disk, and needs no data directory', async () => {
    vi.stubEnv('VC_DATA_DIR', '');
    const committed = vi.spyOn(fakeEngine, 'committed');
    await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    await data.jobs.resume('job-demo-stopped', 'usr-demo', 5);
    expect(await data.ledger.balance('usr-demo')).toBe(12);
    expect(committed).not.toHaveBeenCalled();
  });

  it('reads no file: a site.json in the data directory is ignored, even a broken one', async () => {
    writeFileSync(file(), '{ not json');
    restart();
    expect(getStore().templates).toHaveLength(8);
    expect(await data.ledger.balance('usr-demo')).toBe(19);
    expect(readFileSync(file(), 'utf8')).toBe('{ not json');
  });
});

describe('the first start next to the real engine', () => {
  it('seeds the administrator only: no demo customer in the store, the admin list or a password list', async () => {
    restart(); // the store as the first start makes it, without the customers this file's beforeEach adds
    const store = getStore();
    expect(store.users.map((user) => user.id)).toEqual(['usr-admin']);
    expect(store.credentials.map((credential) => credential.userId)).toEqual(['usr-admin']);
    expect((await data.admin.users({})).map((row) => row.user.id)).toEqual(['usr-admin']);
    expect(await data.auth.logIn('demo@viralclone.app', 'demo-password')).toMatchObject({ ok: false });
  });

  it('with the demo customers added: one opening entry per fixture balance, and nothing the engine owns', async () => {
    const store = getStore();
    expect(store.users.map((user) => user.id).sort()).toEqual(['usr-admin', 'usr-blocked', 'usr-demo', 'usr-free', 'usr-new', 'usr-paying', 'usr-unverified']);
    const opening = (userId: string, credits: number) => ({
      id: `led-opening-${userId}`, userId, at: START.toISOString(), type: 'admin', change: credits, note: 'Opening balance', balanceAfter: credits,
      by: { kind: 'system' }, reason: null, relatedJobId: null, relatedPurchaseId: null, lots: [{ lot: `led-opening-${userId}`, credits }],
    });
    expect(store.ledger).toEqual([opening('usr-demo', 19), opening('usr-paying', 82), opening('usr-blocked', 6)]);
    expect(store.limits).toMatchObject({ jobsAtOnce: 2, showTalkingTemplates: false }); // the launch defaults (K14)
    expect(await data.ledger.balance('usr-demo')).toBe(19);
    expect(await data.ledger.balance('usr-new')).toBe(0);
    for (const key of ['templates', 'jobs', 'purchases', 'invoices', 'checkouts', 'outbox', 'candidates', 'scans'] as const) {
      expect(store[key], key).toEqual([]);
    }
    expect(store.keys.size).toBe(0);
  });

  it('the opening balances are the balances of the fixtures', async () => {
    const opening = Object.fromEntries(getStore().ledger.map((entry) => [entry.userId, entry.change]));
    vi.stubEnv('VC_ENGINE', '');
    restart();
    for (const user of getStore().users) {
      expect(await data.ledger.balance(user.id), user.id).toBe(opening[user.id] ?? 0);
    }
  });
});

describe('writing the store', () => {
  it('writes site.json after a call, as one whole file, with the idempotency keys as entries', async () => {
    expect(existsSync(file())).toBe(false);
    const job = await startConfirmed('usr-demo', input('tpl-real'), 'key-1');
    expect(readdirSync(dir)).toEqual(['site.json', 'site.lock']);
    expect(onDisk()).toMatchObject({
      jobs: [{ id: job.id, userId: 'usr-demo', templateId: 'tpl-real', credits: 2, status: 'running' }],
      keys: [['job:usr-demo:key-1', job.id]],
    });
    expect(onDisk().ledger.at(-1)).toMatchObject({ userId: 'usr-demo', type: 'generation', change: -2, balanceAfter: 17 });
  });

  it('M4: the temp file is flushed to disk before it replaces site.json', async () => {
    const fs = process.getBuiltinModule('node:fs');
    const order: string[] = [];
    const fsync = fs.fsyncSync;
    const rename = fs.renameSync;
    vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => { order.push('fsync'); fsync(fd); });
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { order.push('rename'); rename(from, to); });
    await startConfirmed('usr-demo', input('tpl-real'), 'key-1');
    expect(order.slice(0, 2)).toEqual(['fsync', 'rename']);
  });

  it('writes only when the store changed: a read leaves the file alone', async () => {
    await data.auth.signUp('someone@example.com', 'secret');
    rmSync(file());
    await data.ledger.balance('usr-demo');
    await data.auth.getUser('usr-demo');
    await data.jobs.listFor('usr-demo');
    expect(existsSync(file())).toBe(false);
    await data.auth.updateProfile('usr-demo', { name: 'Another name' });
    expect(onDisk().users.find((user: { id: string }) => user.id === 'usr-demo')).toMatchObject({ name: 'Another name' });
  });

  it('writes also after a call that failed, when it changed something on the way (a job was found stopped)', async () => {
    const job = await startConfirmed('usr-demo', input('tpl-real'), 'key-1');
    engineState.stopJobs = true;
    await expect(data.jobs.resume(job.id, 'usr-demo', 99)).rejects.toThrow(PriceChangedError);
    expect(onDisk().jobs[0]).toMatchObject({ id: job.id, status: 'stopped', stoppedReason: 'clips-failed', credits: 2 });
    expect(onDisk().outbox).toMatchObject([{ kind: 'stopped', to: 'demo@viralclone.app', data: { jobId: job.id, reason: 'clips-failed' } }]);
  });
});

describe('telling the engine that the store is on disk', () => {
  it('the store is written first, then the engine is told: when it hears of a job, the job is in the file', async () => {
    await startConfirmed('usr-demo', input('tpl-real'), 'key-1'); // two calls: the estimate, then the start
    expect(engineState.commits).toEqual([0, 1]);
    expect(logged).not.toHaveBeenCalled();
  });

  it('the engine cannot be told (committed throws): the call keeps its own result and the store is on disk; the next call tells the engine again', async () => {
    engineState.failCommit = true;
    const job = await data.jobs.start('usr-demo', input('tpl-real'), 'key-1', { credits: 2, coveredByFreeVideo: false });
    expect(job).toMatchObject({ userId: 'usr-demo', templateId: 'tpl-real', status: 'running', credits: 2 });
    expect(onDisk().jobs).toMatchObject([{ id: job.id, credits: 2 }]);
    expect(onDisk().ledger.at(-1)).toMatchObject({ userId: 'usr-demo', type: 'generation', change: -2 });
    expect(engineState.commits).toEqual([]);
    expect(logged.mock.calls).toEqual([['engine-commit-failed: engine-db-locked']]);

    engineState.failCommit = false;
    const calls = engineState.commitCalls;
    expect(await data.ledger.balance('usr-demo')).toBe(17);
    expect(engineState.commitCalls).toBe(calls + 1);
    expect(engineState.commits).toEqual([1]);
  });

  it('no engine at all, as long as the real one is not built: a call that does not need it answers and is saved', async () => {
    engineState.down = true;
    const user = await data.auth.signUp('someone@example.com', 'secret');
    expect(user.email).toBe('someone@example.com');
    expect(await data.ledger.balance('usr-demo')).toBe(19);
    expect(onDisk().users.at(-1)).toMatchObject({ id: user.id, email: 'someone@example.com' });
    expect(logged).toHaveBeenCalledWith('engine-commit-failed: engine-not-built');
  });

  it('a call that failed keeps its own error when the engine cannot be told either; what it changed is on disk', async () => {
    const job = await startConfirmed('usr-demo', input('tpl-real'), 'key-1');
    engineState.stopJobs = true; // the resume below finds the job stopped: the store changes before the call fails
    engineState.failCommit = true;
    await expect(data.jobs.resume(job.id, 'usr-demo', 99)).rejects.toThrow(PriceChangedError);
    expect(onDisk().jobs[0]).toMatchObject({ id: job.id, status: 'stopped' });
    expect(logged.mock.calls).toEqual([['engine-commit-failed: engine-db-locked']]);
  });

  it('refuses before mutating when the data directory cannot be locked', async () => {
    await data.ledger.balance('usr-demo');
    const text = readFileSync(file(), 'utf8');
    engineState.commits.length = 0;
    writeFileSync(join(dir, 'blocker'), '');
    vi.stubEnv('VC_DATA_DIR', join(dir, 'blocker', 'data'));
    await expect(data.jobs.start('usr-demo', input('tpl-real'), 'key-1', { credits: 2, coveredByFreeVideo: false })).rejects.toMatchObject({ code: 'ENOTDIR' });
    expect(getStore().jobs).toHaveLength(0);
    expect(readFileSync(file(), 'utf8')).toBe(text);
    expect(engineState.commits).toEqual([]);
    expect(logged).not.toHaveBeenCalled();
  });

  it('a site.json that cannot be read: the engine is told nothing', async () => {
    writeFileSync(file(), '{ not json');
    restart();
    await expect(data.ledger.balance('usr-demo')).rejects.toThrow('site-store-unreadable');
    expect(engineState.commits).toEqual([]);
  });
});

describe('without VC_DATA_DIR', () => {
  it('the site does not guess a directory next to the real engine: an error names the variable', async () => {
    vi.stubEnv('VC_DATA_DIR', '');
    restart();
    expect(() => getStore()).toThrow('VC_DATA_DIR');
    await expect(data.ledger.balance('usr-demo')).rejects.toThrow('VC_DATA_DIR');
    expect(engineState.commits).toEqual([]);
  });
});

describe('a new store from the file', () => {
  it('has the job, its charge and the balance, and the idempotency key still returns the same job', async () => {
    const job = await startConfirmed('usr-demo', input('tpl-real'), 'key-1');
    expect(await data.ledger.balance('usr-demo')).toBe(17);

    restart();
    const store = getStore();
    expect(store.jobs).toMatchObject([{
      id: job.id, userId: 'usr-demo', templateId: 'tpl-real', templateTitle: 'A template of the real engine', credits: 2, status: 'running',
      startedAt: START.toISOString(), steps: [{ key: 'clips', status: 'waiting', done: 0, total: 3 }], refundEntryId: null,
    }]);
    expect(await data.ledger.balance('usr-demo')).toBe(17);
    expect((await data.ledger.entries('usr-demo'))[0]).toMatchObject({ type: 'generation', change: -2, note: 'A template of the real engine', balanceAfter: 17 });
    expect(store.keys).toBeInstanceOf(Map);
    expect(store.keys.get('job:usr-demo:key-1')).toBe(job.id);

    const again = await startConfirmed('usr-demo', input('tpl-real'), 'key-1');
    expect(again.id).toBe(job.id);
    expect(await data.ledger.balance('usr-demo')).toBe(17);
    expect(await data.jobs.listFor('usr-demo')).toHaveLength(1);
  });

  it('has the users, the free video that was used, a purchase with its invoice and the emails', async () => {
    const user = await data.auth.signUp('someone@example.com', 'secret');
    await startConfirmed('usr-new', input('tpl-real'), 'free');
    const { checkoutId } = await data.payments.startCheckout('usr-new', 'pack-starter', '/gallery');
    const purchase = await data.payments.complete(checkoutId, 'paid');

    restart();
    expect((await data.auth.getUser(user.id))?.email).toBe('someone@example.com');
    expect((await data.auth.getUser('usr-new'))?.freeVideoAvailable).toBe(false);
    expect(await data.ledger.balance('usr-new')).toBe(10);
    expect(await data.payments.purchasesFor('usr-new')).toEqual([purchase]);
    expect(await data.invoices.listFor('usr-new')).toMatchObject([{ id: purchase.invoiceId, purchaseId: purchase.id }]);
    expect((await data.payments.getCheckout(checkoutId, 'usr-new'))?.status).toBe('paid');
    expect((await data.mailer.outbox()).map((email) => email.kind).sort()).toEqual(['payment', 'verify']);
  });

  it('a second restart reads the same store and writes nothing', async () => {
    await startConfirmed('usr-demo', input('tpl-real'), 'key-1');
    const text = readFileSync(file(), 'utf8');
    restart();
    rmSync(file());
    writeFileSync(file(), text);
    restart();
    await data.ledger.balance('usr-demo');
    expect(readFileSync(file(), 'utf8')).toBe(text);
    expect(readdirSync(dir)).toEqual(['site.json', 'site.lock']);
  });
});

describe('a site.json that cannot be read', () => {
  it.each([
    ['is not JSON', '{ "users": [ oops'],
    ['is empty', ''],
    ['is JSON of another shape', '{"users":[]}'],
    ['is a list', '[]'],
  ])('%s: a clear error that names the file, never a silent start from the fixtures', async (_case, text) => {
    writeFileSync(file(), text);
    restart();
    expect(() => getStore()).toThrow(`site-store-unreadable: ${file()}`);
    await expect(data.ledger.balance('usr-demo')).rejects.toThrow(file());
    await expect(data.auth.signUp('someone@example.com', 'secret')).rejects.toThrow('site-store-unreadable');
    expect(readFileSync(file(), 'utf8')).toBe(text);
  });
});

it('a site.json written before the daily free videos had a limit reads it as 10; a saved number is kept', async () => {
  await data.admin.saveLimits('usr-admin', { jobsAtOnce: 3 });
  const old = onDisk();
  delete old.limits.freeVideosPerDay;
  writeFileSync(file(), JSON.stringify(old));
  restart();
  expect(await data.admin.limits()).toMatchObject({ jobsAtOnce: 3, freeVideosPerDay: 10 });
  await data.admin.saveLimits('usr-admin', { freeVideosPerDay: 25 });
  restart();
  expect(await data.admin.limits()).toMatchObject({ jobsAtOnce: 3, freeVideosPerDay: 25 });
});

it('canonical free entitlement survives account deletion and a store restart without storing the email in that record', async () => {
  const user = await data.auth.signUp('persistent+first@example.test', 'password123');
  expect(await data.auth.verifyEmail(user.id)).toMatchObject({ freeVideoAvailable: true });
  await data.auth.deleteAccount(user.id);
  restart();
  const alias = await data.auth.signUp('persistent+second@example.test', 'password123');
  expect(await data.auth.verifyEmail(alias.id)).toMatchObject({ freeVideoAvailable: false });
  const records = onDisk().freeEntitlements;
  expect(records).toHaveLength(1);
  expect(records[0]).toEqual({ digest: expect.stringMatching(/^[a-f0-9]{64}$/), at: START.toISOString() });
  expect(JSON.stringify(records)).not.toContain('example.test');
});
