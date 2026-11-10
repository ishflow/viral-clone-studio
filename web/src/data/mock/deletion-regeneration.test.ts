import { expect, it, vi, afterEach } from 'vitest';
import { data } from '..';
import { getStore, resetStore } from './store';
import { jobRecord } from '../real/testing';
import { fakeEngine } from '../engine/fake';
afterEach(() => vi.restoreAllMocks());
it('refuses account and template deletion during variant regeneration', async () => {
  resetStore();
  const job = jobRecord({ userId: 'usr-demo', templateId: 'tpl-layering', status: 'done' });
  job.variants = [{ id: 'v2', status: 'generating', image: '', video: null, reason: null }];
  getStore().jobs = [job];
  vi.spyOn(fakeEngine, 'refresh').mockImplementation(j => j);
  await expect(data.auth.deleteAccount('usr-demo')).rejects.toThrow('job-running');
  await expect(data.catalog.remove('tpl-layering', 'usr-admin')).rejects.toThrow('template-in-use');
});
