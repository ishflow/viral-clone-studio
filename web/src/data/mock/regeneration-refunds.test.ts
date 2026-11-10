import { afterEach, expect, it, vi } from 'vitest';
import { data } from '..';
import { resetStore, getStore } from './store';
import { fakeEngine } from '../engine/fake';
import { jobRecord } from '../real/testing';
import { toPurchase } from './payments';
import { writeEntry, lotsOf } from './ledger';
afterEach(() => vi.restoreAllMocks());
it.each([false, true])('refund each regeneration to its own lot once (simultaneous=%s)', async simultaneous => {
  resetStore();
  const store = getStore();
  store.ledger = [];
  writeEntry('usr-demo', 'purchase', 2, 'A', { purchaseId: 'A' });
  writeEntry('usr-demo', 'purchase', 2, 'B', { purchaseId: 'B' });
  const job = jobRecord({ id: 'probe', userId: 'usr-demo', templateId: 'tpl-layering', status: 'done', credits: 6, returnedCredits: 4 });
  job.input.variants = 3;
  job.variants = [
    { id: 'v1', status: 'done', video: '/one.mp4', image: '', reason: null },
    { id: 'v2', status: 'stopped', video: null, image: '', reason: 'clips-failed' },
    { id: 'v3', status: 'stopped', video: null, image: '', reason: 'clips-failed' },
  ];
  store.jobs = [job];
  store.purchases = ['A', 'B'].map(id => ({ id, userId: 'usr-demo', packId: 'starter', packName: id, credits: 2,
    amount: null, amountCents: null, at: new Date().toISOString(), status: 'paid', invoiceId: null,
    refund: null }));
  vi.spyOn(fakeEngine, 'refresh').mockImplementation(j => j);
  vi.spyOn(fakeEngine, 'regenerateVariant').mockImplementation((j, id) => { j.variants.find(v => v.id === id)!.status = 'generating'; return `run-${id}`; });
  await data.jobs.regenerateVariant('probe', 'usr-demo', 'v2', 2);
  await data.jobs.regenerateVariant('probe', 'usr-demo', 'v3', 2);
  expect([...lotsOf('usr-demo')]).toEqual([['A', 0], ['B', 0]]);
  vi.mocked(fakeEngine.refresh).mockImplementation(j => { j.variants.find(v => v.id === 'v2')!.status = 'stopped'; if (simultaneous) j.variants.find(v => v.id === 'v3')!.status = 'stopped'; return j; });
  await data.jobs.get('probe', 'usr-demo');
  expect([...lotsOf('usr-demo')]).toEqual([['A', 2], ['B', simultaneous ? 2 : 0]]);
  vi.mocked(fakeEngine.refresh).mockImplementation(j => { j.variants.find(v => v.id === 'v3')!.status = 'stopped'; return j; });
  await data.jobs.get('probe', 'usr-demo');
  await data.jobs.get('probe', 'usr-demo');
  expect([...lotsOf('usr-demo')]).toEqual([['A', 2], ['B', 2]]);
  expect(store.purchases.map(p => toPurchase(p).refundable?.ok)).toEqual([true, true]);
});
