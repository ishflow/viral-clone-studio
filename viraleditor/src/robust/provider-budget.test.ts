import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import type { RunInput } from '../contracts.ts';
import { openDb } from '../db/open.ts';
import { enqueue } from '../db/runs.ts';
import { budgetSchema, consumeProvider, releaseTerminal, releaseUnspent, reserveProvider } from './provider-budget.ts';
const caps = { daily: 6, job: 4 };
it('reserves atomically, refuses before provider, persists and rolls over UTC without refunds', () => {
 const db = new DatabaseSync(':memory:'); budgetSchema(db);
 const date = new Date('2026-10-05T23:59:59Z');
 reserveProvider(db, caps, 'a', 4, date);
 let calls = 0;
 const paid = () => { consumeProvider(db, caps, 'a', 1, date); calls++; };
 for(let i=0;i<4;i++) paid();
 expect(paid).toThrow('provider-cap'); expect(calls).toBe(4);
 reserveProvider(db, caps, 'b', 2, date);
 expect(() => reserveProvider(db, caps, 'c', 1, date)).toThrow('provider-cap');
 consumeProvider(db, caps, 'c', 1, new Date('2026-10-06T00:00:00Z'));
 expect(db.prepare('SELECT SUM(reserved) AS n FROM provider_budget').get()).toEqual({ n: 7 });
 db.close();
});

it('a run that never reached the provider gives its reservation back; one that paid keeps it, so real POSTs still cannot pass the cap', () => {
 const db = new DatabaseSync(':memory:'); budgetSchema(db);
 const date = new Date('2026-10-05T10:00:00Z');
 reserveProvider(db, caps, 'idle', 4, date);
 reserveProvider(db, caps, 'paid', 2, date);
 consumeProvider(db, caps, 'paid', 1, date);
 releaseUnspent(db, 'idle'); releaseUnspent(db, 'paid'); releaseUnspent(db, 'unknown');
 expect(db.prepare('SELECT run_id, reserved, consumed FROM provider_budget ORDER BY run_id').all()).toEqual([
  { run_id: 'idle', reserved: 0, consumed: 0 }, { run_id: 'paid', reserved: 2, consumed: 1 }]);
 reserveProvider(db, caps, 'next', 4, date);                       // the idle run's 4 units are free again
 expect(() => reserveProvider(db, caps, 'more', 1, date)).toThrow('provider-cap');   // 2 + 4 = the daily 6
 db.close();
});

import { createMagnific } from '../adapters/magnific.ts';
it('adapter cap rejects before any fetch and logs append-only accepted tickets without secrets', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vc-provider-budget-'));
 const db=new DatabaseSync(join(dir,'db.sqlite')); budgetSchema(db);
 let calls=0;
 const key='test-only-hidden-magnific-key';
 const client=createMagnific({apiKey:key,spendDir:dir,beforePaid:(runId,units)=>consumeProvider(db,{daily:1,job:1},runId,units,new Date()),
 fetch:async()=>{ calls++; return new Response(JSON.stringify({data:{task_id:'safe-ticket',status:'FAILED',error:'rejected'}}),{status:200}); }});
 const request={prompt:'circle',references:[],aspect:'1:1'};
 await expect(client.image(request,join(dir,'jobs','run-one','test.png'),()=>{})).rejects.toThrow();
 const before=calls;
 await expect(client.image(request,join(dir,'jobs','run-two','test.png'),()=>{})).rejects.toThrow('provider-cap');
 expect(calls).toBe(before); expect(calls).toBe(1);
 const log=readFileSync(join(dir,'provider-spend.jsonl'),'utf8'); expect(log).not.toContain(key);
 expect(log.split('\n').filter(Boolean).map(line=>JSON.parse(line).event)).toEqual(['intent','accepted','unfinished']);
 expect(log).toContain('safe-ticket'); expect(log).toContain('unverified'); db.close();
 const reopened=new DatabaseSync(join(dir,'db.sqlite'));
 expect(()=>consumeProvider(reopened,{daily:1,job:1},'new',1,new Date())).toThrow('provider-cap'); reopened.close();
});

