// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { resetStore } from './store';
import { START, generateInput, startConfirmed } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the parts a stopped job puts in its stopped mail', () => {
  it('a job that stops with 5 of 5 images and 3 of 5 clips puts those counts in its stopped mail', async () => {
    const job = await startConfirmed('usr-demo', generateInput('tpl-stop'), 'stopped-mail-1');
    vi.advanceTimersByTime(60_000);
    const stopped = (await data.jobs.get(job.id, 'usr-demo'))!;
    expect(stopped.status).toBe('stopped');
    const count = (key: string) => stopped.steps.find((step) => step.key === key);
    const email = (await data.mailer.outbox()).find((mail) => mail.kind === 'stopped')!;
    // The mail says what the job page says: done / total of the same steps, nothing for a step with no work.
    for (const key of ['images', 'clips', 'music'] as const) {
      const step = count(key);
      if (step && step.total > 0) expect(email.data[key]).toBe(`${step.done}/${step.total}`);
      else expect(email.data).not.toHaveProperty(key);
    }
    expect(Object.keys(email.data).filter((key) => ['images', 'clips', 'music'].includes(key)).length).toBeGreaterThan(0);
  });
});
