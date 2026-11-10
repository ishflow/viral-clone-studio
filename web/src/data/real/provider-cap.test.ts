// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { data } from '..';
import { resetStore, getStore } from '../mock/store';
import { addDemoCustomers, generateInput } from '../mock/test-helpers';
import { closeSqliteEngines } from './sqlite-engine';
import { makeDataDir, putTemplate } from './testing';
let db: DatabaseSync;
beforeEach(() => {
 const world = makeDataDir(); db = world.db;
 for(const [key,value] of Object.entries({VC_ENGINE:'sqlite', VC_DATA_DIR:world.dir, VC_ADMIN_PASSWORD:'test-only-password-123', VC_PROVIDER:'magnific', VC_PROVIDER_DAILY_CAP:'26', VC_PROVIDER_JOB_CAP:'26'})) vi.stubEnv(key,value);
 resetStore(); addDemoCustomers(); closeSqliteEngines(); putTemplate(db,{id:'t1',state:'published'});
});
afterEach(() => { closeSqliteEngines(); db.close(); vi.unstubAllEnvs(); resetStore(); });
it('rejects over-cap production before holding a run or charging credits; restart never resets reservations', async () => {
 const input = {...generateInput('t1'),products:[]};
 const quote = await data.jobs.estimate('usr-demo',input);
 await data.jobs.start('usr-demo',input,'first',quote);
 const before = await data.ledger.balance('usr-demo'), ledger = getStore().ledger.length;
 closeSqliteEngines();
 await expect(data.jobs.start('usr-demo',input,'second',quote)).rejects.toThrow(/^provider-cap$/);
 expect(await data.ledger.balance('usr-demo')).toBe(before); expect(getStore().ledger.length).toBe(ledger);
 expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({n:1});
 expect(db.prepare('SELECT SUM(reserved) AS n FROM provider_budget').get()).toEqual({n:26});
});
it('rejects preparation before holding or charging', async () => {
 vi.stubEnv('VC_PROVIDER_JOB_CAP','1'); vi.stubEnv('VC_PROVIDER_DAILY_CAP','1');
 const { engine } = await import('../engine');
 engine().addFromLink('usr-demo','https://www.instagram.com/reel/one/');
 expect(() => engine().addFromLink('usr-demo','https://www.instagram.com/reel/two/')).toThrow(/^provider-cap$/);
 expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({n:1});
});
const input = () => ({...generateInput('t1'),products:[]});
const untouched = async () => {
 const before = await data.ledger.balance('usr-demo'), ledger = getStore().ledger.length;
 return async (code: string) => {
  await expect(data.jobs.start('usr-demo',input(),'x',await data.jobs.estimate('usr-demo',input()))).rejects.toThrow(new RegExp(`^${code}$`));
  expect(await data.ledger.balance('usr-demo')).toBe(before); expect(getStore().ledger.length).toBe(ledger);
  expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({n:0});
  expect(db.prepare('SELECT COUNT(*) AS n FROM provider_budget').get()).toEqual({n:0});
 };
};
it('magnific without any spending cap refuses the job before charging or holding a run', async () => {
 vi.stubEnv('VC_PROVIDER_DAILY_CAP',''); vi.stubEnv('VC_PROVIDER_JOB_CAP','');
 await (await untouched())('provider-cap');
});
it.each([[{VC_PROVIDER_DAILY_CAP:'26',VC_PROVIDER_JOB_CAP:''}],[{VC_PROVIDER_DAILY_CAP:'',VC_PROVIDER_JOB_CAP:'26'}],
 ...['0','-5','abc'].map(bad => [{VC_PROVIDER_DAILY_CAP:bad,VC_PROVIDER_JOB_CAP:'26'}]),
 ...['0','-5','abc'].map(bad => [{VC_PROVIDER_DAILY_CAP:'26',VC_PROVIDER_JOB_CAP:bad}])])(
 'one missing or invalid cap %j fails closed (provider-cap-required) before charging', async (caps) => {
 for(const [key,value] of Object.entries(caps)) vi.stubEnv(key,value);
 await (await untouched())('provider-cap-required');
});
it('K3: a template whose own estimate is over the job cap is refused before charging, whether the job would start or queue; the daily cap has room', async () => {
 vi.stubEnv('VC_PROVIDER_DAILY_CAP','1000'); vi.stubEnv('VC_PROVIDER_JOB_CAP','25');
 expect(await data.jobs.estimate('usr-demo',input())).toMatchObject({images:5,clipSeconds:20,musicTracks:1,credits:2,enough:true});
 await (await untouched())('provider-cap');
 getStore().limits.jobsAtOnce = 0;
 await (await untouched())('provider-cap');
});
it('both caps set: a job within them is accepted as before', async () => {
 const quote = await data.jobs.estimate('usr-demo',input());
 await data.jobs.start('usr-demo',input(),'ok',quote);
 expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({n:1});
 expect(db.prepare('SELECT SUM(reserved) AS n FROM provider_budget').get()).toEqual({n:26});
});
it('the fake provider needs no caps', async () => {
 vi.stubEnv('VC_PROVIDER','fake'); vi.stubEnv('VC_PROVIDER_DAILY_CAP',''); vi.stubEnv('VC_PROVIDER_JOB_CAP','');
 await data.jobs.start('usr-demo',input(),'fake',await data.jobs.estimate('usr-demo',input()));
 expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({n:1});
 expect(db.prepare('SELECT COUNT(*) AS n FROM provider_budget').get()).toEqual({n:0});
});
it('owner test on without caps still requires them (provider-cap-required), not a silent pass', async () => {
 vi.stubEnv('VC_OWNER_TEST','1'); vi.stubEnv('VC_PROVIDER_DAILY_CAP',''); vi.stubEnv('VC_PROVIDER_JOB_CAP','');
 await (await untouched())('provider-cap-required');
});
it('owner test on with both caps reserves as before', async () => {
 vi.stubEnv('VC_OWNER_TEST','1');
 await data.jobs.start('usr-demo',input(),'owner',await data.jobs.estimate('usr-demo',input()));
 expect(db.prepare('SELECT SUM(reserved) AS n FROM provider_budget').get()).toEqual({n:26});
});
it('a job queued under the caps starts from the queue even after the caps are gone, on purpose: the worker stops it at the first paid request', async () => {
 vi.stubEnv('VC_PROVIDER_DAILY_CAP','52'); vi.stubEnv('VC_PROVIDER_JOB_CAP','52');
 getStore().limits.jobsAtOnce = 1;
 await data.jobs.start('usr-demo',input(),'first',await data.jobs.estimate('usr-demo',input()));
 const queued = await data.jobs.start('usr-demo',{...input(),products:[]},'second',await data.jobs.estimate('usr-demo',input()));
 expect(queued.status).toBe('queued');
 const balance = await data.ledger.balance('usr-demo'), ledger = getStore().ledger.length;
 const reserved = db.prepare('SELECT run_id, reserved FROM provider_budget ORDER BY run_id').all();
 getStore().limits.jobsAtOnce = 2;
 vi.stubEnv('VC_PROVIDER_DAILY_CAP',''); vi.stubEnv('VC_PROVIDER_JOB_CAP','');
 const jobs = await data.jobs.listFor('usr-demo');
 expect(jobs.find((job) => job.id === queued.id)?.status).toBe('running');
 expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({n:2});
 expect(await data.ledger.balance('usr-demo')).toBe(balance); expect(getStore().ledger.length).toBe(ledger);
 expect(db.prepare('SELECT run_id, reserved FROM provider_budget ORDER BY run_id').all()).toEqual(reserved);
 expect(reserved).toHaveLength(2);
});
it('without any spending cap a job that would queue is refused before charging', async () => {
 getStore().limits.jobsAtOnce = 0;
 vi.stubEnv('VC_PROVIDER_DAILY_CAP',''); vi.stubEnv('VC_PROVIDER_JOB_CAP','');
 await (await untouched())('provider-cap');
});
it('without any spending cap a stopped job is not resumed: nothing is charged, the run stays stopped', async () => {
 const job = await data.jobs.start('usr-demo',input(),'first',await data.jobs.estimate('usr-demo',input()));
 const stored = getStore().jobs.find((item) => item.id === job.id)!;
 stored.status = 'stopped'; stored.stoppedReason = 'engine-error';
 db.prepare(`UPDATE runs SET state = 'stopped'`).run();
 vi.stubEnv('VC_PROVIDER_DAILY_CAP',''); vi.stubEnv('VC_PROVIDER_JOB_CAP','');
 const balance = await data.ledger.balance('usr-demo'), ledger = getStore().ledger.length;
 await expect(data.jobs.resume(job.id,'usr-demo',await data.jobs.resumeCost(job.id,'usr-demo'))).rejects.toThrow(/^provider-cap$/);
 expect(await data.ledger.balance('usr-demo')).toBe(balance); expect(getStore().ledger.length).toBe(ledger);
 expect(db.prepare('SELECT state FROM runs').get()).toEqual({state:'stopped'});
});
