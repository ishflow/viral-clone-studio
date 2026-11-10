import { describe, expect, it } from 'vitest';
import type { Job } from '@/data/ports';
import { providerOutOfCredits } from './credits';

const job = (over: Partial<Job>) => over as Job;
const credits = (stoppedAt: string) => job({ status: 'stopped', stoppedDetail: 'provider-credits', stoppedAt, finishedAt: null });
const done = (finishedAt: string) => job({ status: 'done', finishedAt, stoppedAt: null });

describe('providerOutOfCredits', () => {
  it('is false with no job, or no job stopped for credits', () => {
    expect(providerOutOfCredits([])).toBe(false);
    expect(providerOutOfCredits([done('2026-10-05T10:00:00Z'), job({ status: 'stopped', stoppedDetail: 'provider-cap', stoppedAt: '2026-10-05T11:00:00Z' })])).toBe(false);
  });
  it('is true while the newest credits stop is newer than the newest finished job', () => {
    expect(providerOutOfCredits([credits('2026-10-05T11:00:00Z')])).toBe(true);
    expect(providerOutOfCredits([done('2026-10-05T10:00:00Z'), credits('2026-10-05T11:00:00Z')])).toBe(true);
  });
  it('is false once a job finished after it', () => {
    expect(providerOutOfCredits([credits('2026-10-05T11:00:00Z'), done('2026-10-05T12:00:00Z')])).toBe(false);
  });
});