// The live owner run: reserved 43, consumed 10, then the owner closed the job. A run that cannot spend any more keeps nothing it did not spend.
it('a finished or closed run gives back what it reserved and did not consume; a stopped one that may be resumed keeps it; spent units stay counted', () => {
 const db = openDb(join(mkdtempSync(join(tmpdir(), 'vc-budget-terminal-')), 'db.sqlite')); budgetSchema(db);
 const date = new Date('2026-10-05T20:00:00Z');
 const wide = { daily: 1000, job: 60 };
 const input: RunInput = { kind: 'produce', templateId: 't', quality: 'fast', variants: 1, language: 'en', products: [], sample: false };
 const made = (ref: string, state: string, consumed: number) => {
  const id = enqueue(db, input, ref, null, date);
  reserveProvider(db, wide, ref, 43, date); consumeProvider(db, wide, ref, consumed, date);
  return () => db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(state, id);
 };
 const ends = [made('closed-job', 'closed', 10), made('done-job', 'done', 40), made('stopped-job', 'stopped', 10), made('running-job', 'running', 5)];
 for (const end of ends) end();
 expect(releaseTerminal(db)).toBe(2);
 expect(db.prepare('SELECT run_id, reserved, consumed FROM provider_budget ORDER BY run_id').all()).toEqual([
  { run_id: 'closed-job', reserved: 10, consumed: 10 }, { run_id: 'done-job', reserved: 40, consumed: 40 },
  { run_id: 'running-job', reserved: 43, consumed: 5 }, { run_id: 'stopped-job', reserved: 43, consumed: 10 }]);
 expect(releaseTerminal(db)).toBe(0);                                          // nothing left to give back
 db.close();
});

it('a reservation is released where the cap is checked: a closed run does not block a new job', () => {
 const db = openDb(join(mkdtempSync(join(tmpdir(), 'vc-budget-terminal-')), 'db.sqlite')); budgetSchema(db);
 const date = new Date('2026-10-05T20:00:00Z');
 const caps = { daily: 100, job: 60 };
 const id = enqueue(db, { kind: 'produce', templateId: 't', quality: 'fast', variants: 1, language: 'en', products: [], sample: false }, 'closed-job', null, date);
 db.prepare("UPDATE runs SET state = 'closed' WHERE id = ?").run(id);
 reserveProvider(db, caps, 'closed-job', 43, date); consumeProvider(db, caps, 'closed-job', 10, date);
 expect(() => reserveProvider(db, caps, 'next', 60, date)).not.toThrow();      // 10 + 60 fit the day; 43 + 60 would not
 db.close();
});

it('a job resumed on a later UTC day is not held to the unused reservation of the day it stopped on', () => {
 const db = new DatabaseSync(':memory:'); budgetSchema(db);
 const caps = { daily: 100, job: 60 };
 const day1 = new Date('2026-10-05T20:00:00Z'), day2 = new Date('2026-10-06T08:00:00Z');
 reserveProvider(db, caps, 'job', 43, day1); consumeProvider(db, caps, 'job', 10, day1);   // stopped: 33 units never used
 for (let i = 0; i < 33; i += 1) consumeProvider(db, caps, 'job', 1, day2);              // the resume pays for the rest of its 43
 expect(db.prepare('SELECT day, reserved, consumed FROM provider_budget ORDER BY day').all()).toEqual([
  { day: '2026-10-05', reserved: 43, consumed: 10 }, { day: '2026-10-06', reserved: 33, consumed: 33 }]);
 expect(() => consumeProvider(db, caps, 'job', 17, day2)).not.toThrow();                // 43 consumed in all; the job cap 60 still holds
 expect(() => consumeProvider(db, caps, 'job', 1, day2)).toThrow('provider-cap');       // 61st unit
 db.close();
});
