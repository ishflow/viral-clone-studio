// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

let sessionId: string | null = 'usr-demo';
vi.mock('@/core/session/session', async () => {
  const { data } = await import('@/data');
  const readUser = async () => (sessionId ? data.auth.getUser(sessionId) : null);
  return { getSessionUser: readUser, getSessionState: async () => {
    const user = await readUser();
    return user ? { kind: user.blocked ? 'blocked' : 'active', user } : { kind: 'anonymous' };
  } };
});
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { data } from '@/data';
import { resetStore } from '@/data/mock/store';
import { deleteJobVideo, regenerateVariant, reportProblem } from './result-actions';

beforeEach(() => {
  resetStore();
  sessionId = 'usr-demo';
});

describe('reportProblem', () => {
  it('sends a report for a delivered video of the user, once per key, with the job id and the note', async () => {
    expect(await reportProblem('job-demo-story', 'text-wrong', '  cut off  ', 'k-1')).toEqual({ status: 'sent' });
    expect(await reportProblem('job-demo-story', 'text-wrong', '  cut off  ', 'k-1')).toEqual({ status: 'sent' });
    const sent = (await data.support.messages()).filter((m) => m.jobId === 'job-demo-story');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ problem: 'text-wrong', userId: 'usr-demo', message: 'cut off' });
  });
  it('hands "this is not me" to the support desk as a kind of its own; the desk decides whether the job may be reported so', async () => {
    const report = vi.spyOn(data.support, 'report');
    expect(await reportProblem('job-demo-story', 'not-me', 'take it down', 'k-5')).toEqual({ status: 'error' }); // not a person swap
    expect(report).toHaveBeenCalledWith('usr-demo', 'job-demo-story', 'not-me', 'take it down', 'k-5');
    report.mockRestore();
  });
  it('says closed after the report window, and refuses a reason it does not know or someone else\'s job', async () => {
    expect(await reportProblem('job-demo-shower', 'other', '', 'k-2')).toEqual({ status: 'closed' }); // delivered 13 days ago
    expect(await reportProblem('job-demo-story', 'spam', '', 'k-3')).toEqual({ status: 'error' });
    expect(await reportProblem('job-demo-story', 'other', '', '')).toEqual({ status: 'error' });
    sessionId = 'usr-paying';
    await expect(reportProblem('job-demo-story', 'other', '', 'k-4')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('deleteJobVideo', () => {
  it('deletes a delivered video and goes to My videos; the credits stay spent; a job that is not delivered is not deleted', async () => {
    const balance = await data.ledger.balance('usr-demo');
    await expect(deleteJobVideo('job-demo-story')).rejects.toThrow('NEXT_REDIRECT:/videos');
    expect(await data.jobs.get('job-demo-story', 'usr-demo')).toBeNull();
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
    expect(await deleteJobVideo('job-demo-stopped')).toEqual({ status: 'error' });
    expect(await deleteJobVideo(7)).toEqual({ status: 'error' });
  });
  it('is a 404 for someone else\'s job', async () => {
    sessionId = 'usr-paying';
    await expect(deleteJobVideo('job-demo-story')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('regenerateVariant', () => {
  it('refuses a bad request without touching anything; a variant that is not there is a 404', async () => {
    const balance = await data.ledger.balance('usr-demo');
    expect(await regenerateVariant('job-demo-story', 'nope', 'x')).toEqual({ status: 'error' });
    expect(await regenerateVariant('job-demo-story', 'nope', -1)).toEqual({ status: 'error' });
    await expect(regenerateVariant('job-demo-story', 'nope', 2)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
  });
});
