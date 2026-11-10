// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { RULES } from '../ports';
import type { SwapInput } from '../ports';
import { SWAP_TEMPLATE_ID } from './demo-values';
import { getStore, resetStore } from './store';
import { START } from './test-helpers';

// "This is not me / I gave no permission": a problem of its own kind, reported on the video of a person swap.

const input: SwapInput = { templateId: SWAP_TEMPLATE_ID, quality: 'fast', people: [{ slot: 1, body: 'me.jpg', face: null }] };
async function swapVideo(): Promise<string> {
  const job = await data.swap.start('usr-demo', input, 'key-1', await data.swap.estimate('usr-demo', input),
    { ownPerson: true, adults: true, notCelebrity: true, version: RULES.swapConsentVersion });
  vi.advanceTimersByTime(60_000);
  expect((await data.jobs.get(job.id, 'usr-demo'))!.status).toBe('done');
  return job.id;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubEnv('VC_FAKE_SWAP', '1');
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('the report "this is not me"', () => {
  it('is kept under its own name, with the job and the note as they were sent', async () => {
    const jobId = await swapVideo();
    const { reference } = await data.support.report('usr-demo', jobId, 'not-me', 'I never uploaded this photo', 'report-1');
    expect((await data.support.messages())[0]).toMatchObject({ reference, problem: 'not-me', jobId, userId: 'usr-demo', message: 'I never uploaded this photo' });
  });

  it('is a report on a person swap only: on a product video it is refused and nothing is kept', async () => {
    const before = getStore().support.length;
    await expect(data.support.report('usr-demo', 'job-demo-story', 'not-me', '', 'report-2')).rejects.toThrow('invalid-problem');
    expect(getStore().support).toHaveLength(before);
    await expect(data.support.report('usr-demo', 'job-demo-story', 'other', 'a note', 'report-3')).resolves.toMatchObject({ duplicate: false });
  });

  it('leaves a report of before as it was kept: `other`, with the mark at the start of its note', async () => {
    const jobId = await swapVideo();
    const note = '[person swap: not me / no permission] please remove it';
    await data.support.report('usr-demo', jobId, 'other', note, 'report-4');
    expect((await data.support.messages())[0]).toMatchObject({ problem: 'other', message: note });
  });
});
